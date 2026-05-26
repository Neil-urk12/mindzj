import {
    Component,
    Show,
    For,
    createSignal,
    createEffect,
    createMemo,
    batch,
    on,
    onMount,
    onCleanup,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { vaultStore, type FileContent } from "./stores/vault";
import { editorStore, type ViewMode } from "./stores/editor";
import { settingsStore } from "./stores/settings";
import { loadWorkspace, saveWorkspace, scheduleSave, type WorkspaceState } from "./stores/workspace";
import {
    pluginStore,
    hasPluginViewForExtension,
    isPluginSaving,
} from "./stores/plugins";
import {
    FileTree,
    SortBar,
    allFoldersCollapsed,
    resetFolderVisibilityState,
    loadFolderState,
    saveFolderState,
    setAllFoldersVisibility,
    revealFileInTree,
    type SortMode,
    type SortOrder,
} from "./components/sidebar/FileTree";
import { Outline } from "./components/sidebar/Outline";
import {
    SearchPanel,
    cancelInFlightSearch as cancelGlobalSearch,
} from "./components/sidebar/SearchPanel";
import { Calendar } from "./components/sidebar/Calendar";
import { TabBar } from "./components/tabs/TabBar";
import { Toolbar } from "./components/editor/Toolbar";
import { ConfirmDialog } from "./components/common/ConfirmDialog";
import { StatusBar } from "./components/common/StatusBar";
import { WelcomeScreen } from "./components/common/WelcomeScreen";
import { CommandPalette } from "./components/common/CommandPalette";
import { GotoLinePanel } from "./components/common/GotoLinePanel";
import { SettingsModal } from "./components/settings/SettingsModal";
import { WindowControls } from "./components/common/TitleBar";
import { ImageViewer } from "./components/common/ImageViewer";
import { ScreenshotOverlay } from "./components/screenshot/ScreenshotOverlay";
import { createPersistableWindowState } from "./utils/windowState";
import {
    register,
    unregister,
    isRegistered,
} from "@tauri-apps/plugin-global-shortcut";
import { promptDialog } from "./components/common/ConfirmDialog";
import { openFileRouted } from "./utils/openFileRouted";
import { t } from "./i18n";
import { getClientPlatform } from "./utils/platform";
import { SplitDirection, PaneSlot } from "./types/app";
import { normalizeVaultPath } from "./utils/aiHistory";
import { AiBottomPanel } from "./components/ai/AiBottomPanel";
import { SplitWorkspaceView } from "./components/workspace/SplitWorkspaceView";
import { VaultSwitcher } from "./components/sidebar/VaultSwitcher";
import { useScreenshot } from "./hooks/useScreenshot";
import { usePdfExport } from "./hooks/usePdfExport";
import { useAiPanel } from "./hooks/useAiPanel";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";

type SidebarTab = "files" | "outline" | "search" | "calendar";

const CLIENT_PLATFORM = getClientPlatform();
const IS_MAC_CHROME = CLIENT_PLATFORM === "macos";

const App: Component = () => {
    // If the window was created via `open_image_in_new_window`, the
    // URL carries `image_viewer=1` plus a vault_path/file_path. In that
    // case we render ONLY the ImageViewer component — no sidebar, no
    // editor, no plugin system, no bootstrapping/workspace-restore
    // machinery. This is what lets an image .png pop up in a tiny
    // clean viewer window instead of the full app.
    {
        const params = new URLSearchParams(window.location.search);
        if (params.get("image_viewer") === "1") {
            return (
                <ImageViewer
                    vaultPath={params.get("vault_path") ?? ""}
                    filePath={params.get("file_path") ?? ""}
                />
            );
        }
    }

    const [showCommandPalette, setShowCommandPalette] = createSignal(false);
    // Ctrl+P opens the palette in "commands" mode (commands only);
    // Ctrl+O opens it in "files" mode (notes + a synthetic "Create"
    // entry when the query doesn't match an existing file). See the
    // keydown branch for `command-palette` / `command-palette-alt`.
    const [commandPaletteMode, setCommandPaletteMode] = createSignal<
        "commands" | "files"
    >("commands");
    // Ctrl+G goto-line popup. A compact floating widget; on Enter it
    // dispatches `mindzj:editor-command` with `goto-line`, which
    // both Editor and ReadingView already handle (scroll + 1s line
    // flash in the shared `.mz-search-flash` colour).
    const [showGotoLine, setShowGotoLine] = createSignal(false);
    const [showSettings, setShowSettings] = createSignal(false);
    const [sidebarTab, setSidebarTab] = createSignal<SidebarTab>("files");
    const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
    const [showVaultMenu, setShowVaultMenu] = createSignal(false);
    const [sortMode, setSortMode] = createSignal<SortMode>("custom");
    const [sortOrder, setSortOrder] = createSignal<SortOrder>("asc");
    const [sidebarWidth, setSidebarWidth] = createSignal(260);
    const [primaryPanePath, setPrimaryPanePath] = createSignal<string | null>(
        null,
    );
    const [secondaryPanePath, setSecondaryPanePath] = createSignal<
        string | null
    >(null);
    const [activePaneSlot, setActivePaneSlot] =
        createSignal<PaneSlot>("primary");
    const [splitDirection, setSplitDirection] =
        createSignal<SplitDirection>("right");
    const [splitRatio, setSplitRatio] = createSignal(0.5);
    const startupParams = new URLSearchParams(window.location.search);
    const startupVaultPath = startupParams.get("vault_path");
    const startupVaultName = startupParams.get("vault_name");
    const startupFilePath = startupParams.get("file_path");
    const startupViewMode = startupParams.get("view_mode");
    const startupUiZoomParam = startupParams.get("ui_zoom");
    const startupUiZoom = startupUiZoomParam
        ? Number(startupUiZoomParam)
        : null;
    const [startupPayloadApplied, setStartupPayloadApplied] =
        createSignal(false);
    const isTransientWindow = () => startupParams.get("split") === "1";
    // Voice recording refs — moved to useAiPanel hook

    // When the app restarts with a previously-opened vault saved in
    // localStorage, onMount will asynchronously restore it. Between the
    // first SolidJS render and that restore completing, the render
    // logic would otherwise show <WelcomeScreen/> for ~100ms — a
    // visible "welcome page flash" the user complained about.
    //
    // The fix: detect at construction time whether we're about to
    // restore a vault (either from URL params or from localStorage)
    // and start in a `bootstrapping` state that renders a blank dark
    // canvas instead of either welcome or main UI. Once onMount
    // finishes the restore attempt — successfully or not — we drop
    // out of bootstrapping and the normal <Show when={vaultInfo()}>
    // render takes over. If there's nothing to restore, we skip
    // bootstrapping entirely and go straight to the welcome screen.
    const hasRestorableVault = (() => {
        if (startupParams.get("vault_path") && startupParams.get("vault_name"))
            return true;
        try {
            return !!localStorage.getItem("mindzj-last-vault");
        } catch {
            return false;
        }
    })();
    const [isBootstrapping, setIsBootstrapping] =
        createSignal(hasRestorableVault);
    let workspaceRestoreInProgress = false;

    // Recently-closed tab history (LIFO stack of vault-relative
    // file paths). Used by Ctrl+T to "reopen the last closed tab",
    // mirroring the same shortcut in browsers / .
    //
    // The stack is bounded so a user who closes thousands of tabs in
    // a long session doesn't accumulate unbounded state. The most
    // recent entry is at the END of the array (LIFO push/pop).
    const MAX_CLOSED_HISTORY = 50;
    const [closedTabsHistory, setClosedTabsHistory] = createSignal<string[]>(
        [],
    );

    function pushClosedTab(path: string) {
        setClosedTabsHistory((prev) => {
            // De-dupe: drop any earlier occurrence of the same path
            // so closing a file that was already in history bumps it
            // to the top instead of leaving stale duplicates that
            // would Ctrl+T-reopen the same file twice in a row.
            const deduped = prev.filter((p) => p !== path);
            const next = [...deduped, path];
            // Cap from the OLD end (drop oldest entries first).
            return next.length > MAX_CLOSED_HISTORY
                ? next.slice(next.length - MAX_CLOSED_HISTORY)
                : next;
        });
    }

    function reopenLastClosedTab() {
        const history = closedTabsHistory();
        if (history.length === 0) return;
        const path = history[history.length - 1];
        // Pop FIRST, then reopen — popping after reopen would risk
        // leaving the entry stuck in the stack if openFileRouted
        // throws synchronously somewhere we don't expect.
        setClosedTabsHistory((prev) => prev.slice(0, -1));
        void openFileRouted(path);
    }

    // Ephemeral "shortcut fired" toast. Lets us verify, without
    // needing to open devtools, whether a keyboard shortcut handler
    // actually ran. When a path calls `showShortcutToast(msg)` the
    // toast appears top-center for 1.2s then fades out. Used by
    // `switchOpenTab` so the user can SEE that the handler fired
    // even if tab switching itself looks like it didn't do anything
    // (e.g. only one tab open, so prev/next is a no-op).
    const [shortcutToast, setShortcutToast] = createSignal<string | null>(null);
    let shortcutToastTimer: ReturnType<typeof setTimeout> | null = null;
    function showShortcutToast(message: string) {
        setShortcutToast(message);
        if (shortcutToastTimer) clearTimeout(shortcutToastTimer);
        shortcutToastTimer = setTimeout(() => setShortcutToast(null), 1200);
    }

    // Hooks
    const screenshot = useScreenshot({ showToast: showShortcutToast });
    const pdfExport = usePdfExport({ showToast: showShortcutToast });
    const aiPanel = useAiPanel({ vaultPath: () => vaultStore.vaultInfo()?.path });

    // PDF export functions — moved to usePdfExport hook

    const uiScale = createMemo(() => editorStore.uiZoom() / 100);
    const activePanePath = createMemo(() =>
        activePaneSlot() === "secondary"
            ? (secondaryPanePath() ?? primaryPanePath())
            : primaryPanePath(),
    );
    // AI panel memos — moved to useAiPanel hook
    const splitPaneActive = createMemo(() => secondaryPanePath() !== null);

    // AI panel effects — moved to useAiPanel hook

    // Screenshot signals — moved to useScreenshot hook

    function isViewMode(value: string | null): value is ViewMode {
        return (
            value === "source" ||
            value === "live-preview" ||
            value === "reading"
        );
    }

    function resolveDefaultViewMode(
        value: string | null | undefined,
    ): ViewMode {
        switch (value) {
            case "Source":
            case "source":
                return "source";
            case "Reading":
            case "reading":
                return "reading";
            case "LivePreview":
            case "live-preview":
            default:
                return "live-preview";
        }
    }

    function buildDefaultSidebarTabs(): {
        id: SidebarTab;
        title: string;
        icon: string;
    }[] {
        return [
            {
                id: "files",
                title: t("sidebar.files"),
                icon: "M3 3h7l2 2h5a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z",
            },
            {
                id: "outline",
                title: t("sidebar.outline"),
                icon: "M4 6h16M4 10h10M4 14h13M4 18h7",
            },
            {
                id: "search",
                title: t("sidebar.search"),
                icon: "M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z",
            },
            {
                id: "calendar",
                title: t("sidebar.calendar"),
                icon: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
            },
        ];
    }


    function buildWorkspaceSnapshot(): Partial<WorkspaceState> {
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
            sidebar_tab_order: sidebarTabs().map((tab) => tab.id),
            file_scroll_positions: editorStore.fileScrollPositions(),
            file_top_lines: editorStore.fileTopLines(),
            file_view_modes: editorStore.fileViewModes(),
            file_last_non_reading_view_modes:
                editorStore.fileLastNonReadingViewModes(),
        };
    }

    function getPanePath(slot: PaneSlot): string | null {
        return slot === "primary" ? primaryPanePath() : secondaryPanePath();
    }

    function setPanePath(slot: PaneSlot, path: string | null) {
        if (slot === "primary") {
            setPrimaryPanePath(path);
            return;
        }
        setSecondaryPanePath(path);
    }

    let splitOpenOperationId = 0;
    let suppressActiveFilePaneSyncDepth = 0;

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
            const activeFile = findOpenFile(activePath);
            if (activeFile) {
                vaultStore.setActiveFile(activeFile);
            }
        });
    }

    function isSplitDirection(value: unknown): value is SplitDirection {
        return (
            value === "left" ||
            value === "right" ||
            value === "up" ||
            value === "down"
        );
    }

    function isPaneSlot(value: unknown): value is PaneSlot {
        return value === "primary" || value === "secondary";
    }

    function normalizeSplitRatio(value: unknown): number {
        return typeof value === "number" && Number.isFinite(value)
            ? Math.max(0.2, Math.min(0.8, value))
            : 0.5;
    }

    function findOpenFile(path: string | null | undefined): FileContent | null {
        if (!path) return null;
        return (
            vaultStore.openFiles().find((file) => file.path === path) ?? null
        );
    }

    function activatePane(slot: PaneSlot) {
        setActivePaneSlot(slot);
        const path = getPanePath(slot);
        const file = findOpenFile(path);
        if (file) {
            vaultStore.setActiveFile(file);
        }
    }

    function closeSplitPane(slot: PaneSlot) {
        if (slot === "secondary") {
            setSecondaryPanePath(null);
            activatePane("primary");
            return;
        }

        const secondary = secondaryPanePath();
        if (secondary) {
            setPrimaryPanePath(secondary);
            setSecondaryPanePath(null);
            activatePane("primary");
        }
    }

    function handleTabSelect(path: string) {
        document.dispatchEvent(
            new CustomEvent("mindzj:remember-active-viewport"),
        );
        setPanePath(activePaneSlot(), path);
        vaultStore.switchToFile(path);
    }

    async function handleSidebarFileClick(path: string) {
        document.dispatchEvent(
            new CustomEvent("mindzj:remember-active-viewport"),
        );
        const targetSlot = activePaneSlot();
        await openFileRouted(path);
        const file = findOpenFile(path);
        if (!file) return;
        setPanePath(targetSlot, path);
        setActivePaneSlot(targetSlot);
        vaultStore.setActiveFile(file);
        if (!primaryPanePath()) {
            setPrimaryPanePath(path);
        }
    }

    function switchOpenTab(direction: "prev" | "next"): boolean {
        const files = vaultStore.openFiles();
        // Fire the visible toast unconditionally — if the user sees
        // it, they know the shortcut reached this function. If they
        // don't, we know the keyboard event never made it here (which
        // is the interesting debugging signal).
        showShortcutToast(
            direction === "prev"
                ? `← tab (${files.length} open)`
                : `tab → (${files.length} open)`,
        );

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

        handleTabSelect(next.path);
        return true;
    }

    function handleTabClose(path: string) {
        // Snapshot the open files BEFORE closing so we can compute
        // which tab to focus next based on the closed tab's position.
        const openFilesBefore = vaultStore.openFiles();
        const closedIndex = openFilesBefore.findIndex((f) => f.path === path);
        if (closedIndex === -1) return;

        const remainingPaths = openFilesBefore
            .filter((file) => file.path !== path)
            .map((file) => file.path);

        // Push the closed path onto the recently-closed history so
        // the user can reopen it with Ctrl+T. We do this BEFORE the
        // actual close so we don't end up with an inconsistent state
        // if anything below throws.
        pushClosedTab(path);

        const primaryBefore = primaryPanePath();
        const secondaryBefore = secondaryPanePath();
        const activeBefore = activePaneSlot();

        vaultStore.closeFile(path);

        // Replacement-picker policy:
        //   1. Prefer the LEFT neighbour of the closed tab — i.e. the
        //      file that sits at index `closedIndex - 1` in the
        //      original openFiles array. After removal it's at the
        //      same index in `remainingPaths`.
        //   2. If the closed tab was the LEFTMOST (closedIndex === 0),
        //      fall back to the new leftmost (which used to be at
        //      index 1, and is now at index 0 in `remainingPaths`).
        //   3. If `exclude` is given (because the OTHER pane is already
        //      showing that candidate and we don't want both panes
        //      pointing at the same file), skip past it in either
        //      direction.
        const pickReplacement = (
            exclude: string | null = null,
        ): string | null => {
            if (remainingPaths.length === 0) return null;

            // Build the search order: left neighbour first, then walk
            // further LEFT, then walk RIGHT from the original position.
            // This way "select the closest existing tab" works even
            // when the immediate neighbour also happens to be excluded.
            const order: number[] = [];
            for (let i = closedIndex - 1; i >= 0; i--) order.push(i);
            // After removal, indices >= closedIndex shift down by one,
            // but the i-th remaining file IS the original (i+1)-th
            // file. We want to traverse those in the original order,
            // which corresponds to remaining indices `closedIndex,
            // closedIndex+1, …` IF closedIndex < remainingPaths.length.
            for (let i = closedIndex; i < remainingPaths.length; i++)
                order.push(i);

            for (const idx of order) {
                const candidate = remainingPaths[idx];
                if (candidate && candidate !== exclude) return candidate;
            }
            return null;
        };

        // Pane reassignment. If a pane was pointing at the closed
        // file, replace it with the picker's choice; the OTHER pane
        // is unaffected unless both happened to point at the same
        // (now closed) file.
        let nextPrimary =
            primaryBefore === path
                ? pickReplacement(
                      secondaryBefore === path ? null : secondaryBefore,
                  )
                : primaryBefore;
        let nextSecondary =
            secondaryBefore === path
                ? pickReplacement(nextPrimary)
                : secondaryBefore;

        if (nextSecondary === nextPrimary && nextSecondary !== null) {
            nextSecondary = pickReplacement(nextPrimary);
        }

        if (!remainingPaths.length) {
            nextPrimary = null;
            nextSecondary = null;
        }

        setPrimaryPanePath(nextPrimary);
        setSecondaryPanePath(nextSecondary);

        const nextSlot =
            activeBefore === "secondary" && nextSecondary
                ? "secondary"
                : "primary";
        setActivePaneSlot(nextSlot);
        const nextActivePath =
            nextSlot === "secondary" ? nextSecondary : nextPrimary;
        const nextActiveFile = findOpenFile(nextActivePath);
        if (nextActiveFile) {
            vaultStore.setActiveFile(nextActiveFile);
        }
    }

    async function handleOpenSplitInPane(
        path: string,
        direction: SplitDirection,
    ) {
        const operationId = ++splitOpenOperationId;
        // Cooperatively cancel any in-flight sidebar global search
        // BEFORE we start the split. Spinning up a new Editor
        // (secondary pane) while the search loop is still hammering
        // `invoke("read_file")` in 16-wide batches used to freeze
        // the app — the main thread has to share time between CM6
        // init + decoration building on one side and N more file-
        // read promises on the other, and both contended for IPC.
        // The sidebar search can easily be re-run later once the
        // split has settled; interrupting it here is the cheapest
        // way to guarantee the split open stays snappy.
        cancelGlobalSearch();
        // ═══════════════════════════════════════════════════════════
        //  Unified Split-into-pane routine
        // ═══════════════════════════════════════════════════════════
        //
        // Deterministic end-state placement — the old implementation
        // dispatched state in several phases and then tried to "un-do"
        // the side effects that `openFileRouted` triggered through the
        // `activeFile → active pane path` createEffect. That race
        // re-entered the pane signals rapidly and, when applied to an
        // already-split layout, caused the CM6 editor in one of the
        // panes to destroy/recreate multiple times in the same
        // microtask batch — which looked like a hard freeze on screens
        // the user had already split once.
        //
        // The rewrite computes the FINAL (primary, secondary, slot,
        // direction) tuple up front and then does a single deterministic
        // write of each signal. The behaviour matches the rules the
        // user spelled out:
        //
        //   1. No existing split → open a fresh split per `direction`.
        //   2. Already split on the SAME axis as `direction` → just
        //      replace the slot the direction points at with `path`,
        //      without touching the other pane or flipping the layout.
        //   3. Already split on the OPPOSITE axis → rebuild the split
        //      in the new direction, keeping the focused pane's file
        //      on one side and `path` on the other.
        //
        // Plugin-backed files (`.mindzj` etc.) also take this path:
        // `mountPluginView` generates a unique mount handle per call,
        // so the same file can sit in primary and secondary at once.

        // Snapshot EVERYTHING we need BEFORE any await so the values
        // can't be mutated out from under us by the active-file
        // createEffect while openFileRouted yields.
        //
        // `previousPrimary` / `previousSecondary` are what each pane
        // was showing BEFORE `openFileRouted(path)` ran — we need them
        // because that call does `setActiveFile(path)`, which the
        // `on(vaultStore.activeFile, …)` effect below will react to
        // by writing the new path into whichever slot is currently
        // active. Without these snapshots Case 2's "just replace one
        // pane" would accidentally restore the active pane from the
        // CLOBBERED value, and the other pane would flicker.
        const previousActivePath =
            activePanePath() ?? vaultStore.activeFile()?.path ?? null;
        const previousPrimary = primaryPanePath();
        const previousSecondary = secondaryPanePath();
        const wasSplit = splitPaneActive();
        const currentDirection = splitDirection();

        if (!findOpenFile(path)) {
            suppressActiveFilePaneSyncDepth++;
            try {
                await openFileRouted(path);
            } finally {
                suppressActiveFilePaneSyncDepth = Math.max(
                    0,
                    suppressActiveFilePaneSyncDepth - 1,
                );
            }
            if (operationId !== splitOpenOperationId) return;
            if (!findOpenFile(path)) return;
        }

        // With no previous active path this is the very first tab the
        // user is opening — just drop it into primary, no split.
        if (!previousActivePath) {
            commitPaneLayout(path, null, "primary");
            return;
        }

        const isHorizontal = (d: SplitDirection) =>
            d === "left" || d === "right";
        const newAxisHorizontal = isHorizontal(direction);
        const oldAxisHorizontal = isHorizontal(currentDirection);

        // ── Case 1: no existing split yet ────────────────────────────
        if (!wasSplit) {
            if (direction === "left" || direction === "up") {
                // `path` becomes the primary (left/top); previously
                // active file slides into the secondary slot.
                commitPaneLayout(path, previousActivePath, "primary", direction);
            } else {
                // right/down: `path` becomes secondary.
                commitPaneLayout(previousActivePath, path, "secondary", direction);
            }
            return;
        }

        // ── Case 2: already split on the same axis ───────────────────
        // User just wants to REPLACE one of the two visible panes.
        // "right" / "down" → secondary; "left" / "up" → primary.
        // Direction itself stays unchanged (we keep the current axis).
        //
        // We explicitly write BOTH pane paths (even the one we don't
        // mean to change) so the earlier `activeFile` createEffect's
        // clobber of the active slot gets undone.
        if (newAxisHorizontal === oldAxisHorizontal) {
            if (direction === "right" || direction === "down") {
                commitPaneLayout(previousPrimary, path, "secondary");
            } else {
                commitPaneLayout(path, previousSecondary, "primary");
            }
            return;
        }

        // ── Case 3: already split on the OPPOSITE axis ───────────────
        // Rebuild the split in the new direction. The focused pane's
        // file stays, the OTHER pane's file is dropped from the layout
        // (still open in the tab strip, just no longer assigned to a
        // pane). The new file (`path`) takes the slot dictated by
        // `direction`.
        if (direction === "left" || direction === "up") {
            commitPaneLayout(path, previousActivePath, "primary", direction);
        } else {
            commitPaneLayout(previousActivePath, path, "secondary", direction);
        }
    }

    createEffect(
        on(
            () => vaultStore.activeFile()?.path ?? null,
            (path) => {
                if (suppressActiveFilePaneSyncDepth > 0) return;
                if (!path) return;
                if (getPanePath(activePaneSlot()) !== path) {
                    setPanePath(activePaneSlot(), path);
                }
                if (!primaryPanePath()) {
                    setPrimaryPanePath(path);
                }
            },
        ),
    );

    createEffect(() => {
        const openPaths = new Set(
            vaultStore.openFiles().map((file) => file.path),
        );
        const primary = primaryPanePath();
        const secondary = secondaryPanePath();

        if (primary && !openPaths.has(primary)) {
            setPrimaryPanePath(vaultStore.activeFile()?.path ?? null);
        } else if (!primary && vaultStore.activeFile()) {
            setPrimaryPanePath(vaultStore.activeFile()!.path);
        }

        if (secondary && !openPaths.has(secondary)) {
            setSecondaryPanePath(null);
        }
    });

    async function flushWorkspaceNow() {
        if (!vaultStore.vaultInfo() || isTransientWindow()) return;
        document.dispatchEvent(
            new CustomEvent("mindzj:remember-active-viewport"),
        );
        await Promise.all([
			await saveWorkspace(buildWorkspaceSnapshot()),
            saveFolderState(),
        ]);
    }

    async function closeCurrentVault() {
        await flushWorkspaceNow();
        vaultStore.closeVault();
        editorStore.resetWorkspaceState();
        resetFolderVisibilityState();
    }

    // startScreenshot & handleScreenshotSave — moved to useScreenshot hook

    onMount(async () => {
        window.__mindzj_flush_workspace = flushWorkspaceNow;
        window.__mindzj_switch_open_tab = switchOpenTab;
        document.body.style.removeProperty("zoom");
        document.documentElement.style.removeProperty("font-size");

        if (startupUiZoom !== null && Number.isFinite(startupUiZoom)) {
            editorStore.setUiZoom(startupUiZoom);
        }

        // Disable the native browser/webview context menu globally so that
        // items like Refresh, Save as, Print, Insert never appear.
        // Individual components (e.g. editor images, plugin views) install
        // their own contextmenu handlers that call stopPropagation, so
        // those custom menus still work.
        const suppressNativeContextMenu = (e: MouseEvent) => {
            e.preventDefault();
        };
        document.addEventListener(
            "contextmenu",
            suppressNativeContextMenu,
            true,
        );
        onCleanup(() =>
            document.removeEventListener(
                "contextmenu",
                suppressNativeContextMenu,
                true,
            ),
        );
        onCleanup(() => {
            if (window.__mindzj_switch_open_tab === switchOpenTab) {
                window.__mindzj_switch_open_tab = null;
            }
        });

        // NOTE: the global screenshot shortcut is registered by the
        // dedicated `createEffect` further below — we used to ALSO
        // register it here, which caused the OS to see two register()
        // calls in the same boot and emit "HotKey already registered:
        // KeyG" warnings on every startup. The createEffect handles
        // both the initial registration AND re-registration when the
        // user changes the hotkey in Settings, so this onMount block
        // is now redundant and removed.

        // ── Listen for plugin settings open requests ──
        const handleOpenSettings = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            setShowSettings(true);
            if (detail?.pluginId) {
                // Dispatch a follow-up event that the SettingsModal can use
                // to navigate to the specific plugin settings tab.
                setTimeout(() => {
                    document.dispatchEvent(
                        new CustomEvent("mindzj:settings-navigate", {
                            detail: { pluginId: detail.pluginId },
                        }),
                    );
                }, 100);
            }
        };
        document.addEventListener("mindzj:open-settings", handleOpenSettings);
        onCleanup(() =>
            document.removeEventListener(
                "mindzj:open-settings",
                handleOpenSettings,
            ),
        );

        const handleToggleAiPanel = () => {
            aiPanel.setShowAiPanel((value) => !value);
        };
        document.addEventListener(
            "mindzj:toggle-ai-panel",
            handleToggleAiPanel,
        );
        onCleanup(() =>
            document.removeEventListener(
                "mindzj:toggle-ai-panel",
                handleToggleAiPanel,
            ),
        );


        const handleAppCommand = (e: Event) => {
            const command = (e as CustomEvent).detail?.command;
            if (
                command === "toggle-left-sidebar" ||
                command === "toggle-right-sidebar"
            ) {
                setSidebarCollapsed((v) => !v);
            }
        };
        document.addEventListener("mindzj:app-command", handleAppCommand);
        onCleanup(() =>
            document.removeEventListener(
                "mindzj:app-command",
                handleAppCommand,
            ),
        );
        onCleanup(() => {
            if (
                window.__mindzj_flush_workspace === flushWorkspaceNow
            ) {
                delete window.__mindzj_flush_workspace;
            }
        });

        // ── Window state: Rust applies the saved geometry BEFORE the window
        //    is shown (see settings_api::apply_window_state in setup hook),
        //    so the frontend only needs to PERSIST subsequent changes. ──
        const _aw = getCurrentWindow();

        // ── Window state: save on move/resize (debounced) ──
        async function captureAndSaveWindowState() {
            if (isTransientWindow()) return;
            try {
                const maximized = await _aw.isMaximized();
                const minimized = await _aw.isMinimized();
                // Don't save position/size when maximized — restore the pre-maximized geometry
                if (maximized) {
                    await invoke("save_window_state", {
                        windowState: { maximized: true },
                    });
                    return;
                }
                if (minimized) {
                    return;
                }
                const pos = await _aw.outerPosition();
                const size = await _aw.outerSize();
                const sf = await _aw.scaleFactor();
                const windowState = createPersistableWindowState({
                    x: pos.x / sf,
                    y: pos.y / sf,
                    width: size.width / sf,
                    height: size.height / sf,
                });
                if (!windowState) {
                    return;
                }
                await invoke("save_window_state", { windowState });
            } catch (e) {
                console.warn("[Window] Failed to save window state:", e);
            }
        }
        let _winSaveTimer: ReturnType<typeof setTimeout> | null = null;
        const debouncedSaveWindowState = () => {
            if (_winSaveTimer) clearTimeout(_winSaveTimer);
            _winSaveTimer = setTimeout(captureAndSaveWindowState, 500);
        };
        const unlistenResize = await _aw.onResized(debouncedSaveWindowState);
        const unlistenMove = await _aw.onMoved(debouncedSaveWindowState);
        // NOTE: we deliberately do NOT register an `onCloseRequested`
        // handler. Registering one — even a fire-and-forget one — was
        // making the close button unresponsive on Windows. The WindowControls
        // titlebar button now performs a synchronous final save and then
        // calls `appWindow.destroy()` itself, which bypasses the close-
        // request event entirely. The debounced move/resize saves above
        // already keep the window geometry up-to-date, so we never lose
        // more than 500ms of movement on the hard-close path.
        onCleanup(() => {
            unlistenResize();
            unlistenMove();
        });

        // Listen for file system watcher events from Rust backend
        listen<{ kind: string; path?: string; from?: string; to?: string }>(
            "file-changed",
            async (event) => {
                const e = event.payload;
                if (e.kind === "Modified" && e.path) {
                    // Skip reload if a plugin is currently saving this file.
                    // Re-loading would reset in-memory plugin state (e.g., node selection
                    // after pressing Tab to add a child node in the mindmap plugin).
                    if (!isPluginSaving(e.path)) {
                        // Use reloadFile so that a background save on tab A
                        // (or an external editor change) never yanks the user
                        // off whatever tab they currently have focused.
                        const openFile = vaultStore
                            .openFiles()
                            .find((f) => f.path === e.path);
                        if (openFile) {
                            await vaultStore.reloadFile(e.path!);
                        }
                    }
                }
                // Refresh file tree for any change
                await vaultStore.refreshFileTree();
            },
        );

        // Auto-open vault from URL params (for new-window vault opening)
        if (startupVaultPath && startupVaultName) {
            try {
                await vaultStore.openVault(startupVaultPath, startupVaultName);
            } catch (e) {
                console.error("Failed to auto-open vault from URL params:", e);
            }
        } else {
            // No URL params — try to restore last opened vault
            try {
                const last = localStorage.getItem("mindzj-last-vault");
                const savedVaults = localStorage.getItem("mindzj-vault-list");
                if (last) {
                    const { name, path } = JSON.parse(last);
                    const parsedVaults = savedVaults
                        ? JSON.parse(savedVaults)
                        : [];
                    const stillListed =
                        Array.isArray(parsedVaults) &&
                        parsedVaults.some(
                            (vault: { path?: string }) =>
                                normalizeVaultPath(vault.path) ===
                                normalizeVaultPath(path),
                        );
                    if (name && path && stillListed) {
                        await vaultStore.openVault(path, name);
                    } else if (!stillListed) {
                        localStorage.removeItem("mindzj-last-vault");
                    }
                }
            } catch {
                // Ignore — show welcome screen
            }
        }
        // Fail-safe: if the vault open didn't actually succeed (file
        // gone, permission denied, missing from list, etc.) the
        // workspace-restore createEffect won't fire and would leave
        // us stuck on the dark canvas forever. In that case drop the
        // gate now so the welcome screen shows.
        //
        // The HAPPY path — vaultInfo() became truthy — leaves
        // bootstrapping ON; the workspace-restore createEffect will
        // drop the gate AFTER it has loaded the workspace, opened all
        // saved tabs, switched to the active tab and mounted plugin
        // views. That avoids the visible "empty main area → tabs
        // appear one by one → final settled state" flicker the user
        // was reporting.
        if (!vaultStore.vaultInfo()) {
            setIsBootstrapping(false);
        }
    });

    // Screenshot hotkey lifecycle — moved to useScreenshot hook

    // ─────────────────────────────────────────────────────────────
    //  Ctrl+Alt+Left / Ctrl+Alt+Right — OS-level global shortcuts
    // ─────────────────────────────────────────────────────────────
    //
    // After multiple failed attempts to get this to work via the DOM
    // keydown path, we ALSO register at the OS level via Tauri's
    // global-shortcut plugin. The most likely explanation for the
    // DOM path never firing on the user's machine is that Windows'
    // Intel Graphics Command Center hijacks Ctrl+Alt+Arrow at the OS
    // level for screen rotation BEFORE the webview even sees the
    // keypress. Registering at the OS level tells Windows "this app
    // owns this shortcut" and typically supersedes the graphics
    // driver binding.
    //
    // Key design decisions vs. earlier versions of this block:
    //  - NO `isFocused()` check. Previously we bailed out of the
    //    callback if another window was on top, but `isFocused()` is
    //    async and racing with the keydown → the first press would
    //    sometimes resolve false even though the user was actively
    //    focused on MindZJ. Now we just switch unconditionally. A
    //    global shortcut fire while another app is on top is a
    //    corner case the user would have to go out of their way to
    //    produce; if it matters we can re-add focus filtering later.
    //  - We call `switchOpenTab` SYNCHRONOUSLY from inside the
    //    plugin-global-shortcut callback. It triggers the visible
    //    toast, which is our smoke-test signal.
    //  - `isRegistered()` is called immediately after `register()`
    //    so the user-facing log shows whether registration actually
    //    succeeded. If it didn't, the most likely cause is another
    //    application (or OS component) already claiming the key.
    onMount(async () => {
        const tryRegister = async (
            combo: string,
            direction: "prev" | "next",
        ) => {
            try {
                await register(combo, (event) => {
                    if (event.state === "Pressed") switchOpenTab(direction);
                });
                const ok = await isRegistered(combo).catch(() => false);
            } catch (err) {
                console.warn(
                    `[GlobalShortcut] register('${combo}') failed:`,
                    err,
                );
            }
        };
        await tryRegister("CommandOrControl+Alt+Left", "prev");
        await tryRegister("CommandOrControl+Alt+Right", "next");

        // Listen for the `mindzj://tab-switch` event emitted by the
        // Rust-side Windows low-level keyboard hook
        // (src-tauri/src/keyboard_hook.rs). That hook catches
        // Ctrl+Alt+Left/Right at the kernel-driver level, BEFORE
        // Intel/AMD graphics drivers can intercept them for screen
        // rotation. The payload is the string "prev" or "next".
        // This is the "nuclear option" path — it should always
        // fire on Windows whether or not any of the higher-level
        // (DOM keydown, RegisterHotKey) paths manage to see the
        // event first.
        const unlistenTabSwitch = await listen<string>(
            "mindzj://tab-switch",
            (event) => {
                const direction = event.payload === "prev" ? "prev" : "next";
                switchOpenTab(direction);
            },
        );

        onCleanup(() => {
            unregister("CommandOrControl+Alt+Left").catch(() => {});
            unregister("CommandOrControl+Alt+Right").catch(() => {});
            try {
                unlistenTabSwitch();
            } catch {}
        });
    });

    // Update window title when vault changes
    createEffect(() => {
        const info = vaultStore.vaultInfo();
        if (info) {
            document.title = `MindZJ — ${info.name}`;
            // Record last opened vault
            localStorage.setItem(
                "mindzj-last-vault",
                JSON.stringify({ name: info.name, path: info.path }),
            );
        } else {
            document.title = "MindZJ";
        }
    });

    // Restore workspace and load plugins when vault opens.
    //
    // CRITICAL: `defer: true` is required. Without it, this effect
    // fires on initial mount with `vaultInfo() === null` (because
    // onMount hasn't started the openVault call yet), hits the else
    // branch and would drop the bootstrapping gate prematurely — the
    // user would see a one-frame flash of the welcome screen before
    // the real vault loads. With `defer: true`, the effect only runs
    // when vaultInfo() ACTUALLY transitions (null → vault, or
    // vault → null). The initial null state is silently skipped.
    createEffect(
        on(
            () => vaultStore.vaultInfo()?.path ?? null,
            async () => {
                const info = vaultStore.vaultInfo();
                resetFolderVisibilityState();
                editorStore.resetWorkspaceState();
                if (info) {
                    workspaceRestoreInProgress = true;
                    const loadedSettings = await settingsStore.loadSettings();
                    // If the user picked a language on the welcome screen before
                    // this vault existed, apply it now so the new vault's
                    // settings.json persists the right locale. This is a
                    // one-shot override — we delete the key after consuming it
                    // so later vault switches use the vault's own locale.
                    try {
                        const pendingLocale = localStorage.getItem(
                            "mindzj-pending-locale",
                        );
                        if (
                            pendingLocale &&
                            pendingLocale !== loadedSettings.locale
                        ) {
                            await settingsStore.updateSetting(
                                "locale",
                                pendingLocale,
                            );
                        }
                        if (pendingLocale) {
                            localStorage.removeItem("mindzj-pending-locale");
                        }
                    } catch (e) {
                        console.warn(
                            "[vault-open] pending locale apply failed:",
                            e,
                        );
                    }
                    editorStore.setDefaultViewMode(
                        isViewMode(startupViewMode)
                            ? startupViewMode
                            : resolveDefaultViewMode(
                                  loadedSettings.default_view_mode,
                              ),
                    );
                    if (!isTransientWindow()) {
							const ws = await loadWorkspace();
                        editorStore.restoreWorkspaceState(ws);
                        // Restore sidebar state
                        if (ws.sidebar_tab)
                            setSidebarTab(ws.sidebar_tab as SidebarTab);
                        setSidebarCollapsed(!!ws.sidebar_collapsed);
                        if (ws.sidebar_width) setSidebarWidth(ws.sidebar_width);
                        const defaultTabs = buildDefaultSidebarTabs();
                        if (ws.sidebar_tab_order?.length) {
                            const reordered = ws.sidebar_tab_order
                                .map((id) =>
                                    defaultTabs.find((tab) => tab.id === id),
                                )
                                .filter(Boolean) as typeof defaultTabs;
                            for (const tab of defaultTabs) {
                                if (
                                    !reordered.find(
                                        (item) => item.id === tab.id,
                                    )
                                ) {
                                    reordered.push(tab);
                                }
                            }
                            setSidebarTabs(reordered);
                        } else {
                            setSidebarTabs(defaultTabs);
                        }
                        // Window geometry is restored from global database on app start
                        // (not per-vault) — see onMount above. No override here.
                        // Restore open files
                        const filesToOpen = [...ws.open_files];
                        if (
                            ws.active_file &&
                            !filesToOpen.includes(ws.active_file)
                        ) {
                            filesToOpen.push(ws.active_file);
                        }
                        for (const filePath of filesToOpen) {
                            try {
                                await openFileRouted(filePath);
                            } catch {
                                /* skip missing files */
                            }
                        }
                        const openPaths = new Set(
                            vaultStore.openFiles().map((file) => file.path),
                        );
                        const restoredPrimary =
                            ws.primary_pane_path &&
                            openPaths.has(ws.primary_pane_path)
                                ? ws.primary_pane_path
                                : ws.active_file &&
                                    openPaths.has(ws.active_file)
                                  ? ws.active_file
                                  : (vaultStore.openFiles()[0]?.path ?? null);
                        const restoredSecondary =
                            ws.secondary_pane_path &&
                            openPaths.has(ws.secondary_pane_path)
                                ? ws.secondary_pane_path
                                : null;

                        setPrimaryPanePath(restoredPrimary);
                        setSecondaryPanePath(restoredSecondary);
                        if (isSplitDirection(ws.split_direction)) {
                            setSplitDirection(ws.split_direction);
                        }
                        setSplitRatio(normalizeSplitRatio(ws.split_ratio));

                        const restoredActiveSlot =
                            isPaneSlot(ws.active_pane_slot) &&
                            (ws.active_pane_slot !== "secondary" ||
                                restoredSecondary)
                                ? ws.active_pane_slot
                                : "primary";
                        setActivePaneSlot(restoredActiveSlot);

                        const activePath =
                            restoredActiveSlot === "secondary"
                                ? restoredSecondary
                                : restoredPrimary;
                        if (activePath) {
                            try {
                                vaultStore.switchToFile(activePath);
                            } catch {
                                /* skip */
                            }
                        }
                    }
                    // Load persisted folder expand/collapse state BEFORE the
                    // sidebar becomes visible. Previously this ran in the
                    // FileTree component's own onMount which fires AFTER the
                    // bootstrapping gate drops — so for one frame the user
                    // saw every folder in the default "collapsed" state,
                    // then the saved state snapped in. Loading here keeps
                    // the folder tree visually stable from the first paint.
                    try {
                        await loadFolderState();
                    } catch (e) {
                        console.warn("[vault-open] loadFolderState failed:", e);
                    }
                    // Load enabled plugins
                    await pluginStore.loadAllPlugins();
                    if (
                        !startupPayloadApplied() &&
                        (startupFilePath || isViewMode(startupViewMode))
                    ) {
                        if (startupFilePath) {
                            try {
                                await openFileRouted(startupFilePath);
                            } catch (e) {
                                console.warn(
                                    "Failed to open startup file from URL params:",
                                    e,
                                );
                            }
                        }
                        if (isViewMode(startupViewMode)) {
                            editorStore.setViewMode(startupViewMode);
                        }
                        setStartupPayloadApplied(true);
                    }
                    // Workspace fully restored: tabs are open, the active
                    // tab is selected, plugins are loaded. Drop the
                    // bootstrapping gate so the UI becomes visible. We
                    // wait two animation frames first because:
                    //   1. Solid still has pending effects to flush
                    //      (PluginViewHost's mount effect, Editor's scroll
                    //      restoration createEffect, etc.).
                    //   2. The webview itself needs one paint to draw the
                    //      mounted DOM before we reveal it — otherwise the
                    //      user sees the dark canvas → flash of unstyled
                    //      content → settled state.
                    //
                    // Two RAFs is the minimum delay that guarantees both the
                    // microtask queue AND a full layout/paint cycle have
                    // completed. Total wait is ~32ms at 60 Hz which is
                    // imperceptible to the user.
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            workspaceRestoreInProgress = false;
                            setIsBootstrapping(false);
                        });
                    });
                } else {
                    workspaceRestoreInProgress = false;
                    // Vault closed — unload all plugins. With defer: true on
                    // the on() above, this branch only ever runs when the
                    // user actively closes a vault (truthy → null transition),
                    // never on initial mount. So we DO NOT touch the
                    // bootstrapping gate here; it's handled exclusively by
                    // onMount (fail-safe path) and the truthy branch above.
                    settingsStore.resetSettings();
                    editorStore.resetWorkspaceState();
                    await pluginStore.unloadAllPlugins();
                }
            },
            { defer: true },
        ),
    );

    // Save workspace on changes (debounced)
    createEffect(() => {
        const info = vaultStore.vaultInfo();
        if (!info || isTransientWindow() || workspaceRestoreInProgress) return;
		scheduleSave(buildWorkspaceSnapshot());
    });


    // Sidebar icon tabs config (signal so they can be reordered via drag)
    const [sidebarTabs, setSidebarTabs] = createSignal(
        buildDefaultSidebarTabs(),
    );
    function reorderSidebarTab(fromIdx: number, toIdx: number) {
        const tabs = [...sidebarTabs()];
        const [moved] = tabs.splice(fromIdx, 1);
        tabs.splice(toIdx, 0, moved);
        setSidebarTabs(tabs);
    }

    async function handleNewTab() {
        const n = await promptDialog(
            t("app.noteNamePrompt"),
            t("app.newNoteDefault"),
        );
        if (!n) return;
        const fileName = n.endsWith(".md") ? n : `${n}.md`;
        await vaultStore.createFile(fileName, "");
        await vaultStore.openFile(fileName);
    }

    useKeyboardShortcuts({
        showCommandPalette,
        setShowCommandPalette,
        commandPaletteMode,
        setCommandPaletteMode,
        setShowGotoLine,
        setShowSettings,
        setSidebarTab,
        sidebarTabs,
        sidebarCollapsed,
        setSidebarCollapsed,
        activePanePath,
        activePaneSlot,
        handleNewTab,
        handleTabClose,
        reopenLastClosedTab,
        switchOpenTab,
        aiPanel,
        screenshot,
    });

    function toggleAllFolders() {
        setAllFoldersVisibility(allFoldersCollapsed() ? "expand" : "collapse");
    }

    return (
        <div
            class={`mz-app-root mz-platform-${CLIENT_PLATFORM}`}
            style={{
                display: "flex",
                "flex-direction": "column",
                position: "fixed",
                inset: "0",
                width: `${100 / uiScale()}%`,
                height: `${100 / uiScale()}%`,
                transform: `scale(${uiScale()})`,
                "transform-origin": "top left",
                overflow: "hidden",
                background: "var(--mz-bg-primary)",
            }}>
            {/*
                Bootstrapping gate (OUTER level).

                When the app starts up with a saved vault to restore,
                we render NOTHING but a flat dark canvas covering the
                whole window until:
                  1. the vault has been opened
                  2. workspace.json has been read
                  3. all saved tabs have been loaded into openFiles
                  4. the active tab has been selected
                  5. plugin views have mounted into their hosts
                  6. CodeMirror has had a paint cycle to restore the
                     scroll position of the active editor

                Without this gate the user sees an obvious flicker:
                empty editor → tabs appear one by one → final tab +
                scroll position settle. With this gate they only see
                the dark canvas → fully-loaded UI in one transition.
            */}
            <Show
                when={!isBootstrapping()}
                fallback={
                    <div
                        style={{
                            flex: "1",
                            background: "var(--mz-bg-primary)",
                        }}
                    />
                }>
                <div style={{ display: "flex", flex: "1", overflow: "hidden" }}>
                    {/* ===== SIDEBAR ===== */}
                    <Show when={vaultStore.vaultInfo()}>
                        <aside
                            style={{
                                width: sidebarCollapsed()
                                    ? "0px"
                                    : `${sidebarWidth()}px`,
                                "min-width": sidebarCollapsed()
                                    ? "0px"
                                    : "160px",
                                "max-width": sidebarCollapsed()
                                    ? "0px"
                                    : "600px",
                                background: "var(--mz-bg-secondary)",
                                "border-right": sidebarCollapsed()
                                    ? "none"
                                    : "1px solid var(--mz-border)",
                                display: "flex",
                                "flex-direction": "column",
                                overflow: "hidden",
                                transition: sidebarCollapsed()
                                    ? "width 200ms ease, min-width 200ms ease"
                                    : "none",
                                "flex-shrink": "0",
                                position: "relative",
                            }}>
                            {/* Top icon bar (also drag region) */}
                            <div
                                data-tauri-drag-region
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    "justify-content": "space-between",
                                    padding: "6px 4px",
                                    "border-bottom":
                                        "1px solid var(--mz-border)",
                                    "min-height": "36px",
                                }}>
                                {/* Left: tab icons (draggable to reorder) */}
                                <div
                                    style={{
                                        display: "flex",
                                        "align-items": "center",
                                        gap: IS_MAC_CHROME ? "8px" : "2px",
                                        "min-width": "0",
                                    }}>
                                    <Show when={IS_MAC_CHROME}>
                                        <div
                                            style={{
                                                "-webkit-app-region": "no-drag",
                                                "flex-shrink": "0",
                                            }}>
                                            <WindowControls />
                                        </div>
                                    </Show>
                                    <div style={{ display: "flex", gap: "2px" }}>
                                        <For each={sidebarTabs()}>
                                            {(tab, idx) => (
                                            <button
                                                draggable={true}
                                                onDragStart={(e) => {
                                                    e.dataTransfer!.setData(
                                                        "text/sidebar-idx",
                                                        String(idx()),
                                                    );
                                                    e.dataTransfer!.effectAllowed =
                                                        "move";
                                                }}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    e.dataTransfer!.dropEffect =
                                                        "move";
                                                }}
                                                onDragLeave={(e) => {
                                                    e.currentTarget.style.outline =
                                                        "";
                                                    e.currentTarget.style.outlineOffset =
                                                        "";
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    e.currentTarget.style.outline =
                                                        "";
                                                    e.currentTarget.style.outlineOffset =
                                                        "";
                                                    const from = parseInt(
                                                        e.dataTransfer!.getData(
                                                            "text/sidebar-idx",
                                                        ),
                                                    );
                                                    if (
                                                        !isNaN(from) &&
                                                        from !== idx()
                                                    )
                                                        reorderSidebarTab(
                                                            from,
                                                            idx(),
                                                        );
                                                }}
                                                onClick={() =>
                                                    setSidebarTab(tab.id)
                                                }
                                                title={t(`sidebar.${tab.id}`)}
                                                style={{
                                                    width: "30px",
                                                    height: "30px",
                                                    display: "flex",
                                                    "align-items": "center",
                                                    "justify-content": "center",
                                                    border: "none",
                                                    "border-radius":
                                                        "var(--mz-radius-sm)",
                                                    background:
                                                        sidebarTab() === tab.id
                                                            ? "var(--mz-bg-active)"
                                                            : "transparent",
                                                    color:
                                                        sidebarTab() === tab.id
                                                            ? "var(--mz-accent)"
                                                            : "var(--mz-text-muted)",
                                                    cursor: "pointer",
                                                    transition: "all 100ms",
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (sidebarTab() !== tab.id)
                                                        e.currentTarget.style.background =
                                                            "var(--mz-bg-hover)";
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (sidebarTab() !== tab.id)
                                                        e.currentTarget.style.background =
                                                            "transparent";
                                                }}>
                                                <svg
                                                    width="16"
                                                    height="16"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round">
                                                    <path d={tab.icon} />
                                                </svg>
                                            </button>
                                            )}
                                        </For>
                                    </div>
                                </div>

                                {/* Right: collapse button */}
                                <button
                                    onClick={() => setSidebarCollapsed(true)}
                                    title={t("app.collapseSidebar")}
                                    style={{
                                        width: "30px",
                                        height: "30px",
                                        display: "flex",
                                        "align-items": "center",
                                        "justify-content": "center",
                                        border: "none",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: "transparent",
                                        color: "var(--mz-text-muted)",
                                        cursor: "pointer",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background =
                                            "var(--mz-bg-hover)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background =
                                            "transparent";
                                    }}>
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round">
                                        <path d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
                                    </svg>
                                </button>
                            </div>

                            {/* File action bar (only for files tab) */}
                            <Show when={sidebarTab() === "files"}>
                                <div
                                    style={{
                                        display: "flex",
                                        "align-items": "center",
                                        "justify-content": "space-between",
                                        gap: "2px",
                                        padding: "4px",
                                        "border-bottom":
                                            "1px solid var(--mz-border)",
                                    }}>
                                    <div
                                        style={{ display: "flex", gap: "2px" }}>
                                        {[
                                            {
                                                title: t("app.newNote"),
                                                icon: "M12 5v14M5 12h14",
                                                action: () => handleNewTab(),
                                            },
                                            {
                                                title: t("app.newFolder"),
                                                icon: "M12 10v6M9 13h6M3 7.5A2.5 2.5 0 015.5 5H10l2 2h6.5A2.5 2.5 0 0121 9.5v7a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 16.5z",
                                                action: async () => {
                                                    const name =
                                                        await promptDialog(
                                                            t(
                                                                "app.folderNamePrompt",
                                                            ),
                                                        );
                                                    if (name)
                                                        await vaultStore.createDir(
                                                            name,
                                                        );
                                                },
                                            },
                                            {
                                                title: allFoldersCollapsed()
                                                    ? t("app.expandAllFolders")
                                                    : t(
                                                          "app.collapseAllFolders",
                                                      ),
                                                icon: "M7 9l5-5 5 5M7 15l5 5 5-5",
                                                action: () =>
                                                    toggleAllFolders(),
                                            },
                                        ].map((btn) => (
                                            <button
                                                onClick={btn.action}
                                                title={btn.title}
                                                style={{
                                                    width: "28px",
                                                    height: "28px",
                                                    display: "flex",
                                                    "align-items": "center",
                                                    "justify-content": "center",
                                                    border: "none",
                                                    "border-radius":
                                                        "var(--mz-radius-sm)",
                                                    background: "transparent",
                                                    color: "var(--mz-text-muted)",
                                                    cursor: "pointer",
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.background =
                                                        "var(--mz-bg-hover)";
                                                    e.currentTarget.style.color =
                                                        "var(--mz-text-primary)";
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.background =
                                                        "transparent";
                                                    e.currentTarget.style.color =
                                                        "var(--mz-text-muted)";
                                                }}>
                                                <svg
                                                    width="14"
                                                    height="14"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    stroke-width="2"
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round">
                                                    <path d={btn.icon} />
                                                </svg>
                                            </button>
                                        ))}
                                    </div>
                                    <SortBar
                                        mode={sortMode()}
                                        order={sortOrder()}
                                        onModeChange={setSortMode}
                                        onOrderChange={setSortOrder}
                                    />
                                </div>
                            </Show>

                            {/* Sidebar content — each panel fills the available space */}
                            <div
                                style={{
                                    flex: "1",
                                    overflow: "hidden",
                                    "min-height": "0",
                                    display: "flex",
                                    "flex-direction": "column",
                                }}>
                                <Show when={sidebarTab() === "files"}>
                                    <div
                                        class="mz-sidebar-file-list-scroll"
                                        style={{
                                            flex: "1",
                                            "min-height": "0",
                                            overflow: "auto",
                                        }}>
                                        <FileTree
                                            entries={vaultStore.fileTree()}
                                            onFileClick={(p: string) => {
                                                void handleSidebarFileClick(p);
                                            }}
                                            onOpenSplit={handleOpenSplitInPane}
                                            onExportPdf={(path: string) => {
                                                void pdfExport.exportMarkdownPathToPdf(path);
                                            }}
                                            activePath={
                                                vaultStore.activeFile()?.path ??
                                                null
                                            }
                                            sortMode={sortMode()}
                                            sortOrder={sortOrder()}
                                        />
                                    </div>
                                </Show>
                                <Show when={sidebarTab() === "outline"}>
                                    <Outline />
                                </Show>
                                <Show when={sidebarTab() === "search"}>
                                    <div
                                        style={{
                                            flex: "1",
                                            "min-height": "0",
                                            overflow: "auto",
                                        }}>
                                        <SearchPanel />
                                    </div>
                                </Show>
                                <Show when={sidebarTab() === "calendar"}>
                                    <Calendar />
                                </Show>
                            </div>

                            {/* Bottom: vault name + settings */}
                            <div
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    "justify-content": "space-between",
                                    padding: "4px 12px",
                                    "border-top": "1px solid var(--mz-border)",
                                    position: "relative",
                                }}>
                                <button
                                    onClick={() => setShowVaultMenu((v) => !v)}
                                    // Hovering the vault name reveals the
                                    // full filesystem path via the native
                                    // browser tooltip. Native `title` is
                                    // used over a custom hover widget so
                                    // the tooltip doesn't interfere with
                                    // the vault-switcher popup that opens
                                    // on click.
                                    title={vaultStore.vaultInfo()?.path ?? ""}
                                    style={{
                                        border: "none",
                                        background: "transparent",
                                        color: "var(--mz-text-primary)",
                                        "font-size": "var(--mz-font-size-sm)",
                                        "font-weight": "500",
                                        "font-family": "var(--mz-font-sans)",
                                        cursor: "pointer",
                                        padding: "4px 0",
                                        display: "flex",
                                        "align-items": "center",
                                        gap: "4px",
                                    }}>
                                    {vaultStore.vaultInfo()?.name ?? "Vault"}
                                    <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 10 10"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="1.5">
                                        <path d="M2 4L5 7L8 4" />
                                    </svg>
                                </button>

                                {/* Settings button */}
                                <button
                                    onClick={() => setShowSettings(true)}
                                    title={t("app.settings")}
                                    style={{
                                        width: "28px",
                                        height: "28px",
                                        display: "flex",
                                        "align-items": "center",
                                        "justify-content": "center",
                                        border: "none",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: "transparent",
                                        color: "var(--mz-text-muted)",
                                        cursor: "pointer",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background =
                                            "var(--mz-bg-hover)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background =
                                            "transparent";
                                    }}>
                                    <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"
                                        stroke-linecap="round"
                                        stroke-linejoin="round">
                                        <circle
                                            cx="12"
                                            cy="12"
                                            r="3"
                                        />
                                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                                    </svg>
                                </button>

                                {/* Vault switcher popup */}
                                <Show when={showVaultMenu()}>
                                    <VaultSwitcher
                                        onClose={() => setShowVaultMenu(false)}
                                        onCloseVault={closeCurrentVault}
                                    />
                                </Show>
                            </div>
                        </aside>
                        {/* Sidebar resize handle */}
                        <Show when={!sidebarCollapsed()}>
                            <div
                                style={{
                                    width: "4px",
                                    cursor: "col-resize",
                                    background: "transparent",
                                    "flex-shrink": "0",
                                    "z-index": "10",
                                    "margin-left": "-2px",
                                    "margin-right": "-2px",
                                    transition: "background 150ms ease",
                                }}
                                onMouseEnter={() => {}}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background =
                                        "transparent";
                                }}
                                onMouseDown={(e: MouseEvent) => {
                                    e.preventDefault();
                                    const startX = e.clientX;
                                    const startW = sidebarWidth();
                                    const onMove = (me: MouseEvent) => {
                                        const newW = Math.max(
                                            160,
                                            Math.min(
                                                600,
                                                startW + me.clientX - startX,
                                            ),
                                        );
                                        setSidebarWidth(newW);
                                    };
                                    const onUp = () => {
                                        document.removeEventListener(
                                            "mousemove",
                                            onMove,
                                        );
                                        document.removeEventListener(
                                            "mouseup",
                                            onUp,
                                        );
                                    };
                                    document.addEventListener(
                                        "mousemove",
                                        onMove,
                                    );
                                    document.addEventListener("mouseup", onUp);
                                }}
                            />
                        </Show>
                    </Show>

                    {/* ===== MAIN AREA ===== */}
                    <main
                        style={{
                            flex: "1",
                            "min-width": "0",
                            "min-height": "0",
                            display: "flex",
                            "flex-direction": "column",
                            overflow: "hidden",
                            background: "var(--mz-bg-primary)",
                        }}>
                        <Show
                            when={vaultStore.vaultInfo()}
                            fallback={
                                // Bootstrapping is gated at the OUTER level (right
                                // after the root <div> opens), so by the time we
                                // hit this fallback we already know we want to
                                // show the welcome screen — no inner gate needed.
                                <>
                                    {/* Drag region + window controls for welcome screen */}
                                    <div
                                        data-tauri-drag-region
                                        style={{
                                            display: "flex",
                                            "align-items": "center",
                                            "justify-content": IS_MAC_CHROME
                                                ? "flex-start"
                                                : "flex-end",
                                            height: "var(--mz-tab-height)",
                                            background:
                                                "var(--mz-bg-secondary)",
                                            "border-bottom":
                                                "1px solid var(--mz-border)",
                                            "-webkit-app-region": "drag",
                                            padding: IS_MAC_CHROME
                                                ? "0 12px"
                                                : "0",
                                        }}>
                                        <div
                                            style={{
                                                "-webkit-app-region": "no-drag",
                                            }}>
                                            <WindowControls />
                                        </div>
                                    </div>
                                    <WelcomeScreen />
                                </>
                            }>
                            {/* Tab bar (also acts as drag region for frameless window).
                            Use -webkit-app-region: drag on the bar itself so clicking ANY
                            empty space allows window dragging. Interactive children use no-drag. */}
                            <div
                                data-tauri-drag-region
                                style={{
                                    display: "flex",
                                    "align-items": "center",
                                    background: "var(--mz-bg-secondary)",
                                    "border-bottom":
                                        "1px solid var(--mz-border)",
                                    "-webkit-app-region": "drag",
                                }}>
                                <Show when={IS_MAC_CHROME && sidebarCollapsed()}>
                                    <div
                                        style={{
                                            "flex-shrink": "0",
                                            padding: "0 10px 0 12px",
                                            "-webkit-app-region": "no-drag",
                                        }}>
                                        <WindowControls />
                                    </div>
                                </Show>

                                {/* Expand sidebar button (when collapsed) */}
                                <Show when={sidebarCollapsed()}>
                                    <button
                                        onClick={() =>
                                            setSidebarCollapsed(false)
                                        }
                                        title={t("app.expandSidebar")}
                                        style={{
                                            width: "36px",
                                            height: "var(--mz-tab-height)",
                                            display: "flex",
                                            "align-items": "center",
                                            "justify-content": "center",
                                            border: "none",
                                            "border-right":
                                                "1px solid var(--mz-border)",
                                            background: "transparent",
                                            color: "var(--mz-text-muted)",
                                            cursor: "pointer",
                                            "-webkit-app-region": "no-drag",
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.color =
                                                "var(--mz-text-primary)";
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.color =
                                                "var(--mz-text-muted)";
                                        }}>
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round">
                                            <path d="M13 5l7 7-7 7M6 5l7 7-7 7" />
                                        </svg>
                                    </button>
                                </Show>

                                {/* Tab area: takes remaining space but CAN shrink so window controls stay visible */}
                                <div
                                    style={{
                                        flex: "1 1 0px",
                                        "min-width": "0",
                                        overflow: "hidden",
                                        "-webkit-app-region": "no-drag",
                                    }}>
                                    <TabBar
                                        files={vaultStore.openFiles()}
                                        activeFile={vaultStore.activeFile()}
                                        onSelect={handleTabSelect}
                                        onClose={handleTabClose}
                                        onSetViewMode={(path, mode) =>
                                            editorStore.setViewMode(mode, path)
                                        }
                                        onOpenSplit={handleOpenSplitInPane}
                                        onExportPdf={(path) =>
                                            void pdfExport.exportMarkdownPathToPdf(path)
                                        }
                                        onReorder={(from: number, to: number) =>
                                            vaultStore.reorderOpenFiles(
                                                from,
                                                to,
                                            )
                                        }
                                        onRevealInTree={(path: string) => {
                                            // Ensure the Files panel is showing and the
                                            // sidebar is expanded before revealFileInTree
                                            // scrolls — the tree DOM only exists when
                                            // `sidebarTab === "files"` and the sidebar
                                            // isn't collapsed.
                                            setSidebarTab("files");
                                            if (sidebarCollapsed())
                                                setSidebarCollapsed(false);
                                            revealFileInTree(path);
                                        }}
                                    />
                                </div>

                                {/* New tab + (never shrinks) */}
                                <button
                                    onClick={handleNewTab}
                                    title={t("app.newTab")}
                                    style={{
                                        "flex-shrink": "0",
                                        width: "32px",
                                        height: "var(--mz-tab-height)",
                                        display: "flex",
                                        "align-items": "center",
                                        "justify-content": "center",
                                        border: "none",
                                        "border-left":
                                            "1px solid var(--mz-border)",
                                        background: "transparent",
                                        color: "var(--mz-text-muted)",
                                        cursor: "pointer",
                                        "font-size": "16px",
                                        "-webkit-app-region": "no-drag",
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color =
                                            "var(--mz-text-primary)";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color =
                                            "var(--mz-text-muted)";
                                    }}>
                                    +
                                </button>

                                {/* Drag spacer (never shrinks) */}
                                <div
                                    data-tauri-drag-region
                                    style={{
                                        "flex-shrink": "0",
                                        width: "40px",
                                        height: "var(--mz-tab-height)",
                                        "border-left":
                                            "1px solid var(--mz-border)",
                                        "-webkit-app-region": "drag",
                                    }}
                                />

                                {/* Window controls: minimize, maximize, close (never shrinks, always visible) */}
                                <Show when={!IS_MAC_CHROME}>
                                    <div
                                        style={{
                                            "flex-shrink": "0",
                                            "-webkit-app-region": "no-drag",
                                        }}>
                                        <WindowControls />
                                    </div>
                                </Show>
                            </div>

                            {/* Editor area — uses createMemo to derive stable values so
                            PluginViewHost is NOT destroyed/recreated on every save. */}
                            <Show
                                when={vaultStore.activeFile()}
                                fallback={
                                    <div
                                        style={{
                                            flex: "1",
                                            display: "flex",
                                            "align-items": "center",
                                            "justify-content": "center",
                                            color: "var(--mz-text-muted)",
                                            "font-size":
                                                "var(--mz-font-size-sm)",
                                        }}>
                                        {t("app.openFileOrSearch")}
                                    </div>
                                }>
                                <Show
                                    when={
                                        settingsStore.settings()
                                            .show_markdown_toolbar &&
                                        !hasPluginViewForExtension(
                                            (
                                                vaultStore.activeFile()?.path ??
                                                ""
                                            )
                                                .split(".")
                                                .pop()
                                                ?.toLowerCase() ?? "",
                                        )
                                    }>
                                    <Toolbar />
                                </Show>
                                <SplitWorkspaceView
                                    primaryPath={
                                        primaryPanePath() ??
                                        vaultStore.activeFile()?.path ??
                                        null
                                    }
                                    secondaryPath={secondaryPanePath()}
                                    activeSlot={activePaneSlot()}
                                    direction={splitDirection()}
                                    splitRatio={splitRatio()}
                                    onActivatePane={activatePane}
                                    onClosePane={closeSplitPane}
                                    onSplitRatioChange={setSplitRatio}
                                />
                            </Show>
                            <Show when={aiPanel.showAiPanel()}>
                                <AiBottomPanel
                                    input={aiPanel.aiPanelInput()}
                                    output={aiPanel.aiPanelOutput()}
                                    busy={aiPanel.aiPanelBusy()}
                                    voiceRecording={aiPanel.aiVoiceRecording()}
                                    voiceBusy={aiPanel.aiVoiceBusy()}
                                    height={aiPanel.aiPanelHeight()}
                                    activePath={
                                        activePanePath() ??
                                        vaultStore.activeFile()?.path ??
                                        null
                                    }
                                    modelLabel={aiPanel.currentAiModelLabel()}
                                    modelOptions={aiPanel.aiPanelModelOptions()}
                                    activeModelValue={aiPanel.currentAiModelOptionValue()}
                                    historyOpen={aiPanel.showAiHistory()}
                                    historyPosition={aiPanel.aiHistoryPosition()}
                                    historyDates={aiPanel.aiHistoryDates()}
                                    historyDate={aiPanel.aiHistoryDate()}
                                    historyEntries={aiPanel.selectedAiHistoryEntries()}
                                    onHeightChange={(height) =>
                                        aiPanel.setAiPanelHeight(
                                            aiPanel.clampAiPanelHeight(height),
                                        )
                                    }
                                    onSelectModel={aiPanel.selectAiPanelModel}
                                    onInput={aiPanel.handleAiPanelInput}
                                    onRun={() => void aiPanel.runAiPanelInstruction()}
                                    onToggleVoiceInput={aiPanel.toggleAiVoiceRecording}
                                    onSpeakInput={() =>
                                        void aiPanel.synthesizeAiPanelInput()
                                    }
                                    onToggleHistory={aiPanel.toggleAiHistoryDialog}
                                    onCloseHistory={aiPanel.closeAiHistoryDialog}
                                    onMoveHistory={aiPanel.setAiHistoryPosition}
                                    onSelectHistoryDate={aiPanel.setAiHistoryDate}
                                    onDeleteHistoryEntry={aiPanel.deleteAiHistoryEntry}
                                    onClearHistoryDate={
                                        aiPanel.clearAiHistoryForSelectedDate
                                    }
                                    onClearAllHistory={aiPanel.clearAllAiHistory}
                                    onCopyHistoryEntry={aiPanel.copyAiHistoryQuestion}
                                    onNavigateHistory={
                                        aiPanel.navigateAiQuestionHistory
                                    }
                                    onClose={aiPanel.closeAiPanel}
                                />
                            </Show>
                        </Show>
                    </main>
                </div>

                <StatusBar />
            </Show>
            <Show when={showCommandPalette()}>
                <CommandPalette
                    mode={commandPaletteMode()}
                    onClose={() => setShowCommandPalette(false)}
                />
            </Show>
            <Show when={showGotoLine()}>
                <GotoLinePanel onClose={() => setShowGotoLine(false)} />
            </Show>
            <Show when={showSettings()}>
                <SettingsModal onClose={() => setShowSettings(false)} />
            </Show>
            <Show when={screenshot.screenshotData()}>
                <ScreenshotOverlay
                    screenshotBase64={screenshot.screenshotData()!}
                    onClose={() => screenshot.setScreenshotData(null)}
                    onSave={screenshot.handleScreenshotSave}
                />
            </Show>
            {/* Ephemeral shortcut toast — auto-fades after ~1.2s. Used
                primarily by the Ctrl+Alt+Left/Right tab switch handler
                so the user can verify the keyboard event actually
                reached our code even if the tab switching itself looks
                like a no-op (e.g. only one tab open). Rendered OUTSIDE
                the normal layout tree so it can sit top-center over
                everything. */}
            <Show when={shortcutToast()}>
                <div
                    style={{
                        position: "fixed",
                        top: "48px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        padding: "6px 14px",
                        background:
                            "var(--mz-bg-secondary, rgba(30, 30, 30, 0.92))",
                        color: "var(--mz-text-primary, #ffffff)",
                        border: "1px solid var(--mz-border, rgba(255, 255, 255, 0.15))",
                        "border-radius": "6px",
                        "font-family": "var(--mz-font-mono, monospace)",
                        "font-size": "12px",
                        "pointer-events": "none",
                        "z-index": "100000",
                        "box-shadow": "0 4px 12px rgba(0, 0, 0, 0.35)",
                        "white-space": "nowrap",
                    }}>
                    {shortcutToast()}
                </div>
            </Show>
            <ConfirmDialog />
        </div>
    );
};

export default App;
