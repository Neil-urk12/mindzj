import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("workspace", () => {
// NOTE: workspace.ts maintains module-level mutable state (let workspace = { ...DEFAULT_WORKSPACE }).
// vi.resetModules() in beforeEach re-imports a fresh module each test so assertions against
// default values (open_files: [], active_file: null) are correct.
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── loadWorkspace ────────────────────────────────────────────

    describe("loadWorkspace", () => {
        it("returns workspace state from invoke", async () => {
            const mockState = {
                open_files: ["a.md", "b.md"],
                active_file: "a.md",
                primary_pane_path: "a.md",
                secondary_pane_path: null,
                active_pane_slot: "primary",
                split_direction: "right",
                split_ratio: 0.5,
                sidebar_tab: "files",
                sidebar_collapsed: false,
                sidebar_width: 260,
                sidebar_tab_order: [],
                file_scroll_positions: {},
                file_top_lines: {},
                file_view_modes: {},
                file_last_non_reading_view_modes: {},
                window_x: null,
                window_y: null,
                window_width: null,
                window_height: null,
                window_maximized: null,
            };

            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValueOnce(mockState);

            const { loadWorkspace } = await import("./workspace");
            const result = await loadWorkspace();

            expect(invoke).toHaveBeenCalledWith("load_workspace");
            expect(result).toEqual(mockState);
        });

        it("returns default workspace on invoke error", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("disk error"));

            const { loadWorkspace } = await import("./workspace");
            const result = await loadWorkspace();

            expect(result.open_files).toEqual([]);
            expect(result.active_file).toBeNull();
            expect(result.sidebar_tab).toBe("files");
            expect(result.split_ratio).toBe(0.5);
        });

        it("logs error to console on error", async () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const error = new Error("load fail");

            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(error);

            const { loadWorkspace } = await import("./workspace");
            await loadWorkspace();

            expect(errorSpy).toHaveBeenCalledWith("Failed to load workspace:", error);
            errorSpy.mockRestore();
        });
    });

    // ── saveWorkspace ────────────────────────────────────────────

    describe("saveWorkspace", () => {
        it("calls invoke with current workspace when no partial given", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { saveWorkspace } = await import("./workspace");
            await saveWorkspace();

            expect(invoke).toHaveBeenCalledWith("save_workspace", {
                workspace: expect.objectContaining({
                    open_files: [],
                    active_file: null,
                    sidebar_tab: "files",
                }),
            });
        });

        it("merges partial state before saving", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { saveWorkspace } = await import("./workspace");
            await saveWorkspace({ active_file: "note.md", sidebar_collapsed: true });

            expect(invoke).toHaveBeenCalledWith("save_workspace", {
                workspace: expect.objectContaining({
                    active_file: "note.md",
                    sidebar_collapsed: true,
                    sidebar_tab: "files",
                }),
            });
        });

        it("does not throw on invoke error", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("save fail"));

            const { saveWorkspace } = await import("./workspace");
            await expect(saveWorkspace()).resolves.toBeUndefined();
        });

        it("logs error to console on invoke failure", async () => {
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const error = new Error("save fail");

            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(error);

            const { saveWorkspace } = await import("./workspace");
            await saveWorkspace();

            expect(errorSpy).toHaveBeenCalledWith("Failed to save workspace:", error);
            errorSpy.mockRestore();
        });
    });

    // ── scheduleSave ─────────────────────────────────────────────

    describe("scheduleSave", () => {
        it("debounces save by 1000ms", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { scheduleSave } = await import("./workspace");
            scheduleSave({ active_file: "test.md" });

            expect(invoke).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1000);

            expect(invoke).toHaveBeenCalledWith("save_workspace", {
                workspace: expect.objectContaining({
                    active_file: "test.md",
                }),
            });
        });

        it("resets timer on subsequent calls", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { scheduleSave } = await import("./workspace");
            scheduleSave({ active_file: "first.md" });

            await vi.advanceTimersByTimeAsync(500);
            expect(invoke).not.toHaveBeenCalled();

            scheduleSave({ active_file: "second.md" });

            await vi.advanceTimersByTimeAsync(500);
            expect(invoke).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(500);
            expect(invoke).toHaveBeenCalledTimes(1);
            expect(invoke).toHaveBeenCalledWith("save_workspace", {
                workspace: expect.objectContaining({
                    active_file: "second.md",
                }),
            });
        });

        it("merges partial into workspace state", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { scheduleSave } = await import("./workspace");
            scheduleSave({ sidebar_width: 300, sidebar_collapsed: true });

            await vi.advanceTimersByTimeAsync(1000);

            expect(invoke).toHaveBeenCalledWith("save_workspace", {
                workspace: expect.objectContaining({
                    sidebar_width: 300,
                    sidebar_collapsed: true,
                }),
            });
        });

        it("works without partial argument", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { scheduleSave } = await import("./workspace");
            scheduleSave();

            await vi.advanceTimersByTimeAsync(1000);

            expect(invoke).toHaveBeenCalledWith("save_workspace", {
                workspace: expect.objectContaining({
                    open_files: [],
                    active_file: null,
                }),
            });
        });
    });
});
