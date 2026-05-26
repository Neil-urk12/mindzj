import { onMount, onCleanup, type Accessor, type Setter } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { vaultStore } from "../stores/vault";
import { editorStore } from "../stores/editor";
import { settingsStore } from "../stores/settings";
import { pluginStore } from "../stores/plugins";
import {
    openSearchPanel,
    closeSearchPanel,
    getSearchQuery,
    searchPanelOpen,
    setSearchQuery,
    SearchQuery,
} from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { setFindQuery } from "../stores/findState";
import {
    setQuery as setGlobalSearchQuery,
    runSearchNow as runGlobalSearchNow,
} from "../components/sidebar/SearchPanel";
import { type PaneSlot } from "../types/app";
import type { UseAiPanelReturn } from "./useAiPanel";

// ── Types ────────────────────────────────────────────────────────

type SidebarTab = "files" | "outline" | "search" | "calendar";
type CommandPaletteMode = "commands" | "files";

export interface UseKeyboardShortcutsOptions {
    // Command palette
    showCommandPalette: Accessor<boolean>;
    setShowCommandPalette: Setter<boolean>;
    commandPaletteMode: Accessor<CommandPaletteMode>;
    setCommandPaletteMode: Setter<CommandPaletteMode>;

    // Goto line
    setShowGotoLine: Setter<boolean>;

    // Settings
    setShowSettings: Setter<boolean>;

    // Sidebar
    setSidebarTab: Setter<SidebarTab>;
    sidebarTabs: Accessor<Array<{ id: SidebarTab; title: string; icon: string }>>;
    sidebarCollapsed: Accessor<boolean>;
    setSidebarCollapsed: Setter<boolean>;

    // Pane state
    activePanePath: Accessor<string | null>;
    activePaneSlot: Accessor<PaneSlot>;

    // Callbacks (remain in App.tsx, used elsewhere too)
    handleNewTab: () => void | Promise<void>;
    handleTabClose: (path: string) => void;
    reopenLastClosedTab: () => void;
    switchOpenTab: (direction: "prev" | "next") => boolean;

    // Extracted hooks
    aiPanel: UseAiPanelReturn;
    screenshot: { startScreenshot: () => Promise<void> };
}

// ── Module-level constants ────────────────────────────────────────

// Platform detection: on macOS the `Cmd` key (aka Meta) is the
// primary modifier, so a hotkey string of "Ctrl+X" should match
// Cmd+X. On Windows/Linux the Meta key is the Win/Super key and
// is RESERVED for system use — "Ctrl+X" must match Ctrl+X ONLY,
// never Win+X. Folding them together (the previous behavior of
// `needCtrl !== (e.ctrlKey || e.metaKey)`) caused Win+F to
// accidentally trigger our Ctrl+F handlers AND prevented
// Windows' own Win+F (Feedback Hub) from firing properly.
const _isMacPlatform = /mac|iphone|ipod|ipad/i.test(
    typeof navigator !== "undefined" ? navigator.platform : "",
);

// ── Module-level pure utility functions ───────────────────────────

function normalizeHotkeyKey(key: string): string {
    const normalized = key.length === 1 ? key.toUpperCase() : key;
    if (normalized === "+" || normalized === "ADD" || normalized === "Plus")
        return "=";
    if (normalized === "SUBTRACT" || normalized === "Minus") return "-";
    // Normalise arrow keys so hotkey strings like "Ctrl+Alt+Left"
    // actually match DOM events whose `e.key` is `"ArrowLeft"`.
    // The HotkeysPanel capture UI already uses the short form
    // (Up / Down / Left / Right / Space) when saving overrides,
    // so we must match that when comparing.
    if (normalized === "ArrowLeft") return "Left";
    if (normalized === "ArrowRight") return "Right";
    if (normalized === "ArrowUp") return "Up";
    if (normalized === "ArrowDown") return "Down";
    if (normalized === " ") return "Space";
    return normalized;
}

/** Returns true when the primary "Ctrl-like" modifier is held.
 *  On Mac that's Cmd (metaKey); on Windows/Linux it's strictly
 *  Ctrl, NEVER the Win key. */
function isCtrlHeld(e: KeyboardEvent): boolean {
    if (_isMacPlatform) return e.ctrlKey || e.metaKey;
    // Windows/Linux: require Ctrl AND require metaKey to NOT be
    // down — otherwise Win+X would flow through as if it were
    // Ctrl+X, breaking Windows-reserved combos like Win+F /
    // Win+S / Win+R.
    return e.ctrlKey && !e.metaKey;
}

/**
 * Match a KeyboardEvent against a hotkey combo string like "Alt+G", "Ctrl+Shift+S".
 * Returns true if the event matches the combo.
 */
function matchesHotkey(e: KeyboardEvent, combo: string): boolean {
    const parts = combo.split("+");
    const keyPart = parts[parts.length - 1];
    const needCtrl = parts.includes("Ctrl");
    const needShift = parts.includes("Shift");
    const needAlt = parts.includes("Alt");
    const needMeta = parts.includes("Meta");

    // On Mac, the Ctrl slot is satisfied by Cmd (metaKey). On
    // Windows/Linux it's strictly the real Ctrl key — holding
    // the Win key alone must NOT count as Ctrl.
    const ctrlHeld = _isMacPlatform ? e.ctrlKey || e.metaKey : e.ctrlKey;
    if (needCtrl !== ctrlHeld) return false;
    if (needShift !== e.shiftKey) return false;
    if (needAlt !== e.altKey) return false;
    // Windows: if metaKey is down and we DIDN'T ask for it in
    // the combo, bail out. This is the other half of the
    // Win+F fix: it stops e.g. Win+S from firing our Ctrl+S
    // save handler (because needCtrl=true but ctrlHeld=false,
    // we'd return early anyway — but this guards cases like
    // "just F" hotkeys where the user has Win held down as
    // they start typing something).
    if (!_isMacPlatform && !needMeta && e.metaKey) return false;
    if (needMeta && !e.metaKey) return false;

    const eventKey = normalizeHotkeyKey(e.key);
    const comboKey = normalizeHotkeyKey(keyPart);
    return eventKey === comboKey;
}

function isArrowKeyEvent(e: KeyboardEvent): boolean {
    const keyCode = e.keyCode || e.which;
    return (
        e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "Up" ||
        e.key === "Down" ||
        e.key === "Left" ||
        e.key === "Right" ||
        keyCode === 38 ||
        keyCode === 40 ||
        keyCode === 37 ||
        keyCode === 39
    );
}

function suppressWebViewAltMenu(e: KeyboardEvent): boolean {
    if (e.key === "Alt") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return true;
    }
    const isPlainAltArrow =
        e.altKey &&
        isArrowKeyEvent(e) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey;
    if (isPlainAltArrow) {
        const isHorizontalArrow =
            e.code === "ArrowLeft" ||
            e.code === "ArrowRight" ||
            e.key === "ArrowLeft" ||
            e.key === "ArrowRight" ||
            e.key === "Left" ||
            e.key === "Right" ||
            (e.keyCode || e.which) === 37 ||
            (e.keyCode || e.which) === 39;
        if (
            isHorizontalArrow &&
            document.activeElement?.closest(".cm-editor")
        ) {
            return false;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return true;
    }
    return false;
}

function handleGlobalKeyup(e: KeyboardEvent) {
    if (e.key !== "Alt") return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
}

/** Get the effective hotkey combo for a command (override or default) */
function getHotkey(command: string, defaultKeys: string): string {
    const overrides = settingsStore.settings().hotkey_overrides || {};
    return overrides[command] || defaultKeys;
}

function clearEditorSearchQuery(view: EditorView) {
    const current = getSearchQuery(view.state);
    view.dispatch({
        effects: setSearchQuery.of(
            new SearchQuery({
                search: "",
                caseSensitive: current.caseSensitive,
                wholeWord: current.wholeWord,
                regexp: current.regexp,
                replace: "",
            }),
        ),
    });
}

function getTabSwitchDirectionFromEvent(
    e: KeyboardEvent,
): "prev" | "next" | null {
    const keyCode = e.keyCode || e.which;
    const isLeft =
        e.code === "ArrowLeft" ||
        e.key === "ArrowLeft" ||
        e.key === "Left" ||
        keyCode === 37;
    const isRight =
        e.code === "ArrowRight" ||
        e.key === "ArrowRight" ||
        e.key === "Right" ||
        keyCode === 39;
    const isTabSwitchHotkey =
        isCtrlHeld(e) &&
        (isLeft || isRight) &&
        ((e.shiftKey && !e.altKey) || (e.altKey && !e.shiftKey));

    if (!isTabSwitchHotkey) return null;
    return isLeft ? "prev" : "next";
}

// ── Module-level state ────────────────────────────────────────────

// Reentrancy guard for Ctrl+E. OS key-repeat and rapid pressing during
// async save operations used to stack multiple toggle dispatches,
// which in split mode combined with the sidebar global-search
// re-search listener could hang the UI thread in a cascade of file
// reads + mode-rebuilds. One-in-flight at a time keeps the sequence
// sane even if the user mashes the key.
let toggleViewModePending = false;

function toggleViewModeWithSave(path: string | null | undefined) {
    if (toggleViewModePending) return;
    toggleViewModePending = true;
    const release = () => {
        toggleViewModePending = false;
    };
    try {
        const resolvedPath = path ?? null;
        const currentMode = editorStore.getViewModeForFile(resolvedPath);
        if (currentMode === "reading") {
            editorStore.toggleReadingMode(resolvedPath ?? undefined);
            queueMicrotask(release);
            return;
        }

        const event = new CustomEvent("mindzj:toggle-view-mode-with-save", {
            cancelable: true,
            detail: { path: resolvedPath, release },
        });
        const handled = !document.dispatchEvent(event);
        if (!handled) {
            editorStore.toggleReadingMode(resolvedPath ?? undefined);
            queueMicrotask(release);
        }
        // If handled, the Editor's async save promise will call
        // release() when it settles (success or failure). Fallback
        // timeout guards against a handler that never calls back.
        if (handled) {
            setTimeout(() => {
                if (toggleViewModePending) toggleViewModePending = false;
            }, 3000);
        }
    } catch (err) {
        toggleViewModePending = false;
        throw err;
    }
}

// ── Module-level helpers that take options as parameters ──────────

function findActivePaneEditorView(
    getActivePaneSlot: () => PaneSlot,
    paneWrap?: HTMLElement | null,
): EditorView | undefined {
    // 1. Whatever has document focus, if it's inside a cm-editor,
    //    is the most reliable signal.
    const focusedInEditor =
        document.activeElement?.closest<HTMLElement>(".cm-editor");
    if (focusedInEditor) {
        const v = EditorView.findFromDOM(focusedInEditor);
        if (v) return v;
    }
    // 2. The active pane's wrapper → its cm-editor descendant.
    //    Handles e.g. Ctrl+F pressed while focus sits in the
    //    sidebar search input.
    const wrap =
        paneWrap ??
        (() => {
            const slot = getActivePaneSlot();
            return document.querySelector<HTMLElement>(
                slot === "secondary"
                    ? ".mz-pane-wrap-secondary"
                    : ".mz-pane-wrap-primary",
            );
        })();
    const cmEditor = wrap?.querySelector<HTMLElement>(".cm-editor");
    if (cmEditor) {
        const v = EditorView.findFromDOM(cmEditor);
        if (v) return v;
    }
    // 3. Legacy fallback — only correct in the single-pane case,
    //    but harmless when 1) and 2) failed to resolve anything.
    const api = window.__mindzj_plugin_editor_api;
    return (api?.cm as EditorView | undefined) ?? undefined;
}

function handleTabSwitchKeydown(
    e: KeyboardEvent,
    switchOpenTab: (direction: "prev" | "next") => boolean,
): boolean {
    // ═══════════════════════════════════════════════════════════
    //  Ctrl+Shift+Left / Ctrl+Shift+Right → switch to prev/next tab.
    //  Ctrl+Alt+Left / Ctrl+Alt+Right is kept as a compatibility alias.
    // ═══════════════════════════════════════════════════════════
    //
    // This check is DELIBERATELY placed at the very top of the
    // keydown handler, BEFORE any other early-return or the
    // `__mindzj_hotkey_capturing` bail-out. Previous attempts
    // that used `matchesHotkey(getHotkey("tab-prev"))` further
    // down the function never worked for the user — diagnosis
    // was eating too much time, so this version:
    //
    //   1. Matches by `e.code === "ArrowLeft"/"ArrowRight"`
    //      (layout-independent — doesn't care if the user has a
    //      non-US keyboard that maps the left-arrow key to a
    //      non-"ArrowLeft" `e.key` value).
    //   2. Also accepts `e.key === "ArrowLeft"/"ArrowRight"` and
    //      `"Left"/"Right"` as a fallback.
    //   3. Calls `stopImmediatePropagation()` on top of the
    //      usual `preventDefault`+`stopPropagation`, so no other
    //      capture-phase listener on `document` (e.g. the plugin
    //      hotkey handler in stores/plugins.ts) gets a chance
    //      to swallow or re-dispatch the event.
    //   4. Switches tabs through `switchOpenTab(...)`, which
    //      goes through `handleTabSelect(path)` — the same
    //      routine a TabBar click uses, so the pane-path signal
    //      and the vault-store active file stay in lock-step.
    //
    // If this STILL doesn't fire for someone, set
    // `localStorage.setItem("mindzj-debug-tab-switch", "1")` in
    // devtools; the next press will dump the event details to
    // the console so we can see exactly what the webview is
    // sending.
    const direction = getTabSwitchDirectionFromEvent(e);
    if (!direction) return false;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    switchOpenTab(direction);
    return true;
}

// ── Hook ──────────────────────────────────────────────────────────

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
    const {
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
    } = options;

    // Resolve the CodeMirror EditorView that belongs to whichever pane
    // the user currently considers "focused". In single-pane mode this
    // is just the lone editor; in split mode the choice matters — the
    // Ctrl+F handler needs to open the search widget in the pane the
    // user is actually looking at, not the stale
    // `__mindzj_plugin_editor_api` global which only updates when an
    // editor mounts/unmounts.
    const resolveActivePaneEditorView = (paneWrap?: HTMLElement | null) =>
        findActivePaneEditorView(activePaneSlot, paneWrap);

    function handleGlobalKeydown(e: KeyboardEvent) {
        // If the settings hotkey capture is active, let the HotkeysPanel handle the event.
        if (window.__mindzj_hotkey_capturing) return;

        if (aiPanel.showAiHistory() && e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            aiPanel.closeAiHistoryDialog();
            return;
        }

        const moveLineCommand = matchesHotkey(
            e,
            getHotkey("move-line-up", "Alt+Up"),
        )
            ? "move-line-up"
            : matchesHotkey(e, getHotkey("move-line-down", "Alt+Down"))
              ? "move-line-down"
              : null;
        const focusedEditorContent =
            document.activeElement?.closest(".cm-content");
        if (moveLineCommand && focusedEditorContent?.closest(".cm-editor")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            document.dispatchEvent(
                new CustomEvent("mindzj:editor-command", {
                    detail: { command: moveLineCommand },
                }),
            );
            return;
        }

        const aiInputFocused =
            (document.activeElement as HTMLElement | null)?.dataset
                ?.mzAiInput === "true";
        if (
            aiInputFocused &&
            e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            (e.key === "ArrowUp" || e.key === "ArrowDown")
        ) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            aiPanel.navigateAiQuestionHistory(e.key === "ArrowUp" ? "prev" : "next");
            return;
        }

        if (suppressWebViewAltMenu(e)) return;
        if (e.defaultPrevented) return;
        if (handleTabSwitchKeydown(e, switchOpenTab)) return;

        // Bare Alt and non-editor Alt+Arrow are suppressed above so WebView2
        // never enters its native menu mode after repeated Alt presses.

        if (matchesHotkey(e, getHotkey("ai-control", "Alt+`"))) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            aiPanel.setShowAiPanel((value) => !value);
            return;
        }

        // Check if the editor (CodeMirror) is focused
        const editorFocused = !!document.activeElement?.closest(".cm-editor");

        // Ctrl+F (NOT Ctrl+Shift+F, NOT with Alt) → open the CM6
        // in-editor find panel. We intercept this GLOBALLY rather
        // than letting CM6's own searchKeymap handle it only-when-
        // editor-focused because:
        //
        //   (a) WebView2 has its own built-in "Find in page" UI
        //       that pops over the app whenever Ctrl+F fires and
        //       isn't consumed by a DOM handler. After the user
        //       presses Win+F (which shifts focus away from the
        //       editor), the next Ctrl+F would hit that WebView2
        //       default instead of our search — the exact bug
        //       the user reported.
        //   (b) Blocking it unconditionally and re-dispatching to
        //       CM6 makes the behavior consistent regardless of
        //       where focus currently is.
        //
        // We explicitly check `e.ctrlKey` (not `e.ctrlKey ||
        // e.metaKey`) on Windows so Win+F still flows to the OS
        // as Windows Feedback Hub — see the platform check in
        // `matchesHotkey` above.
        if (
            isCtrlHeld(e) &&
            !e.altKey &&
            !e.shiftKey &&
            (e.key === "f" || e.key === "F")
        ) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Ctrl+F is a TOGGLE: if a find panel is already open
            // anywhere in the active pane, close it; otherwise open
            // the mode-appropriate one and focus its input.
            const activePath =
                activePanePath() ?? vaultStore.activeFile()?.path ?? null;
            const activeMode = editorStore.getViewModeForFile(activePath);

            // Find the DOM element that wraps ONLY the active pane's
            // content. In split mode this is either
            // `.mz-pane-wrap-secondary` or `.mz-pane-wrap-primary`
            // depending on which pane the user last focused; outside
            // split mode there's only the primary wrap. Scoping all
            // the "is the panel already open?" + "which CM view do we
            // target?" queries to THIS element is what makes Ctrl+F
            // only act on the focused pane.
            const activePaneWrap: HTMLElement | null = (() => {
                const slot = activePaneSlot();
                const selector =
                    slot === "secondary"
                        ? ".mz-pane-wrap-secondary"
                        : ".mz-pane-wrap-primary";
                return document.querySelector<HTMLElement>(selector);
            })();

            // Reading mode has its own SolidJS panel in
            // ReadingView.tsx; look for its rendered DOM inside the
            // ACTIVE pane to tell if it's currently open. Scoping
            // this to the active pane's wrapper keeps split-mode
            // Ctrl+F from latching onto a panel in the other pane.
            const readingPanelOpen = !!(
                activePaneWrap ?? document
            ).querySelector(".mz-reading-find-panel");

            // Ctrl+F is no longer a toggle. If the panel is already
            // open and the user has selected text, REFILL the query
            // with that selection; otherwise just refocus the input.
            // Closing is still handled by the × button and Escape.
            const readingSelection = () => {
                const sel = window.getSelection?.();
                if (!sel || sel.rangeCount === 0) return "";
                // Only accept a selection that lies inside the reading
                // view — ignore selections in the sidebar or title bar,
                // and in the find panel itself (otherwise the user's
                // in-input selection would clobber its own query).
                const node = sel.anchorNode;
                if (!node) return "";
                const el =
                    node.nodeType === Node.ELEMENT_NODE
                        ? (node as Element)
                        : node.parentElement;
                if (!el?.closest(".mz-reading-view")) return "";
                if (el?.closest(".mz-reading-find-panel")) return "";
                return sel.toString();
            };

            if (activeMode === "reading") {
                if (readingPanelOpen) {
                    // Panel already open: only refill the query if
                    // the user has something selected. With no
                    // selection we just refocus — don't clobber the
                    // existing query, since the user might be
                    // re-running the same search after scrolling.
                    const selection = readingSelection();
                    document.dispatchEvent(
                        new CustomEvent("mindzj:reading-find-set-query", {
                            detail: { query: selection },
                        }),
                    );
                } else {
                    // Fresh-open: when there's NO selection, start
                    // from an empty query (user requirement — they
                    // don't want the previous query pre-filled).
                    // With a selection, seed the query with it so
                    // the very first keystroke searches.
                    const selection = readingSelection();
                    setFindQuery(selection ?? "");
                    document.dispatchEvent(
                        new CustomEvent("mindzj:open-reading-find"),
                    );
                }
                return;
            }

            // Source / live-preview modes: drive CM6's built-in
            // search state. The panel UI is styled as a VS Code
            // floating widget via `.cm-panels-top` CSS in editor.css.
            //
            // IMPORTANT: in split mode we MUST target the CM view
            // inside the currently-focused pane, not the stale
            // `__mindzj_plugin_editor_api` global (which trails
            // focus changes and can point at the wrong pane). We
            // resolve the view from the DOM in this order:
            //   1. The `.cm-editor` that owns document focus — if
            //      the user just clicked inside an editor this is
            //      the authoritative answer.
            //   2. The `.cm-editor` inside the active pane's wrapper
            //      — covers the case where focus went to a sidebar
            //      (e.g. Ctrl+F from the global-search input).
            //   3. The plugin-API fallback kept for backward compat.
            const cmView = resolveActivePaneEditorView(activePaneWrap);
            if (cmView) {
                try {
                    if (searchPanelOpen(cmView.state)) {
                        // Panel already open: if the editor has a
                        // non-empty selection, push it into the find
                        // input and re-run the search. With no
                        // selection, just refocus the input so the
                        // next keystroke edits the existing query.
                        const selectionRange = cmView.state.selection.main;
                        const selectionText = selectionRange.empty
                            ? ""
                            : cmView.state.sliceDoc(
                                  selectionRange.from,
                                  selectionRange.to,
                              );
                        const input =
                            cmView.dom.querySelector<HTMLInputElement>(
                                ".mz-search-panel .mz-search-input",
                            );
                        if (selectionText && input) {
                            input.value = selectionText;
                            // Trigger the panel's own `commit()` so
                            // the CM6 search state picks up the new
                            // query and the match counter refreshes.
                            input.dispatchEvent(
                                new Event("input", { bubbles: true }),
                            );
                        }
                        queueMicrotask(() => {
                            if (input) {
                                input.focus();
                                input.select();
                            } else {
                                cmView.focus();
                            }
                        });
                    } else {
                        // Closed panels clear their query, so the
                        // first open can use CM6's single-dispatch
                        // opener and avoid an extra split-pane
                        // layout/measure pass.
                        openSearchPanel(cmView);
                    }
                } catch (err) {
                    console.warn("[ctrl-f] toggle search panel failed:", err);
                }
            }
            return;
        }

        // Escape closes any open find panel regardless of where
        // focus currently is. Previously ESC only worked if the
        // find input itself had focus (CM6's default keybinding);
        // if the user clicked into the document and lost input
        // focus, ESC did nothing. This handler checks both the
        // reading-mode panel and CM6's search state and closes
        // whichever is open, then lets other ESC consumers run if
        // neither was.
        if (
            e.key === "Escape" &&
            !e.ctrlKey &&
            !e.altKey &&
            !e.shiftKey &&
            !e.metaKey
        ) {
            // Scope both the reading-panel check and the CM view
            // lookup to the focused pane so Escape in split mode
            // closes the panel on THIS pane only — otherwise the
            // global queries below would pick the first panel in
            // document order, which might belong to the other pane.
            const slot = activePaneSlot();
            const activeWrap = document.querySelector<HTMLElement>(
                slot === "secondary"
                    ? ".mz-pane-wrap-secondary"
                    : ".mz-pane-wrap-primary",
            );
            const readingPanel = (activeWrap ?? document).querySelector(
                ".mz-reading-find-panel",
            );
            if (readingPanel) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                document.dispatchEvent(
                    new CustomEvent("mindzj:close-reading-find"),
                );
                return;
            }
            const cmView = resolveActivePaneEditorView(activeWrap);
            if (cmView && searchPanelOpen(cmView.state)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                clearEditorSearchQuery(cmView);
                closeSearchPanel(cmView);
                cmView.focus();
                return;
            }
        }

        if (
            isCtrlHeld(e) &&
            !e.altKey &&
            !e.shiftKey &&
            e.key.toLowerCase() === "r"
        ) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Ctrl+Shift+I / F12 → open the webview devtools.
        //
        // `devtools = true` on Tauri's Cargo features enables the
        // underlying WebView2 devtools in every build. We used to
        // SWALLOW this shortcut so users couldn't accidentally pop
        // devtools, but per user request it's now hooked up as the
        // explicit shortcut to open them. We invoke the dedicated
        // Rust command `open_devtools` instead of relying on the
        // webview's own default binding — some Tauri/WebView2
        // combinations don't expose Ctrl+Shift+I to the webview
        // layer at all, and going through the Rust handle works
        // regardless.
        //
        // Ctrl+Shift+J is ALSO mapped here (Chrome muscle memory).
        if (
            (isCtrlHeld(e) &&
                e.shiftKey &&
                !e.altKey &&
                (e.key === "I" ||
                    e.key === "J" ||
                    e.key === "i" ||
                    e.key === "j")) ||
            e.key === "F12"
        ) {
            e.preventDefault();
            e.stopPropagation();
            void invoke("open_devtools").catch((err) => {
                console.warn("[open_devtools] invoke failed:", err);
            });
            return;
        }

        // Ctrl+M → minimize the current window to the taskbar. We
        // go through the `minimize_window` Tauri command rather
        // than calling `getCurrentWindow().minimize()` in JS so
        // the minimize always happens synchronously with respect
        // to the window handle — the pure-JS path has occasionally
        // been lost when pressed while the editor DOM is busy.
        if (
            isCtrlHeld(e) &&
            !e.shiftKey &&
            !e.altKey &&
            (e.key === "m" || e.key === "M")
        ) {
            e.preventDefault();
            e.stopPropagation();
            void invoke("minimize_window").catch((err) => {
                console.warn("[minimize_window] invoke failed:", err);
            });
            return;
        }

        // Ctrl+J (no shift/alt) → toggle MindZJ window visibility
        // (show/hide from the taskbar). Browsers bind Ctrl+J to the
        // Downloads popup by default — this both intercepts that
        // behaviour AND gives the user a way to quickly hide the
        // window without reaching for the titlebar minimize button.
        // Configurable via `toggle-window-visible` hotkey.
        if (matchesHotkey(e, getHotkey("toggle-window-visible", "Ctrl+J"))) {
            e.preventDefault();
            e.stopPropagation();
            void (async () => {
                try {
                    const w = getCurrentWindow();
                    const visible = await w.isVisible();
                    const minimized = await w.isMinimized();
                    if (visible && !minimized) {
                        await w.hide();
                    } else {
                        await w.unminimize().catch((e) => console.warn("Failed to unminimize window:", e));
                        await w.show();
                        await w.setFocus().catch((e) => console.warn("Failed to set window focus:", e));
                    }
                } catch (err) {
                    console.warn("[toggle-window-visible] failed:", err);
                }
            })();
            return;
        }

        // Screenshot (default Alt+G, configurable).
        // `stopImmediatePropagation` is needed because WebView2's
        // internal Alt-key "menu mode" can otherwise intercept the
        // G press and pop a search/find dialog before our handler
        // fires. The bare-Alt handler above ALSO suppresses the
        // menu-mode activation, but the double-stop here is a
        // belt-and-suspenders defence.
        if (matchesHotkey(e, getHotkey("screenshot", "Alt+G"))) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            screenshot.startScreenshot();
            return;
        }

        // Plugin: timestamp-header commands (configurable hotkeys).
        //
        // Previously this path dispatched a `mindzj:plugin-command`
        // CustomEvent that the plugin itself listened for and then
        // re-ran via `app.commands.executeCommandById`. That indirection
        // was firing the command multiple times — Alt+F would insert
        // four timestamps in one press — because the plugin's DOM
        // listener stuck around across vault reloads / hot-reloads
        // and each attached copy re-ran the callback. We now call
        // `pluginStore.executeCommandById` directly. One call per
        // press, one insert per command.
        if (
            matchesHotkey(
                e,
                getHotkey("plugin:timestamp-header:insert-timestamp", "Alt+F"),
            )
        ) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            void pluginStore.executeCommandById(
                "timestamp-header:insert-custom-timestamp",
            );
            return;
        }
        if (
            matchesHotkey(
                e,
                getHotkey("plugin:timestamp-header:insert-separator", "Alt+A"),
            )
        ) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            void pluginStore.executeCommandById(
                "timestamp-header:insert-triple-asterisk",
            );
            return;
        }

        // Ctrl+G → goto-line popup (VS Code parity). Works in all
        // three view modes: source/live-preview dispatch into the
        // CM6 `goto-line` editor command, reading mode into the
        // ReadingView goto-line handler. Both already paint a ~1s
        // line flash on landing.
        if (
            isCtrlHeld(e) &&
            !e.shiftKey &&
            !e.altKey &&
            (e.key === "g" || e.key === "G")
        ) {
            e.preventDefault();
            e.stopPropagation();
            setShowGotoLine((v) => !v);
            return;
        }
        // Ctrl+P → commands-only palette ("Select a command…").
        if (matchesHotkey(e, getHotkey("command-palette", "Ctrl+P"))) {
            e.preventDefault();
            e.stopPropagation();
            // If the palette is already open in the other mode, flip
            // the mode instead of toggling visibility — matches the
            // VS Code behaviour where pressing the OTHER shortcut
            // while the palette is open swaps context without a
            // close/reopen blink.
            if (showCommandPalette() && commandPaletteMode() !== "commands") {
                setCommandPaletteMode("commands");
            } else {
                setCommandPaletteMode("commands");
                setShowCommandPalette((v) => !v);
            }
            return;
        }
        // Ctrl+O → "Find or create note" palette. Same widget, but
        // restricted to files and augmented with a "Create" entry
        // for queries that don't match any existing note.
        if (matchesHotkey(e, getHotkey("command-palette-alt", "Ctrl+O"))) {
            e.preventDefault();
            e.stopPropagation();
            if (showCommandPalette() && commandPaletteMode() !== "files") {
                setCommandPaletteMode("files");
            } else {
                setCommandPaletteMode("files");
                setShowCommandPalette((v) => !v);
            }
            return;
        }
        // Ctrl+N → create a new markdown note. Uses the existing
        // handleNewTab() flow (same prompt, same default location).
        if (matchesHotkey(e, getHotkey("new-note", "Ctrl+N"))) {
            e.preventDefault();
            e.stopPropagation();
            void handleNewTab();
            return;
        }
        // Ctrl+Alt+Left / Ctrl+Alt+Right are intercepted at the
        // very top of this handler (see the "tab switch" block
        // above the bare-Alt guard). Not repeated here.

        // Ctrl+Shift+C → insert a fenced code block in markdown.
        // Browsers bind this to "Inspect element" in devtools — we
        // intercept + preventDefault earlier above, but we ALSO
        // dispatch the editor command so the key is useful instead
        // of dead. Reuses the existing `codeblock` editor command
        // which wraps the selection in ``` fences.
        if (matchesHotkey(e, getHotkey("code-block", "Ctrl+Shift+C"))) {
            e.preventDefault();
            e.stopPropagation();
            document.dispatchEvent(
                new CustomEvent("mindzj:editor-command", {
                    detail: { command: "codeblock" },
                }),
            );
            return;
        }
        // Ctrl+Alt+C / Ctrl+Alt+V are NOT intercepted here. The
        // `linkHandlerExtension` in the editor installs a CM6
        // bubble-phase keydown handler (`linkAnchorHandler`) that
        // copies the current line/selection as a `filename#anchor`
        // reference and pastes it back as a `[[filename#anchor]]`
        // wiki link. Letting the event fall through from this global
        // capture handler is exactly what allows CM6 to see it.
        if (matchesHotkey(e, getHotkey("save", "Ctrl+S"))) {
            e.preventDefault();
            e.stopPropagation();
            document.dispatchEvent(new CustomEvent("mindzj:force-save"));
            return;
        }

        // Ctrl+W: save and close the currently active tab (the one
        // visible in whichever pane has focus). We dispatch the
        // force-save event first so the editor flushes any pending
        // changes via the same `mindzj:force-save` path that Ctrl+S
        // uses, then call `handleTabClose` which removes the file
        // from `openFiles` and rebalances the panes.
        if (matchesHotkey(e, getHotkey("close-tab", "Ctrl+W"))) {
            e.preventDefault();
            e.stopPropagation();
            const path =
                activePanePath() ?? vaultStore.activeFile()?.path ?? null;
            if (path) {
                document.dispatchEvent(new CustomEvent("mindzj:force-save"));
                handleTabClose(path);
            }
            return;
        }
        // Ctrl+Shift+T: reopen the most recently closed tab. Mirrors
        // the Chrome/Firefox "reopen closed tab" shortcut. Moved
        // from plain Ctrl+T because Ctrl+T on its own tends to clash
        // with other editor bindings (e.g. "transpose chars") and
        // the Shift variant is what most users already have in
        // muscle memory from their browser. The closed-tabs history
        // is a bounded LIFO stack pushed by `handleTabClose`.
        // Pressing the shortcut multiple times in a row reopens tabs
        // in reverse-close order (most recent first).
        if (matchesHotkey(e, getHotkey("reopen-tab", "Ctrl+Shift+T"))) {
            e.preventDefault();
            e.stopPropagation();
            reopenLastClosedTab();
            return;
        }
        if (matchesHotkey(e, getHotkey("task-list", "Ctrl+L"))) {
            e.preventDefault();
            e.stopPropagation();
            document.dispatchEvent(
                new CustomEvent("mindzj:editor-command", {
                    detail: { command: "task-list" },
                }),
            );
            return;
        }
        if (matchesHotkey(e, getHotkey("toggle-view-mode", "Ctrl+E"))) {
            e.preventDefault();
            e.stopPropagation();
            toggleViewModeWithSave(activePanePath() ?? undefined);
            return;
        }
        if (matchesHotkey(e, getHotkey("toggle-sidebar", "Ctrl+`"))) {
            e.preventDefault();
            e.stopPropagation();
            setSidebarCollapsed((v) => !v);
            return;
        }
        if (matchesHotkey(e, getHotkey("settings", "Ctrl+,"))) {
            e.preventDefault();
            e.stopPropagation();
            setShowSettings((v) => !v);
            return;
        }
        if (matchesHotkey(e, getHotkey("zoom-in", "Ctrl+="))) {
            e.preventDefault();
            e.stopPropagation();
            editorStore.zoomUI(10);
            return;
        }
        if (matchesHotkey(e, getHotkey("zoom-out", "Ctrl+-"))) {
            e.preventDefault();
            e.stopPropagation();
            editorStore.zoomUI(-10);
            return;
        }
        // Ctrl+0: only zoom reset when editor is NOT focused (Ctrl+0 = normal text in editor)
        if (
            matchesHotkey(e, getHotkey("zoom-reset", "Ctrl+0")) &&
            !editorFocused
        ) {
            e.preventDefault();
            e.stopPropagation();
            editorStore.zoomUI(100 - editorStore.uiZoom());
            return;
        }
        // Ctrl+1~6: don't intercept when editor is focused (heading shortcuts)

        // F2: rename the currently active file (global — works from any focus)
        if (e.key === "F2" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            const active = vaultStore.activeFile();
            if (active) {
                e.preventDefault();
                e.stopPropagation();
                document.dispatchEvent(
                    new CustomEvent("mindzj:rename-active-file"),
                );
            }
            return;
        }

        // Ctrl+Shift+F: switch to sidebar search panel. If the user
        // has text selected in the active editor (or reading view),
        // pre-populate the global search with that selection and kick
        // off a search immediately — the "select text, Ctrl+Shift+F"
        // flow users expect from .
        if (isCtrlHeld(e) && e.shiftKey && !e.altKey && e.key === "F") {
            e.preventDefault();
            e.stopPropagation();

            // Pull the current selection. Source / live-preview route
            // through the exposed CM6 view on `__mindzj_plugin_editor_api`;
            // reading mode uses the DOM selection scoped to
            // `.mz-reading-view` (the same gate used by Ctrl+F's
            // selection grab above).
            let selectionText = "";
            try {
                const api = (window as any).__mindzj_plugin_editor_api;
                const cmView = api?.cm as EditorView | undefined;
                if (cmView && !cmView.state.selection.main.empty) {
                    const sel = cmView.state.selection.main;
                    selectionText = cmView.state.sliceDoc(sel.from, sel.to);
                }
                if (!selectionText) {
                    const domSel = window.getSelection?.();
                    if (domSel && domSel.rangeCount > 0) {
                        const anchor = domSel.anchorNode;
                        const container =
                            anchor?.nodeType === Node.ELEMENT_NODE
                                ? (anchor as Element)
                                : anchor?.parentElement;
                        // Only accept a DOM selection inside the
                        // reading view. Selections in the sidebar or
                        // title bar aren't meaningful search queries.
                        if (
                            container?.closest(".mz-reading-view") &&
                            !container.closest(".mz-reading-find-panel")
                        ) {
                            selectionText = domSel.toString();
                        }
                    }
                }
            } catch (err) {
                console.warn("[ctrl-shift-f] selection read failed:", err);
            }

            // Collapse multi-line selections to the first non-empty
            // line — global search queries are single-line, and
            // dumping a paragraph into the input is almost never what
            // the user meant.
            if (selectionText.includes("\n")) {
                const firstLine = selectionText
                    .split("\n")
                    .map((l) => l.trim())
                    .find((l) => l.length > 0);
                selectionText = firstLine ?? "";
            }

            setSidebarTab("search");
            if (sidebarCollapsed()) setSidebarCollapsed(false);

            if (selectionText) {
                setGlobalSearchQuery(selectionText);
                // Run immediately so the user sees results without a
                // debounce delay. The panel will focus its input
                // (onMount or when SearchPanel re-mounts) and select
                // the text so "just type" replaces the selection.
                runGlobalSearchNow();
            }

            setTimeout(() => {
                const searchInput = document.querySelector(
                    ".mz-sidebar-search-input",
                ) as HTMLInputElement | null;
                if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                }
            }, 100);
            return;
        }

        // Alt+3: always switch to sidebar search (regardless of tab order)
        if (
            e.altKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            !e.shiftKey &&
            e.key === "3"
        ) {
            e.preventDefault();
            e.stopPropagation();
            setSidebarTab("search");
            if (sidebarCollapsed()) setSidebarCollapsed(false);
            setTimeout(() => {
                const searchInput = document.querySelector(
                    ".mz-sidebar-search-input",
                ) as HTMLInputElement;
                if (searchInput) searchInput.focus();
            }, 100);
            return;
        }

        // Alt+1..4: activate the corresponding sidebar icon tab (respects the
        // user's current drag-sorted order). Also expands the sidebar if
        // collapsed so the switch has a visible effect.
        if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            const n = parseInt(e.key, 10);
            if (n >= 1 && n <= 4) {
                const tabs = sidebarTabs();
                const target = tabs[n - 1];
                if (target) {
                    e.preventDefault();
                    e.stopPropagation();
                    setSidebarTab(target.id);
                    if (sidebarCollapsed()) setSidebarCollapsed(false);
                }
            }
        }
    }

    onMount(() => {
        // Create a stable closure for the tab-switch handler that
        // includes the switchOpenTab callback.
        const tabSwitchHandler = (e: KeyboardEvent) =>
            handleTabSwitchKeydown(e, switchOpenTab);

        // Use capture phase so global shortcuts (Ctrl+E, etc.) fire BEFORE
        // CodeMirror's own keydown handlers consume the event.
        window.addEventListener("keydown", tabSwitchHandler, true);
        document.addEventListener("keydown", handleGlobalKeydown, true);
        document.addEventListener("keyup", handleGlobalKeyup, true);
        onCleanup(() => {
            window.removeEventListener("keydown", tabSwitchHandler, true);
            document.removeEventListener("keydown", handleGlobalKeydown, true);
            document.removeEventListener("keyup", handleGlobalKeyup, true);
        });
    });
}
