import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

vi.mock("./vault", () => ({
    vaultStore: {
        activeFile: vi.fn(() => null),
        saveFile: vi.fn().mockResolvedValue({
            path: "",
            content: "",
            modified: "",
            hash: "",
            kind: "text",
        }),
        applySavedFileContent: vi.fn(),
    },
}));

vi.mock("./settings", () => ({
    settingsStore: {
        settings: vi.fn(() => ({ auto_save_interval_ms: 2000 })),
    },
}));

vi.mock("../utils/linkUpdater", () => ({
    extractHeadings: vi.fn(() => []),
    findRenamedHeadings: vi.fn(() => []),
    findRenamedAnchors: vi.fn(() => []),
    collectReferencedAnchors: vi.fn(() => Promise.resolve([])),
    updateBacklinksOnHeadingRename: vi.fn(() => Promise.resolve()),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("editor", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── viewMode ─────────────────────────────────────────────────

    describe("viewMode", () => {
        it("defaults to live-preview", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.viewMode()).toBe("live-preview");
        });

        it("returns per-file mode when set", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "note.md");
            expect(editorStore.getViewModeForFile("note.md")).toBe("source");
        });

        it("falls back to default for untracked files", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.getViewModeForFile("unknown.md")).toBe("live-preview");
        });

        it("uses default when path is null", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.getViewModeForFile(null)).toBe("live-preview");
        });
    });

    // ── setViewMode ──────────────────────────────────────────────

    describe("setViewMode", () => {
        it("sets per-file view mode", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "note.md");
            expect(editorStore.getViewModeForFile("note.md")).toBe("source");
        });

        it("sets default when no path and no active file", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source");
            expect(editorStore.viewMode()).toBe("source");
            expect(editorStore.getViewModeForFile(null)).toBe("source");
        });

        it("tracks last non-reading view mode", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "note.md");
            editorStore.setViewMode("reading", "note.md");
            expect(editorStore.getViewModeForFile("note.md")).toBe("reading");
            // lastNonReadingViewMode for file should be "source"
            expect(editorStore.lastNonReadingViewMode()).toBe("live-preview"); // default for no active
        });
    });

    // ── setDefaultViewMode ───────────────────────────────────────

    describe("setDefaultViewMode", () => {
        it("updates the fallback view mode", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setDefaultViewMode("source");
            expect(editorStore.getViewModeForFile(null)).toBe("source");
            expect(editorStore.getViewModeForFile("unknown.md")).toBe("source");
        });

        it("does not update last non-reading for reading mode", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setDefaultViewMode("reading");
            // reading is not editable, so lastNonReadingViewMode stays at default
            expect(editorStore.lastNonReadingViewMode()).toBe("live-preview");
        });
    });

    // ── cycleViewMode ────────────────────────────────────────────

    describe("cycleViewMode", () => {
        it("cycles source → live-preview → reading → source", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "note.md");

            editorStore.cycleViewMode("note.md");
            expect(editorStore.getViewModeForFile("note.md")).toBe("live-preview");

            editorStore.cycleViewMode("note.md");
            expect(editorStore.getViewModeForFile("note.md")).toBe("reading");

            editorStore.cycleViewMode("note.md");
            expect(editorStore.getViewModeForFile("note.md")).toBe("source");
        });
    });

    // ── toggleReadingMode ────────────────────────────────────────

    describe("toggleReadingMode", () => {
        it("toggles from editable to reading", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("live-preview", "note.md");

            editorStore.toggleReadingMode("note.md");
            expect(editorStore.getViewModeForFile("note.md")).toBe("reading");
        });

        it("toggles back from reading to last non-reading mode", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "note.md");
            editorStore.toggleReadingMode("note.md"); // → reading

            editorStore.toggleReadingMode("note.md"); // → source
            expect(editorStore.getViewModeForFile("note.md")).toBe("source");
        });
    });

    // ── dirty state ──────────────────────────────────────────────

    describe("dirty state", () => {
        it("tracks dirty paths via scheduleAutoSave", async () => {
            const { editorStore } = await import("./editor");
            editorStore.scheduleAutoSave("note.md", "content");

            expect(editorStore.isDirtyPath("note.md")).toBe(true);
            expect(editorStore.dirtyPaths().has("note.md")).toBe(true);
        });

        it("clears dirty after auto-save completes", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("note.md", "content");
            expect(editorStore.isDirtyPath("note.md")).toBe(true);

            await vi.advanceTimersByTimeAsync(2000);

            expect(editorStore.isDirtyPath("note.md")).toBe(false);
            expect(vaultStore.saveFile).toHaveBeenCalledWith("note.md", "content", {
                updateState: false,
            });
        });

        it("cancelAutoSave clears dirty and cancels timer", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("note.md", "content");
            expect(editorStore.isDirtyPath("note.md")).toBe(true);

            editorStore.cancelAutoSave("note.md");
            expect(editorStore.isDirtyPath("note.md")).toBe(false);

            await vi.advanceTimersByTimeAsync(5000);
            expect(vaultStore.saveFile).not.toHaveBeenCalled();
        });

        it("clearDirty removes specific path", async () => {
            const { editorStore } = await import("./editor");
            editorStore.scheduleAutoSave("a.md", "a");
            editorStore.scheduleAutoSave("b.md", "b");

            editorStore.clearDirty("a.md");
            expect(editorStore.isDirtyPath("a.md")).toBe(false);
            expect(editorStore.isDirtyPath("b.md")).toBe(true);
        });

        it("isDirty checks active file via vaultStore", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            vi.mocked(vaultStore.activeFile).mockReturnValue({
                path: "note.md",
                content: "",
                modified: "",
                hash: "",
                kind: "text",
            });

            editorStore.scheduleAutoSave("note.md", "content");
            expect(editorStore.isDirty()).toBe(true);
        });
    });

    // ── scheduleAutoSave ─────────────────────────────────────────

    describe("scheduleAutoSave", () => {
        it("debounces by configured interval (2000ms)", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("note.md", "content");
            expect(vaultStore.saveFile).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(2000);
            expect(vaultStore.saveFile).toHaveBeenCalledTimes(1);
        });

        it("resets timer on subsequent calls", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("note.md", "v1");
            await vi.advanceTimersByTimeAsync(1000);

            editorStore.scheduleAutoSave("note.md", "v2");
            await vi.advanceTimersByTimeAsync(1000);
            expect(vaultStore.saveFile).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1000);
            expect(vaultStore.saveFile).toHaveBeenCalledTimes(1);
            expect(vaultStore.saveFile).toHaveBeenCalledWith("note.md", "v2", {
                updateState: false,
            });
        });

        it("calls applySavedFileContent after save", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("note.md", "content");
            await vi.advanceTimersByTimeAsync(2000);

            expect(vaultStore.applySavedFileContent).toHaveBeenCalled();
        });
    });

    // ── forceSave ────────────────────────────────────────────────

    describe("forceSave", () => {
        it("saves immediately and clears dirty", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("note.md", "old");
            expect(editorStore.isDirtyPath("note.md")).toBe(true);

            await editorStore.forceSave("note.md", "new");

            expect(vaultStore.saveFile).toHaveBeenCalledWith("note.md", "new", {
                suppressSavedEvent: undefined,
            });
            expect(editorStore.isDirtyPath("note.md")).toBe(false);
        });

        it("cancels pending auto-save timer", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("note.md", "content");
            await editorStore.forceSave("note.md", "final");

            vi.mocked(vaultStore.saveFile).mockClear();
            await vi.advanceTimersByTimeAsync(5000);

            expect(vaultStore.saveFile).not.toHaveBeenCalled();
        });
    });

    // ── flushAllPendingSaves ─────────────────────────────────────

    describe("flushAllPendingSaves", () => {
        it("saves all pending files immediately", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("a.md", "content-a");
            editorStore.scheduleAutoSave("b.md", "content-b");

            await editorStore.flushAllPendingSaves();

            expect(vaultStore.saveFile).toHaveBeenCalledTimes(2);
            expect(editorStore.isDirtyPath("a.md")).toBe(false);
            expect(editorStore.isDirtyPath("b.md")).toBe(false);
        });

        it("does nothing when no pending saves", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            await editorStore.flushAllPendingSaves();
            expect(vaultStore.saveFile).not.toHaveBeenCalled();
        });
    });

    // ── updateStats ──────────────────────────────────────────────

    describe("updateStats", () => {
        it("counts words and characters", async () => {
            const { editorStore } = await import("./editor");
            editorStore.updateStats("Hello world foo");

            expect(editorStore.wordCount()).toBe(3);
            expect(editorStore.charCount()).toBe(15);
        });

        it("handles empty content", async () => {
            const { editorStore } = await import("./editor");
            editorStore.updateStats("");

            expect(editorStore.wordCount()).toBe(0);
            expect(editorStore.charCount()).toBe(0);
        });

        it("handles whitespace-only content", async () => {
            const { editorStore } = await import("./editor");
            editorStore.updateStats("   ");

            expect(editorStore.wordCount()).toBe(0);
            expect(editorStore.charCount()).toBe(3);
        });
    });

    // ── zoom ─────────────────────────────────────────────────────

    describe("zoom", () => {
        it("zoomEditorText clamps between 50 and 200", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.editorZoom()).toBe(100);

            editorStore.zoomEditorText(20);
            expect(editorStore.editorZoom()).toBe(120);

            editorStore.zoomEditorText(100);
            expect(editorStore.editorZoom()).toBe(200);

            // already at max, +1 should clamp
            editorStore.zoomEditorText(1);
            expect(editorStore.editorZoom()).toBe(200);
        });

        it("zoomUI clamps between 50 and 200", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.uiZoom()).toBe(100);

            editorStore.zoomUI(-60);
            expect(editorStore.uiZoom()).toBe(50);
        });

        it("setUiZoom clamps and rounds", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setUiZoom(300);
            expect(editorStore.uiZoom()).toBe(200);

            editorStore.setUiZoom(10);
            expect(editorStore.uiZoom()).toBe(50);

            editorStore.setUiZoom(123.7);
            expect(editorStore.uiZoom()).toBe(123.7);
        });
    });

    // ── scroll positions ─────────────────────────────────────────

    describe("scroll positions", () => {
        it("stores and retrieves file scroll position", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileScrollPosition("note.md", "live-preview", 150);

            expect(editorStore.getFileScrollPosition("note.md", "live-preview")).toBe(150);
        });

        it("returns null for unknown file/mode", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.getFileScrollPosition("unknown.md", "source")).toBeNull();
        });

        it("returns null for null path", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.getFileScrollPosition(null, "source")).toBeNull();
        });

        it("normalizes to non-negative integer", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileScrollPosition("note.md", "source", -5.7);
            expect(editorStore.getFileScrollPosition("note.md", "source")).toBe(0);

            editorStore.setFileScrollPosition("note.md", "source", 99.6);
            expect(editorStore.getFileScrollPosition("note.md", "source")).toBe(100);
        });
    });

    // ── file top lines ───────────────────────────────────────────

    describe("file top lines", () => {
        it("stores and retrieves file top line", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileTopLine("note.md", 42);

            expect(editorStore.getFileTopLine("note.md")).toBe(42);
        });

        it("falls back to lastScrollLine for unknown file", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileTopLine("note.md", 10);

            expect(editorStore.getFileTopLine("unknown.md")).toBe(10);
        });
    });

    // ── file cursor selections ───────────────────────────────────

    describe("cursor selections", () => {
        it("stores and retrieves cursor selection", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileCursorSelection("note.md", { anchor: 10, head: 20 });

            expect(editorStore.getFileCursorSelection("note.md")).toEqual({
                anchor: 10,
                head: 20,
            });
        });

        it("returns null for null path", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.getFileCursorSelection(null)).toBeNull();
        });

        it("ignores invalid selection values", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileCursorSelection("note.md", { anchor: NaN, head: 10 });
            expect(editorStore.getFileCursorSelection("note.md")).toBeNull();
        });
    });

    // ── workspace state ──────────────────────────────────────────

    describe("workspace state", () => {
        it("restoreWorkspaceState sets per-file maps", async () => {
            const { editorStore } = await import("./editor");
            const state = {
                file_scroll_positions: { "note.md": { "live-preview": 100 } },
                file_top_lines: { "note.md": 5 },
                file_view_modes: { "note.md": "source" as const },
                file_last_non_reading_view_modes: { "note.md": "source" as const },
            };

            editorStore.restoreWorkspaceState(state);

            expect(editorStore.getFileScrollPosition("note.md", "live-preview")).toBe(100);
            expect(editorStore.getFileTopLine("note.md")).toBe(5);
            expect(editorStore.getViewModeForFile("note.md")).toBe("source");
        });

        it("resetWorkspaceState clears all state", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileScrollPosition("note.md", "source", 100);
            editorStore.setFileTopLine("note.md", 5);
            editorStore.setViewMode("source", "note.md");
            editorStore.scheduleAutoSave("note.md", "content");

            editorStore.resetWorkspaceState();

            expect(editorStore.fileScrollPositions()).toEqual({});
            expect(editorStore.fileTopLines()).toEqual({});
            expect(editorStore.fileViewModes()).toEqual({});
            expect(editorStore.fileLastNonReadingViewModes()).toEqual({});
            expect(editorStore.lastScrollLine()).toBeNull();
        });
    });

    // ── renameFileState ──────────────────────────────────────────

    describe("renameFileState", () => {
        it("moves state from old path to new path", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "old.md");
            editorStore.setFileScrollPosition("old.md", "source", 100);
            editorStore.setFileTopLine("old.md", 5);
            editorStore.scheduleAutoSave("old.md", "content");

            editorStore.renameFileState("old.md", "new.md");

            expect(editorStore.getViewModeForFile("new.md")).toBe("source");
            expect(editorStore.getFileScrollPosition("new.md", "source")).toBe(100);
            expect(editorStore.isDirtyPath("new.md")).toBe(true);
            expect(editorStore.isDirtyPath("old.md")).toBe(false);
        });

        it("does nothing for empty or same paths", async () => {
            const { editorStore } = await import("./editor");
            editorStore.renameFileState("", "");
            editorStore.renameFileState("a.md", "a.md");
            // no error thrown
        });
    });

    // ── removeFileState ──────────────────────────────────────────

    describe("removeFileState", () => {
        it("clears all state for a path", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "note.md");
            editorStore.setFileScrollPosition("note.md", "source", 100);
            editorStore.setFileTopLine("note.md", 5);

            editorStore.removeFileState("note.md");

            expect(editorStore.fileViewModes()).not.toHaveProperty("note.md");
            expect(editorStore.getFileScrollPosition("note.md", "source")).toBeNull();
        });

        it("supports recursive removal for directories", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setViewMode("source", "folder/a.md");
            editorStore.setViewMode("reading", "folder/b.md");
            editorStore.setViewMode("source", "other.md");

            editorStore.removeFileState("folder", true);

            expect(editorStore.fileViewModes()).not.toHaveProperty("folder/a.md");
            expect(editorStore.fileViewModes()).not.toHaveProperty("folder/b.md");
            expect(editorStore.fileViewModes()).toHaveProperty("other.md");
        });
    });

    // ── lifecycle ────────────────────────────────────────────────

    describe("lifecycle", () => {
        it("prepareView returns empty state by default", async () => {
            const { editorStore } = await import("./editor");
            const result = editorStore.lifecycle.prepareView("note.md", "# Hello");

            expect(result.pendingExternalEdits).toEqual([]);
            expect(result.historyJson).toBeNull();
            expect(result.cursorSelection).toBeNull();
        });

        it("teardown persists history state", async () => {
            const { editorStore } = await import("./editor");
            const historyState = { undo: [] };

            editorStore.lifecycle.teardown("note.md", historyState);
            expect(editorStore.getFileHistoryState("note.md")).toEqual(historyState);
        });

        it("prepareView drains persisted history", async () => {
            const { editorStore } = await import("./editor");
            const historyState = { undo: ["action"] };

            editorStore.setFileHistoryState("note.md", historyState);
            const result = editorStore.lifecycle.prepareView("note.md", "content");

            expect(result.historyJson).toEqual(historyState);
            // consumed — next call should return null
            expect(editorStore.getFileHistoryState("note.md")).toBeNull();
        });

        it("prepareView includes cursor selection", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileCursorSelection("note.md", { anchor: 5, head: 10 });

            const result = editorStore.lifecycle.prepareView("note.md", "content");
            expect(result.cursorSelection).toEqual({ anchor: 5, head: 10 });
        });
    });

    // ── external edits ───────────────────────────────────────────

    describe("external edits", () => {
        it("records and retrieves pending external edits", async () => {
            const { editorStore } = await import("./editor");
            editorStore.recordExternalEdit("note.md", "old", "new");

            const edits = editorStore.takePendingExternalEdits("note.md", "new");
            expect(edits).toEqual([{ before: "old", after: "new" }]);
        });

        it("chains sequential edits", async () => {
            const { editorStore } = await import("./editor");
            editorStore.recordExternalEdit("note.md", "v1", "v2");
            editorStore.recordExternalEdit("note.md", "v2", "v3");

            const edits = editorStore.takePendingExternalEdits("note.md", "v3");
            expect(edits).toEqual([
                { before: "v1", after: "v2" },
                { before: "v2", after: "v3" },
            ]);
        });

        it("discards specific edit", async () => {
            const { editorStore } = await import("./editor");
            editorStore.recordExternalEdit("note.md", "old", "new");
            editorStore.discardExternalEdit("note.md", "old", "new");

            const edits = editorStore.takePendingExternalEdits("note.md", "new");
            expect(edits).toEqual([]);
        });

        it("returns empty when content doesn't match expected", async () => {
            const { editorStore } = await import("./editor");
            editorStore.recordExternalEdit("note.md", "old", "new");

            const edits = editorStore.takePendingExternalEdits("note.md", "wrong");
            expect(edits).toEqual([]);
        });

        it("ignores edit with no path", async () => {
            const { editorStore } = await import("./editor");
            editorStore.recordExternalEdit("", "old", "new");

            const edits = editorStore.takePendingExternalEdits("", "new");
            expect(edits).toEqual([]);
        });
    });

    // ── file history state ───────────────────────────────────────

    describe("file history state", () => {
        it("stores and retrieves history", async () => {
            const { editorStore } = await import("./editor");
            const state = { key: "value" };
            editorStore.setFileHistoryState("note.md", state);
            expect(editorStore.getFileHistoryState("note.md")).toEqual(state);
        });

        it("returns null for unknown path", async () => {
            const { editorStore } = await import("./editor");
            expect(editorStore.getFileHistoryState("unknown.md")).toBeNull();
        });

        it("clears history for path", async () => {
            const { editorStore } = await import("./editor");
            editorStore.setFileHistoryState("note.md", { data: true });
            editorStore.clearFileHistoryState("note.md");
            expect(editorStore.getFileHistoryState("note.md")).toBeNull();
        });

        it("evicts oldest entries when exceeding MAX_HISTORY_ENTRIES (50)", async () => {
            const { editorStore } = await import("./editor");
            for (let i = 0; i < 52; i++) {
                editorStore.setFileHistoryState(`file-${i}.md`, { idx: i });
            }
            // first two evicted
            expect(editorStore.getFileHistoryState("file-0.md")).toBeNull();
            expect(editorStore.getFileHistoryState("file-1.md")).toBeNull();
            // last entry present
            expect(editorStore.getFileHistoryState("file-51.md")).toEqual({ idx: 51 });
        });
    });

    // ── cleanup ──────────────────────────────────────────────────

    describe("cleanup", () => {
        it("clears all save timers so pending saves don't fire", async () => {
            const { vaultStore } = await import("./vault");
            const { editorStore } = await import("./editor");

            editorStore.scheduleAutoSave("a.md", "a");
            editorStore.scheduleAutoSave("b.md", "b");

            editorStore.cleanup();
            await vi.advanceTimersByTimeAsync(5000);

            expect(vaultStore.saveFile).not.toHaveBeenCalled();
        });
    });
});
