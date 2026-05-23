import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Vault Store Mock
// ---------------------------------------------------------------------------

export function createMockVaultStore(
  overrides?: Partial<ReturnType<typeof buildVaultDefaults>>,
) {
  return { ...buildVaultDefaults(), ...overrides };
}

function buildVaultDefaults() {
  return {
    // State (readonly signals)
    vaultInfo: vi.fn(() => null),
    fileTree: vi.fn(() => []),
    activeFile: vi.fn(() => null),
    openFiles: vi.fn(() => []),
    isLoading: vi.fn(() => false),
    error: vi.fn(() => null),
    // Actions
    openVault: vi.fn(),
    refreshFileTree: vi.fn(),
    openFile: vi.fn(),
    openPreviewFile: vi.fn(),
    reloadFile: vi.fn(),
    saveFile: vi.fn(),
    applySavedFileContent: vi.fn(),
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    deleteDir: vi.fn(),
    createDir: vi.fn(),
    closeFile: vi.fn(),
    closeVault: vi.fn(),
    switchToFile: vi.fn(),
    setActiveFile: vi.fn(),
    renameFilePath: vi.fn(),
    reorderOpenFiles: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Editor Store Mock
// ---------------------------------------------------------------------------

export function createMockEditorStore(
  overrides?: Partial<ReturnType<typeof buildEditorDefaults>>,
) {
  return { ...buildEditorDefaults(), ...overrides };
}

function buildEditorDefaults() {
  return {
    // State (readonly signals / getters)
    viewMode: vi.fn(() => "live-preview" as const),
    getViewModeForFile: vi.fn(() => "live-preview" as const),
    wordCount: vi.fn(() => 0),
    charCount: vi.fn(() => 0),
    cursorLine: vi.fn(() => 1),
    cursorCol: vi.fn(() => 1),
    isDirty: vi.fn(() => false),
    isDirtyPath: vi.fn(() => false),
    dirtyPaths: vi.fn(() => new Set<string>()),
    editorZoom: vi.fn(() => 100),
    uiZoom: vi.fn(() => 100),
    lastScrollLine: vi.fn(() => null),
    lastNonReadingViewMode: vi.fn(() => "live-preview" as const),
    fileScrollPositions: vi.fn(() => ({})),
    fileTopLines: vi.fn(() => ({})),
    fileCursorSelections: vi.fn(() => ({})),
    fileViewModes: vi.fn(() => ({})),
    fileLastNonReadingViewModes: vi.fn(() => ({})),
    // Actions
    setViewMode: vi.fn(),
    setDefaultViewMode: vi.fn(),
    setCursorLine: vi.fn(),
    setCursorCol: vi.fn(),
    setLastScrollLine: vi.fn(),
    toggleReadingMode: vi.fn(),
    setFileScrollPosition: vi.fn(),
    getFileScrollPosition: vi.fn(() => null),
    setFileTopLine: vi.fn(),
    getFileTopLine: vi.fn(() => null),
    setFileCursorSelection: vi.fn(),
    getFileCursorSelection: vi.fn(() => null),
    setFileHistoryState: vi.fn(),
    getFileHistoryState: vi.fn(() => null),
    clearFileHistoryState: vi.fn(),
    recordExternalEdit: vi.fn(),
    discardExternalEdit: vi.fn(),
    takePendingExternalEdits: vi.fn(() => []),
    scheduleAutoSave: vi.fn(),
    cancelAutoSave: vi.fn(),
    storeHeadings: vi.fn(),
    forceSave: vi.fn(),
    flushAllPendingSaves: vi.fn(),
    updateStats: vi.fn(),
    cycleViewMode: vi.fn(),
    zoomEditorText: vi.fn(),
    zoomUI: vi.fn(),
    setUiZoom: vi.fn(),
    clearDirty: vi.fn(),
    restoreWorkspaceState: vi.fn(),
    resetWorkspaceState: vi.fn(),
    renameFileState: vi.fn(),
    removeFileState: vi.fn(),
    cleanup: vi.fn(),
    lifecycle: {
      prepareView: vi.fn(() => ({
        pendingExternalEdits: [],
        historyJson: null,
        cursorSelection: null,
      })),
      teardown: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Settings Store Mock
// ---------------------------------------------------------------------------

export function createMockSettingsStore(
  overrides?: Partial<ReturnType<typeof buildSettingsDefaults>>,
) {
  return { ...buildSettingsDefaults(), ...overrides };
}

function buildSettingsDefaults() {
  return {
    settings: vi.fn(() => ({})),
    loadSettings: vi.fn(),
    updateSetting: vi.fn(),
    toggleTheme: vi.fn(),
    resetSettings: vi.fn(),
    reloadCustomSkin: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Plugin Store Mock
// ---------------------------------------------------------------------------

export function createMockPluginStore(
  overrides?: Partial<ReturnType<typeof buildPluginDefaults>>,
) {
  return { ...buildPluginDefaults(), ...overrides };
}

function buildPluginDefaults() {
  return {
    loadedPlugins: vi.fn(() => []),
    loading: vi.fn(() => false),
    loadAllPlugins: vi.fn(),
    unloadAllPlugins: vi.fn(),
    unloadPlugin: vi.fn(),
    reloadPlugin: vi.fn(),
    executeCommandById: vi.fn(() => Promise.resolve(false)),
  };
}
