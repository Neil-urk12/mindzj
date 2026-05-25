pub mod error;
pub mod watcher;

// Re-export everything from the shared kernel crate
pub use mindzj_kernel::*;

// Explicit submodule re-exports so `crate::kernel::types::*` paths resolve.
// `pub use mindzj_kernel::*` already re-exports these modules, but explicit
// declarations make the intent clear and prevent accidental shadowing.
pub use mindzj_kernel::links;
pub use mindzj_kernel::search;
pub use mindzj_kernel::types;
pub use mindzj_kernel::vault;

use crate::kernel::error::CommandError;
use crate::kernel::watcher::VaultWatcher;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tracing::info;
use mindzj_kernel::types::VaultInfo;
use mindzj_kernel::vault::Vault;

// ---------------------------------------------------------------------------
// Central application state (shared across all Tauri windows)
// ---------------------------------------------------------------------------

/// Central application state shared across all Tauri commands.
///
/// Supports multiple simultaneous vaults — each Tauri window is mapped to
#[derive(Default)]
pub struct AppState {
    /// Open vaults keyed by canonicalized path string.
    pub vaults: RwLock<HashMap<String, Arc<VaultContext>>>,
    /// Window label -> vault path key mapping.
    pub window_vault_map: RwLock<HashMap<String, String>>,
    /// Recently opened vaults.
    pub recent_vaults: std::sync::Mutex<Vec<VaultInfo>>,
    /// Per-vault file watcher handles.
    pub watchers: RwLock<HashMap<String, Arc<std::sync::Mutex<Option<VaultWatcher>>>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Open a vault and associate it with the calling window.
    pub fn open_vault(
        &self,
        path: std::path::PathBuf,
        name: &str,
        window_label: &str,
    ) -> KernelResult<(VaultInfo, Arc<VaultContext>)> {
        let vault = Vault::open(&path, name)?;
        let vault_info = vault.info().clone();
        let key = vault.root().to_string_lossy().to_string();

        // Reuse existing context if the same vault is already open
        {
            let vaults = self.vaults.read().map_err(|_| {
                KernelError::Io(std::io::Error::other("Vaults lock poisoned"))
            })?;
            if let Some(ctx) = vaults.get(&key) {
                let mut map = self.window_vault_map.write().map_err(|_| {
                    KernelError::Io(std::io::Error::other("Window map lock poisoned"))
                })?;
                map.insert(window_label.to_string(), key);
                return Ok((vault_info, ctx.clone()));
            }
        }

        // Create new vault context
        let ctx = Arc::new(VaultContext::new(vault));

        // Build indexes from vault content
        ctx.build_indexes()?;

        // Load per-vault settings
        let _ = ctx.load_settings();

        // Store the vault context
        {
            let mut vaults = self.vaults.write().map_err(|_| {
                KernelError::Io(std::io::Error::other("Vaults lock poisoned"))
            })?;
            vaults.insert(key.clone(), ctx.clone());
        }

        // Map this window to the vault
        {
            let mut map = self.window_vault_map.write().map_err(|_| {
                KernelError::Io(std::io::Error::other("Window map lock poisoned"))
            })?;
            map.insert(window_label.to_string(), key.clone());
        }

        // Initialize watcher slot
        {
            let mut watchers = self.watchers.write().map_err(|_| {
                KernelError::Io(std::io::Error::other("Watchers lock poisoned"))
            })?;
            watchers.insert(key.clone(), Arc::new(std::sync::Mutex::new(None)));
        }

        // Add to recent vaults
        if let Ok(mut recent) = self.recent_vaults.lock() {
            recent.retain(|v| v.path != vault_info.path);
            recent.insert(0, vault_info.clone());
            if recent.len() > 10 {
                recent.truncate(10);
            }
        }

        info!("Vault opened and indexed: {}", name);
        Ok((vault_info, ctx))
    }

    /// Look up the vault context for the window that issued the command.
    pub fn get_vault_context(
        &self,
        window_label: &str,
    ) -> Result<Arc<VaultContext>, CommandError> {
        let map = self.window_vault_map.read().map_err(|_| CommandError {
            code: "LOCK_ERROR".into(),
            message: "Failed to acquire window map lock".into(),
        })?;

        let vault_path = map.get(window_label).ok_or(CommandError {
            code: "NO_VAULT".into(),
            message: format!("No vault associated with window '{}'", window_label),
        })?;

        let vaults = self.vaults.read().map_err(|_| CommandError {
            code: "LOCK_ERROR".into(),
            message: "Failed to acquire vaults lock".into(),
        })?;

        vaults.get(vault_path).cloned().ok_or(CommandError {
            code: "NO_VAULT".into(),
            message: "Vault context not found".into(),
        })
    }

    /// Get the watcher for a vault.
    pub fn get_watcher(
        &self,
        vault_key: &str,
    ) -> Option<Arc<std::sync::Mutex<Option<VaultWatcher>>>> {
        self.watchers
            .read()
            .ok()
            .and_then(|w| w.get(vault_key).cloned())
    }
}
