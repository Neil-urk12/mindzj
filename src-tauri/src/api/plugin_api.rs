use crate::kernel::error::CommandError;
use crate::kernel::AppState;
use mindzj_kernel::plugins::{self, PluginInfo};
use tauri::State;

#[tauri::command]
pub async fn list_plugins(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Result<Vec<PluginInfo>, CommandError> {
    let ctx = state.get_vault_context(window.label())?;
    Ok(plugins::list_plugins(ctx.vault.root())?)
}

#[tauri::command]
pub async fn toggle_plugin(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    plugin_id: String,
    enabled: bool,
) -> Result<(), CommandError> {
    let ctx = state.get_vault_context(window.label())?;
    Ok(plugins::toggle_plugin(ctx.vault.root(), &plugin_id, enabled)?)
}

#[tauri::command]
pub async fn delete_plugin(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    plugin_id: String,
) -> Result<(), CommandError> {
    let ctx = state.get_vault_context(window.label())?;
    Ok(plugins::delete_plugin(ctx.vault.root(), &plugin_id)?)
}

#[tauri::command]
pub async fn read_plugin_main(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    plugin_id: String,
) -> Result<String, CommandError> {
    let ctx = state.get_vault_context(window.label())?;
    Ok(plugins::read_plugin_main(ctx.vault.root(), &plugin_id)?)
}

#[tauri::command]
pub async fn read_plugin_styles(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
    plugin_id: String,
) -> Result<String, CommandError> {
    let ctx = state.get_vault_context(window.label())?;
    Ok(plugins::read_plugin_styles(ctx.vault.root(), &plugin_id)?)
}
