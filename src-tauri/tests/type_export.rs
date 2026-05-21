use mindzj_lib::kernel::types::*;
use std::path::PathBuf;
use ts_rs::TS;

fn bindings_dir() -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    dir.push("bindings");
    dir
}

/// Export all types to bindings/ directory.
#[test]
fn export_all_types() {
    let dir = bindings_dir();
    std::fs::create_dir_all(&dir).unwrap();

    VaultInfo::export_to(dir.join("VaultInfo.ts")).unwrap();
    VaultEntry::export_to(dir.join("VaultEntry.ts")).unwrap();
    FileMetadata::export_to(dir.join("FileMetadata.ts")).unwrap();
    FileEvent::export_to(dir.join("FileEvent.ts")).unwrap();
    NoteLink::export_to(dir.join("NoteLink.ts")).unwrap();
    LinkType::export_to(dir.join("LinkType.ts")).unwrap();
    GraphData::export_to(dir.join("GraphData.ts")).unwrap();
    GraphNode::export_to(dir.join("GraphNode.ts")).unwrap();
    GraphEdge::export_to(dir.join("GraphEdge.ts")).unwrap();
    SearchQuery::export_to(dir.join("SearchQuery.ts")).unwrap();
    SearchResult::export_to(dir.join("SearchResult.ts")).unwrap();
    SearchSnippet::export_to(dir.join("SearchSnippet.ts")).unwrap();
    FileContent::export_to(dir.join("FileContent.ts")).unwrap();
    OutlineHeading::export_to(dir.join("OutlineHeading.ts")).unwrap();
    AppSettings::export_to(dir.join("AppSettings.ts")).unwrap();
    NewNoteLocation::export_to(dir.join("NewNoteLocation.ts")).unwrap();
    WorkspaceState::export_to(dir.join("WorkspaceState.ts")).unwrap();
    HotkeyBinding::export_to(dir.join("HotkeyBinding.ts")).unwrap();
    ViewMode::export_to(dir.join("ViewMode.ts")).unwrap();
    AiProviderConfig::export_to(dir.join("AiProviderConfig.ts")).unwrap();
    AiSkill::export_to(dir.join("AiSkill.ts")).unwrap();
    AiProviderType::export_to(dir.join("AiProviderType.ts")).unwrap();
    GlobalWindowState::export_to(dir.join("GlobalWindowState.ts")).unwrap();

    // Verify files exist
    assert!(dir.join("VaultInfo.ts").exists(), "VaultInfo.ts not generated");
    assert!(dir.join("AppSettings.ts").exists(), "AppSettings.ts not generated");
    assert!(dir.join("ViewMode.ts").exists(), "ViewMode.ts not generated");
}

/// Verify ts-rs generates correct TypeScript for VaultInfo.
#[test]
fn vault_info_generates_typescript() {
    let ts = VaultInfo::export_to_string().expect("TS export failed");
    assert!(ts.contains("VaultInfo"), "missing type name, got:\n{ts}");
    assert!(ts.contains("name:"), "missing name field, got:\n{ts}");
    assert!(ts.contains("string"), "missing string type, got:\n{ts}");
    assert!(ts.contains("path:"), "missing path field, got:\n{ts}");
    assert!(ts.contains("created_at:"), "missing created_at field, got:\n{ts}");
    assert!(ts.contains("last_opened:"), "missing last_opened field, got:\n{ts}");
}

#[test]
fn vault_entry_generates_typescript() {
    let ts = VaultEntry::export_to_string().expect("TS export failed");
    assert!(ts.contains("VaultEntry"), "missing type name, got:\n{ts}");
    assert!(ts.contains("relative_path:"), "missing relative_path, got:\n{ts}");
    assert!(ts.contains("is_dir:"), "missing is_dir, got:\n{ts}");
}

#[test]
fn view_mode_kebab_case() {
    let ts = ViewMode::export_to_string().expect("TS export failed");
    assert!(ts.contains("source"), "missing source variant, got:\n{ts}");
    assert!(ts.contains("live-preview"), "missing live-preview variant, got:\n{ts}");
    assert!(ts.contains("reading"), "missing reading variant, got:\n{ts}");
    // Must NOT contain PascalCase variants
    assert!(!ts.contains("LivePreview"), "should not contain PascalCase LivePreview, got:\n{ts}");
}

#[test]
fn view_mode_deserializes_legacy_pascal_case() {
    // Legacy settings.json has "LivePreview" (PascalCase)
    let mut settings = AppSettings::default();
    settings.default_view_mode = ViewMode::LivePreview;
    let mut json = serde_json::to_string(&settings).unwrap();
    // Mutate to PascalCase to simulate legacy format
    json = json.replace("\"live-preview\"", "\"LivePreview\"");
    let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.default_view_mode, ViewMode::LivePreview);
}

#[test]
fn view_mode_deserializes_kebab_case() {
    // New settings.json has "live-preview" (kebab-case)
    let mut settings = AppSettings::default();
    settings.default_view_mode = ViewMode::LivePreview;
    let json = serde_json::to_string(&settings).unwrap();
    let deserialized: AppSettings = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.default_view_mode, ViewMode::LivePreview);
}

#[test]
fn view_mode_serializes_kebab_case() {
    let settings = AppSettings {
        default_view_mode: ViewMode::LivePreview,
        ..Default::default()
    };
    let json = serde_json::to_string(&settings).unwrap();
    assert!(json.contains("\"live-preview\""), "should serialize as kebab-case, got:\n{json}");
    assert!(!json.contains("LivePreview"), "should NOT serialize as PascalCase, got:\n{json}");
}

#[test]
fn app_settings_generates_typescript() {
    let ts = AppSettings::export_to_string().expect("TS export failed");
    assert!(ts.contains("AppSettings"), "missing type name, got:\n{ts}");
    assert!(ts.contains("theme:"), "missing theme field, got:\n{ts}");
    assert!(ts.contains("ai_provider:"), "missing ai_provider field, got:\n{ts}");
}

#[test]
fn ai_provider_config_generates_typescript() {
    let ts = AiProviderConfig::export_to_string().expect("TS export failed");
    assert!(ts.contains("AiProviderConfig"), "missing type name, got:\n{ts}");
    assert!(ts.contains("provider_type:"), "missing provider_type field, got:\n{ts}");
    assert!(ts.contains("model:"), "missing model field, got:\n{ts}");
}