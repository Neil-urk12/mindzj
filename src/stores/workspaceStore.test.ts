import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

vi.mock("./vault", () => ({
    vaultStore: {
        openFiles: vi.fn(() => []),
        activeFile: vi.fn(() => null),
        setActiveFile: vi.fn(),
        closeFile: vi.fn(),
        switchToFile: vi.fn(),
    },
}));

vi.mock("./editor", () => ({
    editorStore: {
        fileScrollPositions: vi.fn(() => ({})),
        fileTopLines: vi.fn(() => ({})),
        fileViewModes: vi.fn(() => ({})),
        fileLastNonReadingViewModes: vi.fn(() => ({})),
    },
}));

vi.mock("../utils/openFileRouted", () => ({
    openFileRouted: vi.fn().mockResolvedValue(undefined),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("workspaceStore", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    // ── Initial state ────────────────────────────────────────────

    describe("initial state", () => {
        it("sidebarTab defaults to 'files'", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.sidebarTab()).toBe("files");
        });

        it("sidebarCollapsed defaults to false", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.sidebarCollapsed()).toBe(false);
        });

        it("sidebarWidth defaults to 260", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.sidebarWidth()).toBe(260);
        });

        it("primaryPanePath defaults to null", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.primaryPanePath()).toBeNull();
        });

        it("secondaryPanePath defaults to null", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.secondaryPanePath()).toBeNull();
        });

        it("activePaneSlot defaults to 'primary'", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.activePaneSlot()).toBe("primary");
        });

        it("splitDirection defaults to 'right'", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.splitDirection()).toBe("right");
        });

        it("splitRatio defaults to 0.5", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.splitRatio()).toBe(0.5);
        });

        it("closedTabsHistory defaults to empty array", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.closedTabsHistory()).toEqual([]);
        });
    });

    // ── Sidebar transitions ──────────────────────────────────────

    describe("sidebar transitions", () => {
        it("setSidebarTab updates sidebarTab", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.setSidebarTab("search");
            expect(workspaceStore.sidebarTab()).toBe("search");
        });

        it("setSidebarCollapsed toggles sidebarCollapsed", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.setSidebarCollapsed(true);
            expect(workspaceStore.sidebarCollapsed()).toBe(true);
            workspaceStore.setSidebarCollapsed(false);
            expect(workspaceStore.sidebarCollapsed()).toBe(false);
        });

        it("setSidebarWidth updates sidebarWidth", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.setSidebarWidth(400);
            expect(workspaceStore.sidebarWidth()).toBe(400);
        });
    });

    // ── Pane layout transitions ──────────────────────────────────

    describe("pane layout transitions", () => {
        it("activatePane sets activePaneSlot", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.activatePane("secondary");
            expect(workspaceStore.activePaneSlot()).toBe("secondary");
        });

        it("closeSplitPane('secondary') clears secondaryPanePath and resets to primary", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            // Set up a split
            workspaceStore.commitPaneLayout("a.md", "b.md", "secondary", "right");
            expect(workspaceStore.secondaryPanePath()).toBe("b.md");

            // Close secondary
            workspaceStore.closeSplitPane("secondary");
            expect(workspaceStore.secondaryPanePath()).toBeNull();
            expect(workspaceStore.activePaneSlot()).toBe("primary");
        });

        it("closeSplitPane('primary') promotes secondary to primary", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.commitPaneLayout("a.md", "b.md", "primary", "right");

            workspaceStore.closeSplitPane("primary");
            expect(workspaceStore.primaryPanePath()).toBe("b.md");
            expect(workspaceStore.secondaryPanePath()).toBeNull();
            expect(workspaceStore.activePaneSlot()).toBe("primary");
        });

        it("commitPaneLayout sets all 4 pane signals at once", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.commitPaneLayout("a.md", "b.md", "secondary", "down");

            expect(workspaceStore.primaryPanePath()).toBe("a.md");
            expect(workspaceStore.secondaryPanePath()).toBe("b.md");
            expect(workspaceStore.activePaneSlot()).toBe("secondary");
            expect(workspaceStore.splitDirection()).toBe("down");
        });
    });

    // ── Tab history ──────────────────────────────────────────────

    describe("tab history", () => {
        it("pushClosedTab adds path to history", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.pushClosedTab("a.md");
            expect(workspaceStore.closedTabsHistory()).toEqual(["a.md"]);
        });

        it("pushClosedTab deduplicates (bumps to end)", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.pushClosedTab("a.md");
            workspaceStore.pushClosedTab("b.md");
            workspaceStore.pushClosedTab("a.md"); // should bump a.md to end
            expect(workspaceStore.closedTabsHistory()).toEqual(["b.md", "a.md"]);
        });

        it("pushClosedTab bounds at 50 entries", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            // Push 55 entries
            for (let i = 0; i < 55; i++) {
                workspaceStore.pushClosedTab(`file-${i}.md`);
            }
            // Should only keep last 50
            const history = workspaceStore.closedTabsHistory();
            expect(history.length).toBe(50);
            expect(history[0]).toBe("file-5.md"); // oldest kept
            expect(history[49]).toBe("file-54.md"); // newest
        });

        it("reopenLastClosedTab pops and calls openFileRouted", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            const { openFileRouted } = await import("../utils/openFileRouted");

            workspaceStore.pushClosedTab("a.md");
            workspaceStore.pushClosedTab("b.md");
            workspaceStore.reopenLastClosedTab();

            expect(openFileRouted).toHaveBeenCalledWith("b.md");
            expect(workspaceStore.closedTabsHistory()).toEqual(["a.md"]);
        });

        it("reopenLastClosedTab does nothing when history is empty", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            const { openFileRouted } = await import("../utils/openFileRouted");

            workspaceStore.reopenLastClosedTab();
            expect(openFileRouted).not.toHaveBeenCalled();
        });
    });

    // ── switchOpenTab ────────────────────────────────────────────

    describe("switchOpenTab", () => {
        it("returns false when no files open", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            const { vaultStore } = await import("./vault");
            (vaultStore.openFiles as any).mockReturnValue([]);

            expect(workspaceStore.switchOpenTab("next")).toBe(false);
        });

        it("cycles to next tab", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            const { vaultStore } = await import("./vault");

            const files = [
                { path: "a.md", content: "", modified: "", hash: "", kind: "text" },
                { path: "b.md", content: "", modified: "", hash: "", kind: "text" },
                { path: "c.md", content: "", modified: "", hash: "", kind: "text" },
            ];
            (vaultStore.openFiles as any).mockReturnValue(files);
            (vaultStore.activeFile as any).mockReturnValue(files[0]);

            // Set active pane path to a.md
            workspaceStore.commitPaneLayout("a.md", null, "primary", "right");

            const result = workspaceStore.switchOpenTab("next");
            expect(result).toBe(true);
        });
    });

    // ── Snapshot ─────────────────────────────────────────────────

    describe("buildWorkspaceSnapshot", () => {
        it("returns correct shape with default values", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            const { vaultStore } = await import("./vault");
            (vaultStore.openFiles as any).mockReturnValue([]);
            (vaultStore.activeFile as any).mockReturnValue(null);
            const snapshot = workspaceStore.buildWorkspaceSnapshot();

            expect(snapshot).toEqual({
                open_files: [],
                active_file: null,
                primary_pane_path: null,
                secondary_pane_path: null,
                active_pane_slot: "primary",
                split_direction: "right",
                split_ratio: 0.5,
                sidebar_tab: "files",
                sidebar_collapsed: false,
                sidebar_width: 260,
                sidebar_tab_order: expect.any(Array),
                file_scroll_positions: {},
                file_top_lines: {},
                file_view_modes: {},
                file_last_non_reading_view_modes: {},
            });
        });

        it("reflects current signal values", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            const { vaultStore } = await import("./vault");

            // Modify some state
            workspaceStore.setSidebarTab("search");
            workspaceStore.setSidebarCollapsed(true);
            workspaceStore.setSidebarWidth(400);
            workspaceStore.commitPaneLayout("a.md", "b.md", "secondary", "down");

            (vaultStore.openFiles as any).mockReturnValue([
                { path: "a.md", content: "", modified: "", hash: "", kind: "text" },
                { path: "b.md", content: "", modified: "", hash: "", kind: "text" },
            ]);
            (vaultStore.activeFile as any).mockReturnValue({
                path: "b.md", content: "", modified: "", hash: "", kind: "text",
            });

            const snapshot = workspaceStore.buildWorkspaceSnapshot();

            expect(snapshot.sidebar_tab).toBe("search");
            expect(snapshot.sidebar_collapsed).toBe(true);
            expect(snapshot.sidebar_width).toBe(400);
            expect(snapshot.primary_pane_path).toBe("a.md");
            expect(snapshot.secondary_pane_path).toBe("b.md");
            expect(snapshot.active_pane_slot).toBe("secondary");
            expect(snapshot.split_direction).toBe("down");
        });
    });

    // ── Derived memos ────────────────────────────────────────────

    describe("derived memos", () => {
        it("activePanePath returns primary when slot is primary", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.commitPaneLayout("a.md", "b.md", "primary", "right");
            expect(workspaceStore.activePanePath()).toBe("a.md");
        });

        it("activePanePath returns secondary when slot is secondary", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.commitPaneLayout("a.md", "b.md", "secondary", "right");
            expect(workspaceStore.activePanePath()).toBe("b.md");
        });

        it("activePanePath falls back to primary when secondary is null", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.commitPaneLayout("a.md", null, "secondary", "right");
            expect(workspaceStore.activePanePath()).toBe("a.md");
        });

        it("splitPaneActive is true when secondaryPanePath is set", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            expect(workspaceStore.splitPaneActive()).toBe(false);
            workspaceStore.commitPaneLayout("a.md", "b.md", "primary", "right");
            expect(workspaceStore.splitPaneActive()).toBe(true);
        });

        it("splitPaneActive is false when secondaryPanePath is null", async () => {
            const { workspaceStore } = await import("./workspaceStore");
            workspaceStore.commitPaneLayout("a.md", null, "primary", "right");
            expect(workspaceStore.splitPaneActive()).toBe(false);
        });
    });
});
