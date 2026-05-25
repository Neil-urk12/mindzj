pub mod error;
pub mod links;
pub mod plugins;
pub mod search;
pub mod types;
pub mod vault;

// Re-export error types at crate root for convenience
pub use error::{KernelError, KernelResult};

use crate::links::LinkIndex;
use crate::search::SearchIndex;
use crate::types::{AppSettings, HotkeyBinding, VaultEntry, WorkspaceState};
use crate::vault::Vault;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tracing::info;

// ---------------------------------------------------------------------------
// Per-vault state bundle
// ---------------------------------------------------------------------------

/// Holds all state for a single open vault: file manager, indexes, settings.
/// Shared across windows that display the same vault via `Arc`.
pub struct VaultContext {
    pub vault: Vault,
    pub link_index: Mutex<LinkIndex>,
    pub search_index: Mutex<SearchIndex>,
    pub settings: RwLock<AppSettings>,
}

impl VaultContext {
    pub fn new(vault: Vault) -> Self {
        Self {
            vault,
            link_index: Mutex::new(LinkIndex::new()),
            search_index: Mutex::new(SearchIndex::new()),
            settings: RwLock::new(AppSettings::default()),
        }
    }

    pub fn mindzj_dir(&self) -> PathBuf {
        self.vault.root().join(".mindzj")
    }

    pub fn ensure_mindzj_dir(&self) -> KernelResult<PathBuf> {
        let dir = self.mindzj_dir();
        if !dir.exists() {
            std::fs::create_dir_all(&dir)?;
        }
        Ok(dir)
    }

    // -- Settings persistence ------------------------------------------------

    pub fn load_settings(&self) -> KernelResult<()> {
        let path = self.mindzj_dir().join("settings.json");
        if path.exists() {
            let content = std::fs::read_to_string(&path)?;
            if let Ok(loaded) = serde_json::from_str::<AppSettings>(&content) {
                if let Ok(mut s) = self.settings.write() {
                    *s = loaded;
                    info!("Settings loaded from {:?}", path);
                }
            }
        }
        Ok(())
    }

    pub fn save_settings(&self) -> KernelResult<()> {
        let dir = self.ensure_mindzj_dir()?;
        let s = self.settings.read().map_err(|_| {
            KernelError::Io(std::io::Error::other("Settings lock poisoned"))
        })?;
        let json = serde_json::to_string_pretty(&*s)?;
        std::fs::write(dir.join("settings.json"), json)?;
        Ok(())
    }

    // -- Workspace persistence -----------------------------------------------

    pub fn load_workspace(&self) -> KernelResult<WorkspaceState> {
        let p = self.mindzj_dir().join("workspace.json");
        if p.exists() {
            let c = std::fs::read_to_string(&p)?;
            if let Ok(ws) = serde_json::from_str::<WorkspaceState>(&c) {
                return Ok(ws);
            }
        }
        Ok(WorkspaceState::default())
    }

    pub fn save_workspace(&self, ws: &WorkspaceState) -> KernelResult<()> {
        let dir = self.ensure_mindzj_dir()?;
        let json = serde_json::to_string_pretty(ws)?;
        std::fs::write(dir.join("workspace.json"), json)?;
        Ok(())
    }

    // -- Hotkey persistence --------------------------------------------------

    pub fn load_hotkeys(&self) -> KernelResult<Vec<HotkeyBinding>> {
        let p = self.mindzj_dir().join("hotkeys.json");
        if p.exists() {
            let c = std::fs::read_to_string(&p)?;
            if let Ok(b) = serde_json::from_str::<Vec<HotkeyBinding>>(&c) {
                return Ok(b);
            }
        }
        Ok(Vec::new())
    }

    pub fn save_hotkeys(&self, bindings: &[HotkeyBinding]) -> KernelResult<()> {
        let dir = self.ensure_mindzj_dir()?;
        let json = serde_json::to_string_pretty(bindings)?;
        std::fs::write(dir.join("hotkeys.json"), json)?;
        Ok(())
    }

    // -- Index updates -------------------------------------------------------

    pub fn on_file_changed(&self, path: &str, content: &str) {
        if let Ok(mut li) = self.link_index.lock() {
            li.update_file_links(path, content);
        }
        if let Ok(mut si) = self.search_index.lock() {
            si.index_document(path, content);
        }
    }

    pub fn on_file_deleted(&self, path: &str) {
        if let Ok(mut li) = self.link_index.lock() {
            li.remove_file(path);
        }
        if let Ok(mut si) = self.search_index.lock() {
            si.remove_document(path);
        }
    }

    // -- Index building ------------------------------------------------------

    pub fn build_indexes(&self) -> KernelResult<()> {
        let entries = self.vault.file_tree(10)?;

        let mut li = self.link_index.lock().map_err(|_| {
            KernelError::Io(std::io::Error::other("Link index lock poisoned"))
        })?;

        let mut si = self.search_index.lock().map_err(|_| {
            KernelError::Io(std::io::Error::other("Search index lock poisoned"))
        })?;

        Self::index_entries_recursive(&self.vault, &entries, &mut li, &mut si)?;

        info!(
            "Indexes built: {} documents in search index",
            si.document_count()
        );
        Ok(())
    }

    fn index_entries_recursive(
        vault: &Vault,
        entries: &[VaultEntry],
        li: &mut LinkIndex,
        si: &mut SearchIndex,
    ) -> KernelResult<()> {
        for entry in entries {
            if entry.is_dir {
                if let Some(ref children) = entry.children {
                    Self::index_entries_recursive(vault, children, li, si)?;
                }
            } else if entry.extension == "md" {
                match vault.read_file(&entry.relative_path) {
                    Ok(fc) => {
                        li.register_file(&entry.relative_path);
                        li.update_file_links(&entry.relative_path, &fc.content);
                        si.index_document(&entry.relative_path, &fc.content);
                    }
                    Err(err) => {
                        tracing::warn!("Failed to read '{}': {}", entry.relative_path, err);
                    }
                }
            }
        }
        Ok(())
    }
}

/// Helper: create a `VaultContext` from a vault path, build indexes, load settings.
pub fn open_vault_context(path: &std::path::Path, name: &str) -> KernelResult<Arc<VaultContext>> {
    let vault = Vault::open(path, name)?;
    let ctx = Arc::new(VaultContext::new(vault));
    ctx.build_indexes()?;
    let _ = ctx.load_settings();
    Ok(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tracing_test::traced_test;

    /// Write raw bytes directly to a file inside the vault,
    /// bypassing `Vault::write_file` (which validates UTF-8 via
    /// `serde_json` / `fs::write`).
    fn write_raw_bytes(vault: &Vault, relative: &str, bytes: &[u8]) {
        let abs = vault.root().join(relative);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&abs, bytes).unwrap();
    }

    /// When `vault.read_file()` fails for an `.md` file,
    /// `index_entries_recursive` should log a warning instead of
    /// silently swallowing the error.
    #[test]
    #[traced_test]
    fn index_entries_recursive_logs_warning_on_read_failure() {
        let tmp = TempDir::new().unwrap();
        let vault = Vault::open(tmp.path(), "test-vault").unwrap();

        // Valid file — should be indexed normally.
        vault.create_file("good.md", "# Hello\n").unwrap();

        // File with invalid UTF-8 bytes. `fs::read_to_string` will
        // return `Err` when called on this, so `read_file` fails.
        write_raw_bytes(&vault, "bad.md", b"\xff\xfe not valid utf8");

        // Build the file tree the same way `build_indexes` does.
        let entries = vault.file_tree(10).unwrap();

        // Index using the private helper.
        let mut li = LinkIndex::new();
        let mut si = SearchIndex::new();
        VaultContext::index_entries_recursive(&vault, &entries, &mut li, &mut si)
            .unwrap();

        // The valid file should have been indexed.
        assert!(
            !si.search(&crate::types::SearchQuery {
                text: "Hello".to_string(),
                limit: 10,
                extension_filter: None,
                path_filter: None,
            })
            .unwrap()
            .is_empty(),
            "good.md should be in the search index"
        );

        // Verify warning is emitted when read_file fails for bad.md.
        assert!(
            logs_contain("bad.md"),
            "Expected a warning log mentioning bad.md when read_file fails, \
             but none was emitted. Add a warn! in the else branch of \
             index_entries_recursive for the read_file call."
        );
    }
}
