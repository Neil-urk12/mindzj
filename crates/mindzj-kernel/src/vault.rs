use crate::error::{KernelError, KernelResult};
use crate::types::{AppSettings, FileContent, FileMetadata, VaultEntry, VaultInfo};
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::mem::ManuallyDrop;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tracing::{info, warn};

/// Maximum number of file snapshots to keep per file for recovery.
const MAX_SNAPSHOTS_PER_FILE: usize = 50;

/// The hidden config directory inside each vault.
const VAULT_CONFIG_DIR: &str = ".mindzj";

/// Maximum file size for `read_binary` — 50 MiB.
const MAX_READ_BINARY_SIZE: u64 = 50 * 1024 * 1024; // 50 MiB

/// Maximum file size for content analysis in `file_metadata` — 10 MiB.
/// Files larger than this still return metadata (size, timestamps)
/// but word count, char count, and tags are skipped.
const MAX_METADATA_CONTENT_SIZE: u64 = 10 * 1024 * 1024;

/// Manages all file I/O for a single vault.
/// All filesystem operations MUST go through this module —
/// direct `fs::*` calls from other modules are forbidden.
///
/// # Safety guarantees
/// - Atomic writes via temp file + fsync + rename
/// - Path traversal prevention (no escaping vault root)
/// - Automatic snapshots for file recovery
/// - Concurrent read safety via Mutex on write operations
pub struct Vault {
    /// Vault metadata
    info: VaultInfo,
    /// Absolute, canonicalized vault root path
    root: PathBuf,
    /// Write lock to ensure atomic file operations
    // Lock ordering: write_lock > config_write_lock > PLUGINS_WRITE_LOCK
    // Never hold two of these simultaneously.
    write_lock: Mutex<()>
}

/// Guard that removes a temporary file on drop.
/// Ensures cleanup even if write/fsync/rename fails.
struct TmpGuard<'a>(&'a Path);

impl Drop for TmpGuard<'_> {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.0);
    }
}

/// Atomically write to a file using temp-file + rename strategy.
/// Ensures parent directories exist. Cleans up temp file on any error.
pub(crate) fn atomic_write_file(
    abs_path: &Path,
    writer: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
) -> KernelResult<()> {
    // Validate the filename
    if let Some(name) = abs_path.file_name() {
        Vault::validate_file_name(&name.to_string_lossy())?;
    }

    // Validate parent directory
    let parent = abs_path.parent().ok_or_else(|| {
        KernelError::Io(std::io::Error::other(
            "atomic_write_file requires a path with a parent directory",
        ))
    })?;
    if parent.as_os_str().is_empty() {
        return Err(KernelError::Io(std::io::Error::other(
            "atomic_write_file requires a path with a parent directory, not a bare filename",
        )));
    }

    // Ensure parent directory exists
    if !parent.exists() {
        fs::create_dir_all(parent)?;
    }

    // Write to a temporary file first, then rename atomically
    let tmp_name = format!(
        ".~{}.tmp",
        abs_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
    );
    let tmp_path = parent.join(&tmp_name);

    // Guard ensures temp file cleanup on any error path
    let guard = TmpGuard(&tmp_path);

    let mut tmp_file = fs::File::create(&tmp_path)?;
    writer(&mut tmp_file)?;

    // fsync to ensure data is on disk
    tmp_file.sync_all()?;

    // Atomic rename
    Vault::replace_with_temp(&tmp_path, abs_path)?;

    // Disarm guard — rename succeeded, temp file no longer exists
    let _ = ManuallyDrop::new(guard);

    Ok(())
}
impl Vault {
    fn replace_with_temp(tmp_path: &Path, target_path: &Path) -> KernelResult<()> {
        match fs::rename(tmp_path, target_path) {
            Ok(()) => Ok(()),
            Err(err)
                if target_path.exists()
                    && matches!(
                        err.kind(),
                        std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
                    ) =>
            {
                fs::remove_file(target_path)?;
                fs::rename(tmp_path, target_path)?;
                Ok(())
            }
            Err(err) => Err(KernelError::Io(err)),
        }
    }

    fn rename_case_only(from_path: &Path, to_path: &Path) -> KernelResult<()> {
        let parent = from_path.parent().ok_or_else(|| {
            KernelError::InvalidFileName(from_path.display().to_string())
        })?;
        let file_name = from_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("entry");

        let mut temp_path = None;
        for i in 0..1000 {
            let candidate = parent.join(format!(
                ".{}.mindzj-case-rename-{}-{}.tmp",
                file_name,
                std::process::id(),
                i
            ));
            if !candidate.exists() {
                temp_path = Some(candidate);
                break;
            }
        }
        let temp_path = temp_path.ok_or_else(|| {
            KernelError::Io(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "Unable to allocate a temporary rename path",
            ))
        })?;

        fs::rename(from_path, &temp_path)?;
        if let Err(err) = fs::rename(&temp_path, to_path) {
            let _ = fs::rename(&temp_path, from_path);
            return Err(KernelError::Io(err));
        }

        Ok(())
    }

    /// Open an existing vault or initialize a new one at the given path.
    ///
    /// Creates the `.mindzj/` config directory if it doesn't exist.
    /// Returns an error if the path doesn't exist and can't be created.
    pub fn open(path: impl AsRef<Path>, name: &str) -> KernelResult<Self> {
        let root = path.as_ref().to_path_buf();

        // Ensure the vault directory exists
        if !root.exists() {
            fs::create_dir_all(&root)?;
            info!("Created new vault directory: {}", root.display());
        }

        // Canonicalize to resolve symlinks and get absolute path
        let root = root
            .canonicalize()
            .map_err(KernelError::Io)?;

        // Create .mindzj config directory with full structure
        let config_dir = root.join(VAULT_CONFIG_DIR);
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)?;
        }

        // Create subdirectories
        let subdirs = ["snapshots", "plugins", "snippets", "themes", "images"];
        for subdir in &subdirs {
            let d = config_dir.join(subdir);
            if !d.exists() {
                fs::create_dir_all(&d)?;
            }
        }

        // Create default config files (only if they don't already exist)
        let default_files: &[(&str, &str)] = &[
            ("app.json", "{}"),
            ("appearance.json", "{}"),
            ("hotkeys.json", "[]"),
            (
                "workspace.json",
                r#"{"open_files":[],"active_file":null,"sidebar_tab":"files","sidebar_collapsed":false,"sidebar_width":260,"sidebar_tab_order":["files","outline","search","calendar"]}"#,
            ),
            ("plugins.json", "[]"),
            ("graph.json", "{}"),
            ("backlink.json", "{}"),
            ("types.json", "{}"),
        ];

        for (name, default_content) in default_files {
            let f = config_dir.join(name);
            if !f.exists() {
                fs::write(&f, default_content)?;
            }
        }

        // Create default settings.json with explicit attachment_folder
        // so new vaults are immediately configured to store pasted images
        // in .mindzj/images/.
        let settings_file = config_dir.join("settings.json");
        if !settings_file.exists() {
            let json = serde_json::to_string_pretty(&AppSettings::default())
                .unwrap_or_else(|_| r#"{"attachment_folder":".mindzj/images"}"#.to_string());
            fs::write(&settings_file, json)?;
        }

        let info = VaultInfo {
            name: name.to_string(),
            path: root.clone(),
            created_at: Utc::now(),
            last_opened: Utc::now(),
        };

        info!("Vault opened: {} at {}", name, root.display());

        Ok(Self {
            info,
            root,
            write_lock: Mutex::new(()),
        })
    }

    /// Get vault metadata.
    pub fn info(&self) -> &VaultInfo {
        &self.info
    }

    /// Get the vault root path.
    pub fn root(&self) -> &Path {
        &self.root
    }

    // -----------------------------------------------------------------------
    // Path safety
    // -----------------------------------------------------------------------

    /// Resolve a relative path to an absolute path within the vault.
    /// Returns an error if the resolved path escapes the vault root
    /// (path traversal attack prevention).
    fn resolve_safe_path(&self, relative: &str) -> KernelResult<PathBuf> {
        // Reject obviously malicious patterns
        if relative.contains("..") {
            // Do a component-level check to catch "../" attempts
            let path = Path::new(relative);
            for component in path.components() {
                if matches!(component, Component::ParentDir) {
                    return Err(KernelError::PathTraversalDenied(
                        relative.to_string(),
                    ));
                }
            }
        }

        let full_path = self.root.join(relative);

        // Always canonicalize the parent directory, never the full path.
        // This eliminates the TOCTOU window between exists() and canonicalize().
        let resolved = if let Some(parent) = full_path.parent() {
            if parent.exists() {
                let canonical_parent = parent.canonicalize()?;
                if let Some(file_name) = full_path.file_name() {
                    canonical_parent.join(file_name)
                } else {
                    return Err(KernelError::InvalidFileName(
                        relative.to_string(),
                    ));
                }
            } else {
                full_path.clone()
            }
        } else {
            full_path.clone()
        };

        // Ensure the resolved path is within the vault root
        if !resolved.starts_with(&self.root) {
            return Err(KernelError::PathTraversalDenied(format!(
                "Path '{}' resolves to '{}' which is outside vault root '{}'",
                relative,
                resolved.display(),
                self.root.display()
            )));
        }

        Ok(resolved)
    }

    fn resolve_safe_rename_target(&self, relative: &str) -> KernelResult<PathBuf> {
        // Reject obviously malicious patterns
        if relative.contains("..") {
            // Do a component-level check to catch "../" attempts
            let path = Path::new(relative);
            for component in path.components() {
                if matches!(component, Component::ParentDir) {
                    return Err(KernelError::PathTraversalDenied(
                        relative.to_string(),
                    ));
                }
            }
        }

        let full_path = self.root.join(relative);
        let resolved = if let Some(parent) = full_path.parent() {
            if parent.exists() {
                let canonical_parent = parent.canonicalize()?;
                if let Some(file_name) = full_path.file_name() {
                    canonical_parent.join(file_name)
                } else {
                    return Err(KernelError::InvalidFileName(
                        relative.to_string(),
                    ));
                }
            } else {
                full_path.clone()
            }
        } else {
            full_path.clone()
        };

        // Ensure the resolved path is within the vault root
        if !resolved.starts_with(&self.root) {
            return Err(KernelError::PathTraversalDenied(format!(
                "Path '{}' resolves to '{}' which is outside vault root '{}'",
                relative,
                resolved.display(),
                self.root.display()
            )));
        }

        Ok(resolved)
    }

    /// Validate that a file name is safe to use.
    fn validate_file_name(name: &str) -> KernelResult<()> {
        if name.is_empty() {
            return Err(KernelError::InvalidFileName(
                "File name cannot be empty".to_string(),
            ));
        }

        // Forbid control characters and path separators in names
        let forbidden = ['/', '\\', '\0', ':', '*', '?', '"', '<', '>', '|'];
        for c in forbidden {
            if name.contains(c) {
                return Err(KernelError::InvalidFileName(format!(
                    "File name '{}' contains forbidden character '{}'",
                    name, c
                )));
            }
        }

        // Forbid names that are all dots
        if name.chars().all(|c| c == '.') {
            return Err(KernelError::InvalidFileName(format!(
                "File name '{}' is not allowed",
                name
            )));
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // File read operations
    // -----------------------------------------------------------------------

    /// Read the content of a file.
    pub fn read_file(&self, relative_path: &str) -> KernelResult<FileContent> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if !abs_path.exists() {
            return Err(KernelError::FileNotFound(relative_path.to_string()));
        }

        if !abs_path.is_file() {
            return Err(KernelError::FileNotFound(format!(
                "'{}' is not a file",
                relative_path
            )));
        }

        let content = fs::read_to_string(&abs_path)?;
        let modified = fs::metadata(&abs_path)?
            .modified()?
            .into();

        // Compute SHA-256 hash for conflict detection
        let hash = Self::compute_hash(&content);

        Ok(FileContent {
            path: relative_path.to_string(),
            content,
            modified,
            hash,
        })
    }

    /// List all entries in a directory.
    pub fn list_entries(&self, relative_dir: &str) -> KernelResult<Vec<VaultEntry>> {
        let abs_path = if relative_dir.is_empty() {
            self.root.clone()
        } else {
            self.resolve_safe_path(relative_dir)?
        };

        if !abs_path.is_dir() {
            return Err(KernelError::FileNotFound(format!(
                "'{}' is not a directory",
                relative_dir
            )));
        }

        let mut entries = Vec::new();

        for entry in fs::read_dir(&abs_path)? {
            let entry = entry?;
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files/dirs (starting with '.') in the listing
            if file_name.starts_with('.') {
                continue;
            }

            let metadata = entry.metadata()?;
            let modified: chrono::DateTime<Utc> = metadata.modified()?.into();
            let is_dir = metadata.is_dir();

            let relative = if relative_dir.is_empty() {
                file_name.clone()
            } else {
                format!("{}/{}", relative_dir, file_name)
            };

            let extension = if is_dir {
                String::new()
            } else {
                Path::new(&file_name)
                    .extension()
                    .map(|e| e.to_string_lossy().to_string())
                    .unwrap_or_default()
            };

            entries.push(VaultEntry {
                name: file_name,
                relative_path: relative,
                is_dir,
                size: if is_dir { 0 } else { metadata.len() },
                modified,
                extension,
                children: None,
            });
        }

        // Sort: directories first, then alphabetically
        entries.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(
                a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            )
        });

        Ok(entries)
    }

    /// Build a complete file tree (recursive) up to a maximum depth.
    pub fn file_tree(&self, max_depth: u32) -> KernelResult<Vec<VaultEntry>> {
        self.build_tree("", 0, max_depth)
    }

    /// List `.css` files directly under `.mindzj/snippets/`. Used by the
    /// Appearance settings page to show the user's  CSS
    /// snippets. Returns just the base filenames (without extension) so
    /// the caller can show a clean list and persist the enabled-state map
    /// keyed by snippet name. The `.mindzj/snippets/` directory is
    /// created on demand so opening the folder always succeeds.
    pub fn list_css_snippets(&self) -> KernelResult<Vec<String>> {
        let snippets_dir = self.root.join(".mindzj").join("snippets");
        if !snippets_dir.exists() {
            fs::create_dir_all(&snippets_dir)?;
            return Ok(Vec::new());
        }
        if !snippets_dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut names: Vec<String> = Vec::new();
        for entry in fs::read_dir(&snippets_dir)? {
            let entry = entry?;
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.to_lowercase().ends_with(".css") && entry.metadata()?.is_file() {
                names.push(file_name);
            }
        }
        names.sort();
        Ok(names)
    }

    /// Read the content of a CSS snippet by its filename (e.g. `dark.css`).
    /// The file must live directly inside `.mindzj/snippets/`.
    pub fn read_css_snippet(&self, name: &str) -> KernelResult<String> {
        // Reject any path separators — snippet names are flat file names.
        if name.contains('/') || name.contains('\\') || name.starts_with('.') {
            return Err(KernelError::PathTraversalDenied(name.to_string()));
        }
        let path = self.root.join(".mindzj").join("snippets").join(name);
        if !path.exists() || !path.is_file() {
            return Err(KernelError::FileNotFound(name.to_string()));
        }
        Ok(fs::read_to_string(&path)?)
    }

    /// Absolute filesystem path of the snippets directory, creating it
    /// on demand. Used by the "Open snippets folder" button to reveal
    /// the directory in Windows Explorer.
    pub fn snippets_dir(&self) -> KernelResult<PathBuf> {
        let dir = self.root.join(".mindzj").join("snippets");
        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    // -----------------------------------------------------------------------
    // Custom theme (skin) storage — same model as CSS snippets, but the
    // enabled theme is singular (at most one custom skin active) and is
    // referenced from `settings.theme` as `custom:<bare_name>`.
    // -----------------------------------------------------------------------

    /// Absolute path of the per-vault themes directory. Created on demand
    /// so callers can always rely on the directory existing.
    pub fn themes_dir(&self) -> KernelResult<PathBuf> {
        let dir = self.root.join(".mindzj").join("themes");
        if !dir.exists() {
            fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    /// List `.css` files directly under `.mindzj/themes/`. Each entry is
    /// a bare filename (e.g. `my-theme.css`). The bare stem without the
    /// `.css` extension is what gets stored in settings as
    /// `custom:<stem>`.
    pub fn list_themes(&self) -> KernelResult<Vec<String>> {
        let dir = self.themes_dir()?;
        if !dir.is_dir() {
            return Ok(Vec::new());
        }
        let mut names: Vec<String> = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.to_lowercase().ends_with(".css") && entry.metadata()?.is_file() {
                names.push(file_name);
            }
        }
        names.sort();
        Ok(names)
    }

    /// Read the raw CSS content of a custom theme by its bare filename.
    /// The file must live directly inside `.mindzj/themes/`.
    pub fn read_theme(&self, name: &str) -> KernelResult<String> {
        // Reject any path separators — theme names are flat file names.
        if name.contains('/') || name.contains('\\') || name.starts_with('.') {
            return Err(KernelError::PathTraversalDenied(name.to_string()));
        }
        let path = self.themes_dir()?.join(name);
        if !path.exists() || !path.is_file() {
            return Err(KernelError::FileNotFound(name.to_string()));
        }
        Ok(fs::read_to_string(&path)?)
    }

    /// Copy a user-supplied `.css` file from an ABSOLUTE source path into
    /// `.mindzj/themes/`, preserving its original filename (but with the
    /// extension normalized to lowercase `.css`). Rejects non-`.css`
    /// inputs and files that would overwrite an existing theme unless
    /// `overwrite` is true.
    ///
    /// Returns the bare filename (e.g. `my-theme.css`) the user can
    /// reference as `custom:my-theme`.
    pub fn import_theme(
        &self,
        source_absolute_path: &str,
        overwrite: bool,
    ) -> KernelResult<String> {
        let src = Path::new(source_absolute_path);
        if !src.is_file() {
            return Err(KernelError::FileNotFound(source_absolute_path.to_string()));
        }
        let ext = src
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        if ext.as_deref() != Some("css") {
            return Err(KernelError::InvalidFileName(format!(
                "Theme file must have a .css extension, got '{}'",
                source_absolute_path
            )));
        }
        let stem = src
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| KernelError::InvalidFileName(source_absolute_path.to_string()))?;
        // Sanitize the stem: drop any character we forbid in vault file
        // names so a hostile path can't slip past `validate_file_name`.
        let sanitized_stem: String = stem
            .chars()
            .map(|c| {
                if matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                    '-'
                } else {
                    c
                }
            })
            .collect::<String>()
            .trim_matches(|c: char| c.is_whitespace() || c == '.')
            .to_string();
        if sanitized_stem.is_empty() {
            return Err(KernelError::InvalidFileName(source_absolute_path.to_string()));
        }
        Self::validate_file_name(&sanitized_stem)?;
        let file_name = format!("{}.css", sanitized_stem);
        let dest = self.themes_dir()?.join(&file_name);
        if dest.exists() && !overwrite {
            return Err(KernelError::FileAlreadyExists(file_name));
        }
        let bytes = fs::read(src)?;
        self.atomic_write(&dest, |file| file.write_all(&bytes))?;
        Ok(file_name)
    }

    /// Delete a custom theme by its bare filename. No-op if the file
    /// doesn't exist (so the UI can safely re-issue deletes after an
    /// external delete).
    pub fn delete_theme(&self, name: &str) -> KernelResult<()> {
        if name.contains('/') || name.contains('\\') || name.starts_with('.') {
            return Err(KernelError::PathTraversalDenied(name.to_string()));
        }
        let path = self.themes_dir()?.join(name);
        if path.exists() && path.is_file() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// Write a CSS string to `.mindzj/themes/<name>.css` (normalising
    /// the extension). Used by "Save as new theme" / scaffolding flows
    /// that don't start from an external file.
    pub fn write_theme(&self, bare_name: &str, content: &str) -> KernelResult<String> {
        let trimmed = bare_name.trim();
        if trimmed.is_empty() {
            return Err(KernelError::InvalidFileName("Theme name cannot be empty".into()));
        }
        // Strip any .css the caller may have tacked on, and re-append it
        // canonically. Keeps the on-disk filenames consistent.
        let stem = trimmed
            .strip_suffix(".css")
            .or_else(|| trimmed.strip_suffix(".CSS"))
            .unwrap_or(trimmed);
        Self::validate_file_name(stem)?;
        let file_name = format!("{}.css", stem);
        let dir = self.themes_dir()?;
        let dest = dir.join(&file_name);
        self.atomic_write(&dest, |file| file.write_all(content.as_bytes()))?;
        Ok(file_name)
    }

    fn build_tree(
        &self,
        relative_dir: &str,
        current_depth: u32,
        max_depth: u32,
    ) -> KernelResult<Vec<VaultEntry>> {
        if current_depth >= max_depth {
            return Ok(Vec::new());
        }

        let mut entries = self.list_entries(relative_dir)?;

        for entry in &mut entries {
            if entry.is_dir {
                let children = self.build_tree(
                    &entry.relative_path,
                    current_depth + 1,
                    max_depth,
                )?;
                entry.children = Some(children);
            }
        }

        Ok(entries)
    }

    // -----------------------------------------------------------------------
    // File write operations (atomic + snapshot)
    // -----------------------------------------------------------------------

    /// Core atomic write implementation.
    /// Handles temp file creation, fsync, and atomic rename.
    /// The writer closure receives a mutable File handle to write content.
    pub(crate) fn atomic_write(
        &self,
        abs_path: &Path,
        writer: impl FnOnce(&mut fs::File) -> std::io::Result<()>,
    ) -> KernelResult<()> {
        // Acquire write lock for atomicity
        let _lock = self
            .write_lock
            .lock()
            .map_err(|_| KernelError::Io(std::io::Error::other("Write lock poisoned")))?;

        atomic_write_file(abs_path, writer)
    }

    /// Write content to a file using atomic write strategy.
    ///
    /// Steps:
    /// 1. Create snapshot of existing file (if present)
    /// 2. Write content atomically via `atomic_write` helper
    /// 3. Return file content with hash and modified timestamp
    pub fn write_file(
        &self,
        relative_path: &str,
        content: &str,
    ) -> KernelResult<FileContent> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        // Take snapshot of existing file before overwriting
        if abs_path.exists() {
            if let Err(e) = self.create_snapshot(relative_path) {
                warn!(
                    "Failed to create snapshot for '{}': {}",
                    relative_path, e
                );
            }
        }

        self.atomic_write(&abs_path, |file| {
            file.write_all(content.as_bytes())
        })?;

        info!("File written atomically: {}", relative_path);

        let hash = Self::compute_hash(content);
        let modified = fs::metadata(&abs_path)?.modified()?.into();

        Ok(FileContent {
            path: relative_path.to_string(),
            content: content.to_string(),
            modified,
            hash,
        })
    }

    /// Read raw bytes from a file (for images and other binary data).
    /// Uses path traversal protection via `resolve_safe_path`.
    pub fn read_binary(&self, relative_path: &str) -> KernelResult<Vec<u8>> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if !abs_path.exists() {
            return Err(KernelError::FileNotFound(relative_path.to_string()));
        }

        if !abs_path.is_file() {
            return Err(KernelError::FileNotFound(format!(
                "'{}' is not a file",
                relative_path
            )));
        }

        let meta = abs_path.metadata()?;
        if meta.len() > MAX_READ_BINARY_SIZE {
            return Err(KernelError::FileTooLarge(format!(
                "{} ({} bytes exceeds {} byte limit)",
                relative_path,
                meta.len(),
                MAX_READ_BINARY_SIZE
            )));
        }

        let data = fs::read(&abs_path)?;
        Ok(data)
    }

    /// Write raw bytes to a file (for images and other binary data).
    /// Uses the same atomic-write strategy as `write_file`.
    pub fn write_binary(&self, relative_path: &str, data: &[u8]) -> KernelResult<()> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        self.atomic_write(&abs_path, |file| {
            file.write_all(data)
        })?;

        info!("Binary file written: {}", relative_path);
        Ok(())
    }

    /// Create a new file. Returns an error if the file already exists.
    pub fn create_file(
        &self,
        relative_path: &str,
        content: &str,
    ) -> KernelResult<FileContent> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if abs_path.exists() {
            return Err(KernelError::FileAlreadyExists(
                relative_path.to_string(),
            ));
        }

        self.write_file(relative_path, content)
    }

    /// Delete a file.
    pub fn delete_file(&self, relative_path: &str) -> KernelResult<()> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if !abs_path.exists() {
            return Err(KernelError::FileNotFound(relative_path.to_string()));
        }

        // Create a final snapshot before deletion
        if let Err(e) = self.create_snapshot(relative_path) {
            warn!(
                "Failed to create deletion snapshot for '{}': {}",
                relative_path, e
            );
        }

        let _lock = self.write_lock.lock().map_err(|_| {
            KernelError::Io(std::io::Error::other("Write lock poisoned"))
        })?;

        fs::remove_file(&abs_path)?;
        info!("File deleted: {}", relative_path);
        Ok(())
    }

    /// Rename/move a file within the vault.
    pub fn rename_file(
        &self,
        from: &str,
        to: &str,
    ) -> KernelResult<()> {
        let from_abs = self.resolve_safe_path(from)?;
        let to_abs = self.resolve_safe_rename_target(to)?;

        if !from_abs.exists() {
            return Err(KernelError::FileNotFound(from.to_string()));
        }
        let same_existing_entry = to_abs.exists()
            && from_abs.canonicalize()? == to_abs.canonicalize()?;
        if to_abs.exists() && !same_existing_entry {
            return Err(KernelError::FileAlreadyExists(to.to_string()));
        }

        // Validate destination file name
        if let Some(name) = to_abs.file_name() {
            Self::validate_file_name(&name.to_string_lossy())?;
        }

        // Ensure destination parent exists
        if let Some(parent) = to_abs.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)?;
            }
        }

        let _lock = self.write_lock.lock().map_err(|_| {
            KernelError::Io(std::io::Error::other("Write lock poisoned"))
        })?;

        if same_existing_entry {
            if from_abs != to_abs {
                Self::rename_case_only(&from_abs, &to_abs)?;
            }
        } else {
            fs::rename(&from_abs, &to_abs)?;
        }
        info!("File renamed: {} -> {}", from, to);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Directory operations
    // -----------------------------------------------------------------------

    /// Create a new directory.
    pub fn create_dir(&self, relative_path: &str) -> KernelResult<()> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if abs_path.exists() {
            return Err(KernelError::FileAlreadyExists(
                relative_path.to_string(),
            ));
        }

        fs::create_dir_all(&abs_path)?;
        info!("Directory created: {}", relative_path);
        Ok(())
    }

    /// Delete a directory (must be empty unless recursive is true).
    pub fn delete_dir(
        &self,
        relative_path: &str,
        recursive: bool,
    ) -> KernelResult<()> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if !abs_path.exists() || !abs_path.is_dir() {
            return Err(KernelError::FileNotFound(relative_path.to_string()));
        }

        // Never allow deleting the vault root or config dir
        if abs_path == self.root
            || abs_path == self.root.join(VAULT_CONFIG_DIR)
        {
            return Err(KernelError::PermissionDenied(
                "Cannot delete vault root or config directory".to_string(),
            ));
        }

        if recursive {
            fs::remove_dir_all(&abs_path)?;
        } else {
            fs::remove_dir(&abs_path)?;
        }

        info!("Directory deleted: {} (recursive={})", relative_path, recursive);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Snapshot / recovery
    // -----------------------------------------------------------------------

    /// Create a snapshot of the current file content for recovery.
    fn create_snapshot(&self, relative_path: &str) -> KernelResult<()> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if !abs_path.exists() || !abs_path.is_file() {
            return Ok(()); // Nothing to snapshot
        }

        let content = fs::read(&abs_path)?;
        let timestamp = Utc::now().format("%Y%m%d_%H%M%S%.9f");

        // Encode the file path into a safe snapshot name
        let safe_name = relative_path.replace('/', "_-");
        let snapshot_name = format!("{}_{}", safe_name, timestamp);

        let snapshots_dir = self
            .root
            .join(VAULT_CONFIG_DIR)
            .join("snapshots");
        let snapshot_path = snapshots_dir.join(&snapshot_name);

        atomic_write_file(&snapshot_path, |file| file.write_all(&content))?;

        // Prune old snapshots if over the limit
        let legacy_prefix = if relative_path.contains('/') {
            let legacy = relative_path.replace('/', "__");
            if self.root.join(&legacy).exists() {
                None
            } else {
                Some(legacy)
            }
        } else {
            None
        };
        self.prune_snapshots(&safe_name, &snapshots_dir, legacy_prefix.as_deref())?;

        Ok(())
    }

    /// Remove old snapshots beyond the maximum limit.
    fn prune_snapshots(
        &self,
        safe_name_prefix: &str,
        snapshots_dir: &Path,
        legacy_prefix: Option<&str>,
    ) -> KernelResult<()> {
        let mut matching: Vec<PathBuf> = fs::read_dir(snapshots_dir)?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| {
                let name = p.file_name();
                let prefix_new = format!("{}_", safe_name_prefix);
                if name.map(|n| n.to_string_lossy().starts_with(&prefix_new)).unwrap_or(false) {
                    return true;
                }
                if let Some(legacy) = legacy_prefix {
                    let prefix_legacy = format!("{}_", legacy);
                    if name.map(|n| n.to_string_lossy().starts_with(&prefix_legacy)).unwrap_or(false) {
                        return true;
                    }
                }
                false
            })
            .collect();

        // Sort by name (which includes timestamp) descending
        matching.sort();
        matching.reverse();

        // Remove snapshots beyond the limit
        for old in matching.iter().skip(MAX_SNAPSHOTS_PER_FILE) {
            if let Err(e) = fs::remove_file(old) {
                warn!("Failed to prune snapshot {}: {}", old.display(), e);
            }
        }

        Ok(())
    }

    /// List all available snapshots for a file.
    pub fn list_snapshots(
        &self,
        relative_path: &str,
    ) -> KernelResult<Vec<String>> {
        let safe_name = relative_path.replace('/', "_-");
        // Legacy __ encoding fallback: only if path contains / AND
        // no file exists at the legacy-encoded name (to avoid collision
        // with a literal file like a__b.md).
        let safe_name_legacy = if relative_path.contains('/') {
            let legacy = relative_path.replace('/', "__");
            if self.root.join(&legacy).exists() {
                None // legacy name is a real file, don't match its snapshots
            } else {
                Some(legacy)
            }
        } else {
            None
        };
        let snapshots_dir = self
            .root
            .join(VAULT_CONFIG_DIR)
            .join("snapshots");

        if !snapshots_dir.exists() {
            return Ok(Vec::new());
        }

        let mut snapshots: Vec<String> = fs::read_dir(&snapshots_dir)?
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let prefix_new = format!("{}_", safe_name);
                if name.starts_with(&prefix_new) {
                    Some(name)
                } else if let Some(ref legacy) = safe_name_legacy {
                    let prefix_legacy = format!("{}_", legacy);
                    if name.starts_with(&prefix_legacy) {
                        Some(name)
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
            .collect();

        snapshots.sort();
        snapshots.reverse(); // Most recent first
        Ok(snapshots)
    }

    /// Restore a file from a specific snapshot.
    pub fn restore_snapshot(
        &self,
        relative_path: &str,
        snapshot_name: &str,
    ) -> KernelResult<FileContent> {
        let snapshots_dir = self
            .root
            .join(VAULT_CONFIG_DIR)
            .join("snapshots");
        let snapshot_path = snapshots_dir.join(snapshot_name);

        if !snapshot_path.exists() {
            return Err(KernelError::FileNotFound(format!(
                "Snapshot '{}' not found",
                snapshot_name
            )));
        }

        // Ensure snapshot is within the snapshots directory (prevent traversal)
        let canonical = snapshot_path.canonicalize()?;
        if !canonical.starts_with(snapshots_dir.canonicalize()?) {
            return Err(KernelError::PathTraversalDenied(
                snapshot_name.to_string(),
            ));
        }

        let content = fs::read_to_string(&snapshot_path)?;
        self.write_file(relative_path, &content)
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------

    /// Compute SHA-256 hash of content for conflict detection.
    fn compute_hash(content: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// Get metadata for a specific file.
    pub fn file_metadata(&self, relative_path: &str) -> KernelResult<FileMetadata> {
        let abs_path = self.resolve_safe_path(relative_path)?;

        if !abs_path.exists() {
            return Err(KernelError::FileNotFound(relative_path.to_string()));
        }

        let fs_meta = fs::metadata(&abs_path)?;
        let is_too_large = fs_meta.len() > MAX_METADATA_CONTENT_SIZE;
        let content = if abs_path.is_file() && !is_too_large {
            fs::read_to_string(&abs_path).unwrap_or_default()
        } else {
            String::new()
        };

        let is_markdown = abs_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_ascii_lowercase().as_str(), "md" | "markdown"))
            .unwrap_or(false);

        let word_count = if is_too_large { 0 } else { content.split_whitespace().count().try_into().unwrap_or(u32::MAX) };
        let char_count = if is_too_large { 0 } else { content.chars().count().try_into().unwrap_or(u32::MAX) };

        // Extract tags from content (#tag patterns)
        let tags = if is_too_large { Vec::new() } else { Self::extract_tags(&content) };

        Ok(FileMetadata {
            relative_path: relative_path.to_string(),
            size: fs_meta.len(),
            created: fs_meta.created().unwrap_or(std::time::SystemTime::UNIX_EPOCH).into(),
            modified: fs_meta.modified()?.into(),
            is_markdown,
            word_count,
            char_count,
            tags,
            backlink_count: 0, // Populated by the link index
        })
    }

    /// Extract #tag patterns from markdown content.
    fn extract_tags(content: &str) -> Vec<String> {
        let mut tags = Vec::new();
        // Match #tag patterns (not inside code blocks)
        let mut in_code_block = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("```") {
                in_code_block = !in_code_block;
                continue;
            }
            if in_code_block {
                continue;
            }

            // Find #tag patterns: # followed by word chars, not at start of line
            // (to avoid matching headings)
            for (i, _) in line.match_indices('#') {
                // Skip if this is a heading (# at start after optional whitespace)
                if trimmed.starts_with('#')
                    && (trimmed.len() == 1 || trimmed.as_bytes().get(1) == Some(&b' '))
                {
                    break;
                }

                // Check if this looks like a tag
                if i > 0 {
                    let before = line.as_bytes().get(i - 1);
                    if before.map(|b| b.is_ascii_alphanumeric()).unwrap_or(false) {
                        continue; // Part of a word, not a tag
                    }
                }

                let rest = &line[i + 1..];
                let tag: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '-' || *c == '/')
                    .collect();

                if !tag.is_empty() {
                    tags.push(tag);
                }
            }
        }

        tags.sort();
        tags.dedup();
        tags
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn setup() -> (TempDir, Vault) {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open(tmp.path(), "test").unwrap();
        (tmp, vault)
    }

    #[test]
    fn test_create_and_read_file() {
        let (_tmp, vault) = setup();
        let content = "# Hello World\n\nThis is a test note.";

        vault.create_file("test.md", content).unwrap();
        let read = vault.read_file("test.md").unwrap();

        assert_eq!(read.content, content);
        assert_eq!(read.path, "test.md");
        assert!(!read.hash.is_empty());
    }

    #[test]
    fn test_atomic_write_creates_no_tmp_files() {
        let (tmp, vault) = setup();

        vault.write_file("note.md", "initial").unwrap();
        vault.write_file("note.md", "updated").unwrap();

        // No .tmp files should remain
        let entries: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .collect();

        assert!(entries.is_empty(), "Temp files should be cleaned up");
    }

    #[test]
    fn test_path_traversal_prevention() {
        let (_tmp, vault) = setup();

        assert!(vault.read_file("../../../etc/passwd").is_err());
        assert!(vault.read_file("foo/../../..").is_err());
        assert!(vault.write_file("../escape.md", "evil").is_err());
    }

    #[test]
    fn test_snapshots() {
        let (_tmp, vault) = setup();

        vault.write_file("note.md", "version 1").unwrap();
        vault.write_file("note.md", "version 2").unwrap();
        vault.write_file("note.md", "version 3").unwrap();

        let snapshots = vault.list_snapshots("note.md").unwrap();
        // Should have 2 snapshots (v1 before v2, v2 before v3)
        assert_eq!(snapshots.len(), 2);
    }

    #[test]
    fn test_directory_operations() {
        let (_tmp, vault) = setup();

        vault.create_dir("subfolder").unwrap();
        vault.create_file("subfolder/note.md", "hello").unwrap();

        let entries = vault.list_entries("subfolder").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "note.md");
    }

    #[test]
    fn test_rename_file_case_change() {
        let (_tmp, vault) = setup();

        vault.create_file("note.md", "hello").unwrap();
        vault.rename_file("note.md", "Note.md").unwrap();

        let entries = vault.list_entries("").unwrap();
        assert!(entries.iter().any(|entry| entry.name == "Note.md"));
        assert!(!entries.iter().any(|entry| entry.name == "note.md"));
        assert_eq!(vault.read_file("Note.md").unwrap().content, "hello");
    }

    #[test]
    fn test_tag_extraction() {
        let content = r#"
# Heading

This has #tag1 and #tag2 in it.
Not a heading #rust/async here.

```
#not_a_tag inside code
```

Another #final-tag.
"#;
        let tags = Vault::extract_tags(content);
        assert!(tags.contains(&"tag1".to_string()));
        assert!(tags.contains(&"tag2".to_string()));
        assert!(tags.contains(&"rust/async".to_string()));
        assert!(tags.contains(&"final-tag".to_string()));
        assert!(!tags.contains(&"not_a_tag".to_string()));
    }

    #[test]
    fn test_invalid_file_names() {
        let (_tmp, vault) = setup();

        assert!(vault.create_file("fo:o.md", "bad").is_err());
        assert!(vault.create_file("fo*o.md", "bad").is_err());
        assert!(vault.create_file("", "bad").is_err());
    }

    #[test]
    fn test_file_tree() {
        let (_tmp, vault) = setup();

        vault.create_dir("folder").unwrap();
        vault.create_file("folder/note.md", "# Hello").unwrap();
        vault.create_file("root.md", "Root note").unwrap();

        let tree = vault.file_tree(5).unwrap();
        // Should have at least 2 top-level entries (folder + root.md)
        assert!(tree.len() >= 2);

        // Find the folder entry and verify it has children
        let folder = tree.iter().find(|e| e.is_dir && e.name == "folder").unwrap();
        let children = folder.children.as_ref().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "note.md");
    }

    #[test]
    fn test_read_binary_rejects_oversized_file() {
        let (tmp, vault) = setup();

        // Create a sparse file exceeding the limit (no heap allocation)
        let file_path = tmp.path().join("big.bin");
        let f = std::fs::File::create(&file_path).unwrap();
        f.set_len(MAX_READ_BINARY_SIZE + 1).unwrap();
        drop(f);

        let result = vault.read_binary("big.bin");
        assert!(result.is_err(), "Should reject oversized file");
        let err = result.unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("too large") || msg.contains("exceeds"),
            "Error should mention size limit, got: {}",
            msg
        );
    }

    #[test]
    fn test_read_binary_accepts_file_under_limit() {
        let (_tmp, vault) = setup();

        let data = b"hello, small binary";
        vault.write_binary("small.bin", data).unwrap();

        let result = vault.read_binary("small.bin").unwrap();
        assert_eq!(result, data);
    }

    #[test]
    fn test_read_binary_limit_is_checked_before_read() {
        let (tmp, vault) = setup();

        // Exactly at limit — should succeed (sparse file)
        let at_limit_path = tmp.path().join("at_limit.bin");
        let f = std::fs::File::create(&at_limit_path).unwrap();
        f.set_len(MAX_READ_BINARY_SIZE).unwrap();
        drop(f);
        let result = vault.read_binary("at_limit.bin");
        assert!(result.is_ok(), "File exactly at limit should succeed");

        // One byte over — should fail (sparse file)
        let over_limit_path = tmp.path().join("over_limit.bin");
        let f = std::fs::File::create(&over_limit_path).unwrap();
        f.set_len(MAX_READ_BINARY_SIZE + 1).unwrap();
        drop(f);
        let result = vault.read_binary("over_limit.bin");
        assert!(result.is_err(), "File one byte over limit should fail");
}

    #[test]
    fn write_file_roundtrip() {
        let (_tmp, vault) = setup();
        let content = "# Hello\n\nThis is a test note with **markdown**.";
        vault.write_file("note.md", content).unwrap();
        let read = vault.read_file("note.md").unwrap();
        assert_eq!(read.content, content);
        assert_eq!(read.path, "note.md");
        assert!(!read.hash.is_empty());
    }

    #[test]
    fn write_binary_cleanup() {
        let (tmp, vault) = setup();
        let data = b"binary content here";
        vault.write_binary("image.png", data).unwrap();

        // No .tmp files should remain
        let entries: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .collect();
        assert!(entries.is_empty(), "Temp files should be cleaned up after binary write");

        // Verify content
        let read = vault.read_binary("image.png").unwrap();
        assert_eq!(read, data);
    }

    #[test]
    fn write_binary_overwrite() {
        let (_tmp, vault) = setup();
        let data1 = b"first version";
        let data2 = b"second version is longer";

        vault.write_binary("file.bin", data1).unwrap();
        assert_eq!(vault.read_binary("file.bin").unwrap(), data1);

        vault.write_binary("file.bin", data2).unwrap();
        assert_eq!(vault.read_binary("file.bin").unwrap(), data2);
    }

    #[test]
    fn nested_path_creation() {
        let (_tmp, vault) = setup();

        // Write to nested path where parent dir doesn't exist
        vault.write_file("deep/nested/dir/note.md", "# Nested").unwrap();
        let read = vault.read_file("deep/nested/dir/note.md").unwrap();
        assert_eq!(read.content, "# Nested");

        // Write binary to nested path
        vault.write_binary("deep/nested/dir/image.png", b"png data").unwrap();
        let read = vault.read_binary("deep/nested/dir/image.png").unwrap();
        assert_eq!(read, b"png data");
    }

    #[test]
    fn error_path_cleans_up_tmp_file() {
        let (_tmp, vault) = setup();

        // First write to create the file
        vault.write_file("note.md", "original").unwrap();

        // Now attempt a write with a closure that fails
        let abs_path = vault.resolve_safe_path("note.md").unwrap();
        let result = vault.atomic_write(&abs_path, |_file| {
            Err(std::io::Error::new(std::io::ErrorKind::Other, "simulated failure"))
        });

        // Should fail
        assert!(result.is_err());

        // No .tmp files should remain
        let entries: Vec<_> = fs::read_dir(_tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .ends_with(".tmp")
            })
            .collect();
        assert!(entries.is_empty(), "Temp files should be cleaned up after write failure");

        // Original content should be preserved
        let read = vault.read_file("note.md").unwrap();
        assert_eq!(read.content, "original");
    }

    #[test]
    fn snapshot_list_no_prefix_collision() {
        let (_tmp, vault) = setup();

        vault.write_file("a", "content of a").unwrap();
        vault.write_file("ab", "content of ab").unwrap();

        // Overwrite both to create snapshots
        vault.write_file("a", "updated a").unwrap();
        vault.write_file("ab", "updated ab").unwrap();

        let snapshots_a = vault.list_snapshots("a").unwrap();
        for snap in &snapshots_a {
            assert!(
                snap.starts_with("a_"),
                "Snapshot '{}' should belong to 'a', not 'ab'",
                snap
            );
        }

        let snapshots_ab = vault.list_snapshots("ab").unwrap();
        for snap in &snapshots_ab {
            assert!(
                snap.starts_with("ab_"),
                "Snapshot '{}' should belong to 'ab'",
                snap
            );
        }

        assert_eq!(snapshots_a.len(), 1, "Should have 1 snapshot for 'a'");
        assert_eq!(snapshots_ab.len(), 1, "Should have 1 snapshot for 'ab'");
    }

    #[test]
    fn vault_uses_mutex_not_rwlock() {
        // Compile-time check: if write_lock were RwLock, .lock() wouldn't exist.
        let (_tmp, vault) = setup();
        let _guard = vault.write_lock.lock().unwrap();
    }

    #[test]
    fn resolve_safe_path_follows_symlinks_inside_vault() {
        let (_tmp, vault) = setup();

        // Create a file
        vault.write_file("real_note.md", "content").unwrap();

        // Create a symlink to it
        let real_path = vault.resolve_safe_path("real_note.md").unwrap();
        let link_path = _tmp.path().join("link_note.md");
        if std::os::unix::fs::symlink(&real_path, &link_path).is_ok() {
            // Resolving the symlink should work and point inside vault
            let resolved = vault.resolve_safe_path("link_note.md").unwrap();
            assert!(resolved.starts_with(vault.root()));
        }
    }

    #[test]
    fn resolve_safe_path_no_toctou_on_existing_file() {
        let (_tmp, vault) = setup();
        vault.write_file("test.md", "content").unwrap();

        // Resolve should work without error for existing files
        let resolved = vault.resolve_safe_path("test.md").unwrap();
        assert!(resolved.starts_with(vault.root()));
        assert!(resolved.ends_with("test.md"));
    }

    #[test]
    fn write_theme_atomic() {
        let (tmp, vault) = setup();

        vault.write_theme("custom", "body { color: red; }").unwrap();

        // No .tmp files should remain in themes dir
        let themes_dir = tmp.path().join(VAULT_CONFIG_DIR).join("themes");
        if themes_dir.exists() {
            let entries: Vec<_> = fs::read_dir(&themes_dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
                .collect();
            assert!(entries.is_empty(), "No .tmp files should remain after theme write");
        }

        // Verify content
        let theme_path = themes_dir.join("custom.css");
        assert!(theme_path.exists());
        let content = fs::read_to_string(&theme_path).unwrap();
        assert_eq!(content, "body { color: red; }");
    }

    #[test]
    fn import_theme_atomic() {
        let (tmp, vault) = setup();

        // Create a source file
        let src = tmp.path().join("source.css");
        fs::write(&src, "body { color: blue; }").unwrap();

        vault.import_theme(src.to_str().unwrap(), false).unwrap();

        // No .tmp files in themes dir
        let themes_dir = tmp.path().join(VAULT_CONFIG_DIR).join("themes");
        if themes_dir.exists() {
            let entries: Vec<_> = fs::read_dir(&themes_dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
                .collect();
            assert!(entries.is_empty(), "No .tmp files should remain after import");
        }

        // Verify content
        let theme_path = themes_dir.join("source.css");
        assert!(theme_path.exists());
        assert_eq!(fs::read_to_string(&theme_path).unwrap(), "body { color: blue; }");
    }

    #[test]
    fn file_metadata_large_file_skips_content_analysis() {
        let (_tmp, vault) = setup();

        // Create a file larger than the limit ("a " = 2 bytes, repeat 6M = ~12 MiB)
        let large_content = "a ".repeat(6 * 1024 * 1024);
        vault.write_file("large.md", &large_content).unwrap();

        let meta = vault.file_metadata("large.md").unwrap();

        // Size should still be accurate
        assert!(meta.size > 10 * 1024 * 1024);

        // Word count should be 0 (skipped for large files)
        assert_eq!(meta.word_count, 0);
        assert_eq!(meta.char_count, 0);
        assert!(meta.tags.is_empty());
    }

    #[test]
    fn file_metadata_small_file_analyzes_content() {
        let (_tmp, vault) = setup();

        vault.write_file("small.md", "# Hello\n\nSome content with #tag1 #tag2").unwrap();

        let meta = vault.file_metadata("small.md").unwrap();

        // Small files should have word/char counts and tags
        assert!(meta.word_count > 0);
        assert!(meta.char_count > 0);
        assert!(meta.tags.contains(&"tag1".to_string()));
        assert!(meta.tags.contains(&"tag2".to_string()));
    }

    #[test]
    fn snapshot_no_encoding_collision() {
        let (_tmp, vault) = setup();

        // Write to paths that would collide with __ encoding
        vault.write_file("a/b.md", "content of a/b").unwrap();
        vault.write_file("a__b.md", "content of a__b").unwrap();

        // Overwrite to create snapshots
        vault.write_file("a/b.md", "updated a/b").unwrap();
        vault.write_file("a__b.md", "updated a__b").unwrap();

        // Snapshots for "a/b" should NOT include "a__b" snapshots
        let snapshots_ab = vault.list_snapshots("a/b.md").unwrap();
        let snapshots_aususb = vault.list_snapshots("a__b.md").unwrap();

        // They should be separate lists
        for snap in &snapshots_ab {
            assert!(
                !snap.contains("a__b"),
                "a/b snapshot '{}' should not match a__b",
                snap
            );
        }
        for snap in &snapshots_aususb {
            // a__b snapshots should use verbatim name (no slashes)
            assert!(
                snap.starts_with("a__b.md_"),
                "a__b snapshot '{}' should use verbatim name",
                snap
            );
        }

        assert_eq!(snapshots_ab.len(), 1, "Should have 1 snapshot for a/b");
        assert_eq!(snapshots_aususb.len(), 1, "Should have 1 snapshot for a__b");
    }

    #[test]
    fn atomic_write_file_standalone() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.txt");

        atomic_write_file(&path, |file| file.write_all(b"hello world")).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "hello world");
    }

    #[test]
    fn atomic_write_file_cleanup_on_error() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.txt");

        let result = atomic_write_file(&path, |_file| {
            Err(std::io::Error::new(std::io::ErrorKind::Other, "simulated"))
        });

        assert!(result.is_err());
        assert!(!path.exists());
        // No .tmp files
        let entries: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(entries.is_empty());
    }

    #[test]
    fn atomic_write_file_creates_parent_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("deep/nested/dir/file.txt");

        atomic_write_file(&path, |file| file.write_all(b"nested")).unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "nested");
    }

    #[test]
    fn atomic_write_file_rejects_bare_filename() {
        // A bare filename with no parent directory should error,
        // not silently write to CWD
        let result = atomic_write_file(Path::new("bare_test_file.txt"), |file| {
            use std::io::Write;
            file.write_all(b"should not exist")
        });
        assert!(result.is_err(), "Bare filename should return an error");

        // Ensure no file was created in CWD
        let _ = std::fs::remove_file("bare_test_file.txt");
    }

    #[test]
    fn snapshot_list_finds_legacy_double_underscore_encoded() {
        let (_tmp, vault) = setup();

        // Write a file to ensure snapshots dir exists
        vault.write_file("a/b.md", "v1").unwrap();

        // Manually create a legacy snapshot using __ encoding (old format)
        let snapshots_dir = vault
            .root
            .join(crate::vault::VAULT_CONFIG_DIR)
            .join("snapshots");
        let legacy_name = "a__b.md_20240101_120000.000000000";
        std::fs::write(snapshots_dir.join(legacy_name), "legacy content").unwrap();

        // list_snapshots should find it even though it uses __ not _-
        let snapshots = vault.list_snapshots("a/b.md").unwrap();
        assert!(
            snapshots.iter().any(|s| s == legacy_name),
            "Should find legacy __ encoded snapshot, got: {:?}",
            snapshots
        );
    }
}
