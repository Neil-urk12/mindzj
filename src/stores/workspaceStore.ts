import { createSignal, createMemo, createRoot, batch } from "solid-js";
import { vaultStore } from "./vault";
import { editorStore } from "./editor";
import { openFileRouted } from "../utils/openFileRouted";

// ── Types ────────────────────────────────────────────────────────

type SidebarTab = "files" | "outline" | "search" | "calendar";
type PaneSlot = "primary" | "secondary";
type SplitDirection = "left" | "right" | "up" | "down";

export type { SidebarTab, PaneSlot, SplitDirection };

// ── Constants ────────────────────────────────────────────────────

const MAX_CLOSED_HISTORY = 50;
const DEFAULT_SIDEBAR_TAB_ORDER: SidebarTab[] = ["files", "outline", "search", "calendar"];

// ── Store ────────────────────────────────────────────────────────

function createWorkspaceStore() {
    // ── Signals ──────────────────────────────────────────────────

    const [sidebarTab, setSidebarTab] = createSignal<SidebarTab>("files");
    const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
    const [sidebarWidth, setSidebarWidth] = createSignal(260);
    const [primaryPanePath, setPrimaryPanePath] = createSignal<string | null>(null);
    const [secondaryPanePath, setSecondaryPanePath] = createSignal<string | null>(null);
    const [activePaneSlot, setActivePaneSlot] = createSignal<PaneSlot>("primary");
    const [splitDirection, setSplitDirection] = createSignal<SplitDirection>("right");
    const [splitRatio, setSplitRatio] = createSignal(0.5);
    const [closedTabsHistory, setClosedTabsHistory] = createSignal<string[]>([]);

    // ── Derived memos ────────────────────────────────────────────

    const activePanePath = createMemo(() =>
        activePaneSlot() === "secondary"
            ? (secondaryPanePath() ?? primaryPanePath())
            : primaryPanePath(),
    );

    const splitPaneActive = createMemo(() => secondaryPanePath() !== null);

    // ── Helpers ──────────────────────────────────────────────────

    function getPanePath(slot: PaneSlot): string | null {
        return slot === "primary" ? primaryPanePath() : secondaryPanePath();
    }

    function setPanePath(slot: PaneSlot, path: string | null) {
        if (slot === "primary") {
            setPrimaryPanePath(path);
        } else {
            setSecondaryPanePath(path);
        }
    }

    function findOpenFile(path: string | null | undefined) {
        if (!path) return null;
        return vaultStore.openFiles().find((file) => file.path === path) ?? null;
    }

    function syncActiveFileFromPane(slot: PaneSlot) {
        const path = getPanePath(slot);
        const file = findOpenFile(path);
        if (file) {
            vaultStore.setActiveFile(file);
        }
    }

    // ── Pane transitions ─────────────────────────────────────────

    function activatePane(slot: PaneSlot) {
        setActivePaneSlot(slot);
        syncActiveFileFromPane(slot);
    }

    function closeSplitPane(slot: PaneSlot) {
        if (slot === "secondary") {
            setSecondaryPanePath(null);
            activatePane("primary");
            return;
        }

        // slot === "primary": promote secondary to primary
        const secondary = secondaryPanePath();
        if (secondary) {
            setPrimaryPanePath(secondary);
            setSecondaryPanePath(null);
            activatePane("primary");
        }
    }

    function commitPaneLayout(
        primary: string | null,
        secondary: string | null,
        activeSlot: PaneSlot,
        direction?: SplitDirection,
    ) {
        batch(() => {
            if (direction) setSplitDirection(direction);
            setPrimaryPanePath(primary);
            setSecondaryPanePath(secondary);
            setActivePaneSlot(activeSlot);

            const activePath = activeSlot === "secondary" ? secondary : primary;
            const file = findOpenFile(activePath);
            if (file) {
                vaultStore.setActiveFile(file);
            }
        });
    }

    // ── Tab history ──────────────────────────────────────────────

    function pushClosedTab(path: string) {
        setClosedTabsHistory((prev) => {
            const deduped = prev.filter((p) => p !== path);
            const next = [...deduped, path];
            return next.length > MAX_CLOSED_HISTORY
                ? next.slice(next.length - MAX_CLOSED_HISTORY)
                : next;
        });
    }

    function reopenLastClosedTab() {
        const history = closedTabsHistory();
        if (history.length === 0) return;
        const path = history[history.length - 1];
        setClosedTabsHistory((prev) => prev.slice(0, -1));
        void openFileRouted(path);
    }

    // ── Tab switching ────────────────────────────────────────────

    function switchOpenTab(direction: "prev" | "next"): boolean {
        const files = vaultStore.openFiles();
        if (files.length === 0) return false;

        const currentPath =
            activePanePath() ?? vaultStore.activeFile()?.path ?? null;
        const idx = currentPath
            ? files.findIndex((file) => file.path === currentPath)
            : -1;
        const newIdx =
            direction === "prev"
                ? idx <= 0
                    ? files.length - 1
                    : idx - 1
                : idx < 0 || idx >= files.length - 1
                  ? 0
                  : idx + 1;
        const next = files[newIdx];
        if (!next) return false;

        setPanePath(activePaneSlot(), next.path);
        vaultStore.switchToFile(next.path);
        return true;
    }

    // ── Snapshot ─────────────────────────────────────────────────

    function buildWorkspaceSnapshot() {
        return {
            open_files: vaultStore.openFiles().map((file) => file.path),
            active_file: vaultStore.activeFile()?.path ?? null,
            primary_pane_path: primaryPanePath(),
            secondary_pane_path: secondaryPanePath(),
            active_pane_slot: activePaneSlot(),
            split_direction: splitDirection(),
            split_ratio: splitRatio(),
            sidebar_tab: sidebarTab(),
            sidebar_collapsed: sidebarCollapsed(),
            sidebar_width: sidebarWidth(),
            sidebar_tab_order: DEFAULT_SIDEBAR_TAB_ORDER,
            file_scroll_positions: editorStore.fileScrollPositions(),
            file_top_lines: editorStore.fileTopLines(),
            file_view_modes: editorStore.fileViewModes(),
            file_last_non_reading_view_modes: editorStore.fileLastNonReadingViewModes(),
        };
    }

    // ── Public API ───────────────────────────────────────────────

    return {
        // Signals (read-only accessors)
        sidebarTab,
        sidebarCollapsed,
        sidebarWidth,
        primaryPanePath,
        secondaryPanePath,
        activePaneSlot,
        splitDirection,
        splitRatio,
        closedTabsHistory,
        activePanePath,
        splitPaneActive,

        // Setters
        setSidebarTab,
        setSidebarCollapsed,
        setSidebarWidth,
        setSplitRatio,

        // Pane transitions
        activatePane,
        closeSplitPane,
        commitPaneLayout,

        // Tab history
        pushClosedTab,
        reopenLastClosedTab,

        // Tab switching
        switchOpenTab,

        // Snapshot
        buildWorkspaceSnapshot,
    };
}

export const workspaceStore = createRoot(createWorkspaceStore);
