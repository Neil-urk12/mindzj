use crate::error::{KernelError, KernelResult};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Obsidian-compatible plugin manifest (manifest.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default, rename = "authorUrl")]
    pub author_url: String,
    #[serde(default, rename = "minAppVersion")]
    pub min_app_version: String,
    #[serde(default, rename = "isDesktopOnly")]
    pub is_desktop_only: bool,
}

/// Plugin info returned to callers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub has_styles: bool,
    pub dir_path: String,
    /// Whether this is a built-in core plugin (always enabled, not deletable)
    #[serde(default)]
    pub is_core: bool,
}

/// Core plugins that are always enabled by default
const CORE_PLUGIN_IDS: &[&str] = &[""];

// ---------------------------------------------------------------------------
// Plugin filesystem operations
// ---------------------------------------------------------------------------

/// Validate a plugin ID to prevent path traversal and injection attacks.
/// Only allows alphanumeric characters, dots, hyphens, and underscores.
/// Rejects empty strings, `.` and `..`.
fn validate_plugin_id(id: &str) -> Result<(), KernelError> {
    if id.is_empty() || id == "." || id == ".."
        || id.contains('/') || id.contains('\\') || id.contains('\0')
        || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err(KernelError::InvalidInput(format!("Invalid plugin id: {:?}", id)));
    }
    Ok(())
}
/// Find a plugin directory by ID. Searches `.mindzj/plugins/` for a folder
/// whose `manifest.json` has a matching `id` field, or an exact folder name match.
pub fn find_plugin_dir(vault_root: &Path, plugin_id: &str) -> KernelResult<Option<std::path::PathBuf>> {
    validate_plugin_id(plugin_id)?;
    let plugins_dir = vault_root.join(".mindzj").join("plugins");
    if !plugins_dir.exists() {
        return Ok(None);
    }

    // Fast path: folder name exactly matches the requested id.
    let exact = plugins_dir.join(plugin_id);
    if exact.is_dir() {
        return Ok(Some(exact));
    }

    let entries = match std::fs::read_dir(&plugins_dir) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&manifest_path) {
            Ok(content) => content,
            Err(_) => continue,
        };

        let manifest = match serde_json::from_str::<PluginManifest>(&content) {
            Ok(manifest) => manifest,
            Err(_) => continue,
        };

        if manifest.id == plugin_id {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

/// Read the enabled plugins list from `.mindzj/plugins.json`.
pub fn read_enabled_plugins(vault_root: &Path) -> Vec<String> {
    let config_path = vault_root.join(".mindzj").join("plugins.json");
    if !config_path.exists() {
        return Vec::new();
    }
    match std::fs::read_to_string(&config_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Write the enabled plugins list to `.mindzj/plugins.json`.
pub fn write_enabled_plugins(vault_root: &Path, plugins: &[String]) -> KernelResult<()> {
    let mindzj_dir = vault_root.join(".mindzj");
    if !mindzj_dir.exists() {
        std::fs::create_dir_all(&mindzj_dir)?;
    }
    let config_path = mindzj_dir.join("plugins.json");
    let content = serde_json::to_string_pretty(plugins)?;
    std::fs::write(&config_path, content)?;
    Ok(())
}

/// List all installed plugins from `.mindzj/plugins/`.
pub fn list_plugins(vault_root: &Path) -> KernelResult<Vec<PluginInfo>> {
    let plugins_dir = vault_root.join(".mindzj").join("plugins");

    if !plugins_dir.exists() {
        return Ok(Vec::new());
    }

    let mut plugins = Vec::new();

    let entries = std::fs::read_dir(&plugins_dir)?;

    // Read enabled plugins list
    let mut enabled_plugins = read_enabled_plugins(vault_root);

    // Auto-enable core plugins if not already in the list
    let mut core_added = false;
    for &core_id in CORE_PLUGIN_IDS {
        if !enabled_plugins.contains(&core_id.to_string()) {
            enabled_plugins.push(core_id.to_string());
            core_added = true;
        }
    }
    if core_added {
        let _ = write_enabled_plugins(vault_root, &enabled_plugins);
    }

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        match std::fs::read_to_string(&manifest_path) {
            Ok(content) => match serde_json::from_str::<PluginManifest>(&content) {
                Ok(manifest) => {
                    let is_core = CORE_PLUGIN_IDS.contains(&manifest.id.as_str());
                    let enabled = is_core || enabled_plugins.contains(&manifest.id);
                    let has_styles = path.join("styles.css").exists();
                    plugins.push(PluginInfo {
                        dir_path: path.to_string_lossy().to_string(),
                        manifest,
                        enabled,
                        has_styles,
                        is_core,
                    });
                }
                Err(e) => {
                    tracing::warn!(
                        "Invalid plugin manifest at {:?}: {}",
                        manifest_path,
                        e
                    );
                }
            },
            Err(e) => {
                tracing::warn!(
                    "Failed to read plugin manifest {:?}: {}",
                    manifest_path,
                    e
                );
            }
        }
    }

    plugins.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Ok(plugins)
}

/// Toggle a plugin's enabled state.
pub fn toggle_plugin(vault_root: &Path, plugin_id: &str, enabled: bool) -> KernelResult<()> {
    validate_plugin_id(plugin_id)?;
    let mut enabled_plugins = read_enabled_plugins(vault_root);

    if enabled {
        if !enabled_plugins.contains(&plugin_id.to_string()) {
            enabled_plugins.push(plugin_id.to_string());
        }
    } else {
        enabled_plugins.retain(|id| id != plugin_id);
    }

    write_enabled_plugins(vault_root, &enabled_plugins)
}

/// Delete a plugin from the filesystem.
pub fn delete_plugin(vault_root: &Path, plugin_id: &str) -> KernelResult<()> {
    validate_plugin_id(plugin_id)?;
    let plugin_dir = find_plugin_dir(vault_root, plugin_id)?.unwrap_or_else(|| {
        vault_root
            .join(".mindzj")
            .join("plugins")
            .join(plugin_id)
    });

    if plugin_dir.exists() {
        std::fs::remove_dir_all(&plugin_dir)?;
    }

    // Remove from enabled list
    let mut enabled = read_enabled_plugins(vault_root);
    enabled.retain(|id| id != plugin_id);
    let _ = write_enabled_plugins(vault_root, &enabled);

    Ok(())
}

/// Read the plugin main.js file content.
pub fn read_plugin_main(vault_root: &Path, plugin_id: &str) -> KernelResult<String> {
    validate_plugin_id(plugin_id)?;
    let plugin_dir = find_plugin_dir(vault_root, plugin_id)?.ok_or_else(|| {
        KernelError::FileNotFound(format!("Plugin directory not found for '{}'", plugin_id))
    })?;
    let main_path = plugin_dir.join("main.js");
    Ok(std::fs::read_to_string(&main_path)?)
}

/// Read plugin styles.css content. Returns empty string if no styles.
pub fn read_plugin_styles(vault_root: &Path, plugin_id: &str) -> KernelResult<String> {
    validate_plugin_id(plugin_id)?;
    let plugin_dir = find_plugin_dir(vault_root, plugin_id)?.ok_or_else(|| {
        KernelError::FileNotFound(format!("Plugin directory not found for '{}'", plugin_id))
    })?;
    let styles_path = plugin_dir.join("styles.css");

    if styles_path.exists() {
        Ok(std::fs::read_to_string(&styles_path)?)
    } else {
        Ok(String::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_vault() -> TempDir {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".mindzj/plugins")).unwrap();
        tmp
    }

    #[test]
    fn test_read_write_enabled_plugins() {
        let tmp = setup_vault();
        let root = tmp.path();

        let plugins = vec!["plugin-a".to_string(), "plugin-b".to_string()];
        write_enabled_plugins(root, &plugins).unwrap();

        let read_back = read_enabled_plugins(root);
        assert_eq!(read_back, plugins);
    }

    #[test]
    fn test_list_plugins() {
        let tmp = setup_vault();
        let root = tmp.path();

        // Create a plugin directory with manifest
        let plugin_dir = root.join(".mindzj/plugins/test-plugin");
        std::fs::create_dir_all(&plugin_dir).unwrap();

        let manifest = serde_json::json!({
            "id": "test-plugin",
            "name": "Test Plugin",
            "version": "1.0.0"
        });
        std::fs::write(
            plugin_dir.join("manifest.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        // Enable the plugin
        write_enabled_plugins(root, &["test-plugin".to_string()]).unwrap();

        let plugins = list_plugins(root).unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0].manifest.id, "test-plugin");
        assert!(plugins[0].enabled);
    }

    #[test]
    fn test_toggle_plugin() {
        let tmp = setup_vault();
        let root = tmp.path();

        // Initially empty
        let enabled = read_enabled_plugins(root);
        assert!(enabled.is_empty());

        // Enable
        toggle_plugin(root, "my-plugin", true).unwrap();
        let enabled = read_enabled_plugins(root);
        assert_eq!(enabled, vec!["my-plugin".to_string()]);

        // Disable
        toggle_plugin(root, "my-plugin", false).unwrap();
        let enabled = read_enabled_plugins(root);
        assert!(enabled.is_empty());
    }

    #[test]
    fn test_delete_plugin() {
        let tmp = setup_vault();
        let root = tmp.path();

        // Create a plugin
        let plugin_dir = root.join(".mindzj/plugins/to-delete");
        std::fs::create_dir_all(&plugin_dir).unwrap();

        let manifest = serde_json::json!({
            "id": "to-delete",
            "name": "Delete Me",
            "version": "1.0.0"
        });
        std::fs::write(
            plugin_dir.join("manifest.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        write_enabled_plugins(root, &["to-delete".to_string()]).unwrap();

        // Delete
        delete_plugin(root, "to-delete").unwrap();

        // Directory should be gone
        assert!(!plugin_dir.exists());

        // Should be removed from enabled list
        let enabled = read_enabled_plugins(root);
        assert!(enabled.is_empty());
    }

    #[test]
    fn test_validate_plugin_id_valid() {
        assert!(validate_plugin_id("my-plugin").is_ok());
        assert!(validate_plugin_id("plugin_name").is_ok());
        assert!(validate_plugin_id("plugin.name").is_ok());
        assert!(validate_plugin_id("Plugin123").is_ok());
        assert!(validate_plugin_id("a").is_ok());
    }

    #[test]
    fn test_validate_plugin_id_rejects_path_traversal() {
        assert!(validate_plugin_id("../evil").is_err());
        assert!(validate_plugin_id("..\\evil").is_err());
        assert!(validate_plugin_id("good/../evil").is_err());
        assert!(validate_plugin_id(".").is_err());
        assert!(validate_plugin_id("..").is_err());
        assert!(validate_plugin_id("").is_err());
        assert!(validate_plugin_id("has space").is_err());
        assert!(validate_plugin_id("has/slash").is_err());
        assert!(validate_plugin_id("null\0injection").is_err());
    }
}
