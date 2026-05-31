// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@solidjs/testing-library";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
    getCurrentWindow: () => ({ onCloseRequested: vi.fn() }),
}));
vi.mock("../stores/vault", () => ({
    vaultStore: { activeFile: vi.fn(), openFile: vi.fn() },
}));
vi.mock("../stores/editor", () => ({
    editorStore: { activeView: vi.fn() },
}));
vi.mock("../stores/settings", () => ({
    settingsStore: {
        settings: vi.fn(() => ({ hotkey_overrides: {} })),
    },
}));
vi.mock("../stores/plugins", () => ({
    pluginStore: { handlePluginHotkeys: vi.fn() },
}));
vi.mock("../stores/findState", () => ({
    setFindQuery: vi.fn(),
}));
vi.mock("@codemirror/search", () => ({
    openSearchPanel: vi.fn(),
    closeSearchPanel: vi.fn(),
    getSearchQuery: vi.fn(),
    searchPanelOpen: vi.fn(),
    setSearchQuery: vi.fn(),
    SearchQuery: vi.fn(),
}));
vi.mock("@codemirror/view", () => ({
    EditorView: { domEventHandlers: vi.fn() },
}));
vi.mock("../components/sidebar/SearchPanel", () => ({
    setQuery: vi.fn(),
    runSearchNow: vi.fn(),
}));

// ── Import the module under test ───────────────────────────────────

import { useKeyboardShortcuts, type UseKeyboardShortcutsOptions } from "./useKeyboardShortcuts";

// ── Helpers ────────────────────────────────────────────────────────

function createMockOptions(overrides: Partial<UseKeyboardShortcutsOptions> = {}): UseKeyboardShortcutsOptions {
    return {
        showCommandPalette: () => false,
        setShowCommandPalette: vi.fn(),
        commandPaletteMode: () => "commands" as const,
        setCommandPaletteMode: vi.fn(),
        setShowGotoLine: vi.fn(),
        setShowSettings: vi.fn(),
        setSidebarTab: vi.fn(),
        sidebarTabs: () => [
            { id: "files" as const, title: "Files", icon: "file" },
            { id: "outline" as const, title: "Outline", icon: "list" },
            { id: "search" as const, title: "Search", icon: "search" },
            { id: "calendar" as const, title: "Calendar", icon: "calendar" },
        ],
        sidebarCollapsed: () => false,
        setSidebarCollapsed: vi.fn(),
        activePanePath: () => null,
        activePaneSlot: () => "primary" as const,
        handleNewTab: vi.fn(),
        handleTabClose: vi.fn(),
        reopenLastClosedTab: vi.fn(),
        switchOpenTab: vi.fn(() => true),
        aiPanel: {
            showAiPanel: () => false,
            setShowAiPanel: vi.fn(),
            showAiHistory: () => false,
            closeAiHistoryDialog: vi.fn(),
            navigateAiQuestionHistory: vi.fn(),
        },
        screenshot: { startScreenshot: vi.fn() },
        ...overrides,
    };
}

function fireKey(key: string, init: KeyboardEventInit = {}) {
    document.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
}

function fireKeyUp(key: string, init: KeyboardEventInit = {}) {
    document.dispatchEvent(
        new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, ...init }),
    );
}

// ── Tests ──────────────────────────────────────────────────────────

describe("useKeyboardShortcuts", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset hotkey capturing flag
        (window as any).__mindzj_hotkey_capturing = false;
    });

    describe("module smoke tests", () => {
        it("exports useKeyboardShortcuts as a function", () => {
            expect(typeof useKeyboardShortcuts).toBe("function");
        });
    });

    describe("AI history shortcut", () => {
        it("Escape closes AI history dialog when history is shown", () => {
            const opts = createMockOptions({
                aiPanel: {
                    showAiPanel: () => true,
                    setShowAiPanel: vi.fn(),
                    showAiHistory: () => true,
                    closeAiHistoryDialog: vi.fn(),
                    navigateAiQuestionHistory: vi.fn(),
                },
            });
            renderHook(() => useKeyboardShortcuts(opts));
            fireKey("Escape");
            expect(opts.aiPanel.closeAiHistoryDialog).toHaveBeenCalled();
        });

        it("Escape does NOT close AI history when history is hidden", () => {
            const opts = createMockOptions({
                aiPanel: {
                    showAiPanel: () => false,
                    setShowAiPanel: vi.fn(),
                    showAiHistory: () => false,
                    closeAiHistoryDialog: vi.fn(),
                    navigateAiQuestionHistory: vi.fn(),
                },
            });
            renderHook(() => useKeyboardShortcuts(opts));
            fireKey("Escape");
            expect(opts.aiPanel.closeAiHistoryDialog).not.toHaveBeenCalled();
        });
    });

    describe("hotkey capture bypass", () => {
        it("ignores all keys when hotkey capturing is active", () => {
            (window as any).__mindzj_hotkey_capturing = true;
            const opts = createMockOptions();
            renderHook(() => useKeyboardShortcuts(opts));
            fireKey("n", { ctrlKey: true });
            expect(opts.handleNewTab).not.toHaveBeenCalled();
        });
    });
});
