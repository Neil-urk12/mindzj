/**
 * Editor extension assembly.
 *
 * Builds the complete CM6 Extension[] array for the markdown editor.
 * Extracted from Editor.tsx for testability and separation of concerns.
 */

import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import {
    EditorView,
    keymap,
    lineNumbers,
    drawSelection,
} from "@codemirror/view";
import {
    defaultKeymap,
    history,
    historyKeymap,
    cursorLineUp,
    cursorLineDown,
    cursorLineBoundaryBackward,
    cursorLineBoundaryForward,
    cursorGroupLeft,
    cursorGroupRight,
    selectLineUp,
    selectLineDown,
    selectLineBoundaryBackward,
    selectLineBoundaryForward,
    selectGroupLeft,
    selectGroupRight,
    redo,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
    syntaxHighlighting,
    defaultHighlightStyle,
    HighlightStyle,
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentUnit,
} from "@codemirror/language";
import { tags as t_ } from "@lezer/highlight";
import {
    search,
    searchKeymap,
    searchPanelOpen,
    getSearchQuery,
} from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";

import {
  findPanelOpen, setFindPanelOpen,
  findQuery, setFindQuery,
  findReplaceText, setFindReplaceText,
  findCaseSensitive, setFindCaseSensitive,
  findWholeWord, setFindWholeWord,
  findRegex, setFindRegex,
} from "../../../stores/findState";

import type { Extension } from "@codemirror/state";
import type { ViewMode } from "../../../stores/editor";
import type { AppSettings } from "../../../types";

import { editorStore } from "../../../stores/editor";
import { LIST_INDENT_UNIT, LIST_RENDER_TAB_SIZE } from "./listUtils";
import { linkHandlerExtension } from "./linkHandler";
import { listContinuationExtension } from "./listContinuation";
import { listStyleExtension } from "./listStyleExtension";
import { livePreviewExtension } from "./livePreview";
import { sourceHeadingLineExtension } from "./sourceHeadingLine";
import { createVSCodeSearchPanel } from "./searchPanel";
import { searchFlashField } from "./searchFlash";

// ---------------------------------------------------------------------------
// Highlight style for headings — strips underline, keeps bold + colour
// ---------------------------------------------------------------------------

export const mzHeadingHighlightStyle = HighlightStyle.define([
    {
        tag: t_.heading,
        textDecoration: "none",
        fontWeight: "bold",
        color: "var(--mz-syntax-heading)",
    },
    {
        tag: t_.heading1,
        textDecoration: "none",
        fontWeight: "bold",
        color: "var(--mz-syntax-heading)",
    },
    {
        tag: t_.heading2,
        textDecoration: "none",
        fontWeight: "bold",
        color: "var(--mz-syntax-heading)",
    },
    {
        tag: t_.heading3,
        textDecoration: "none",
        fontWeight: "bold",
        color: "var(--mz-syntax-heading)",
    },
    {
        tag: t_.heading4,
        textDecoration: "none",
        fontWeight: "bold",
        color: "var(--mz-syntax-heading)",
    },
    {
        tag: t_.heading5,
        textDecoration: "none",
        fontWeight: "bold",
        color: "var(--mz-syntax-heading)",
    },
    {
        tag: t_.heading6,
        textDecoration: "none",
        fontWeight: "bold",
        color: "var(--mz-syntax-heading)",
    },
]);

// ---------------------------------------------------------------------------
// Zoom theme — applied via a Compartment so CM6 rebuilds its height map
// ---------------------------------------------------------------------------

/**
 * Build the font-size theme used by the zoom compartment.
 *
 * The font-size is applied via a THEME (not an inherited CSS variable)
 * because CodeMirror only invalidates its internal height map when a
 * theme change flows through its own update pipeline. Reconfiguring
 * this theme through a Compartment is what actually tells CM6
 * "everything might have a new height — throw away the cached heightmap
 * and re-measure from scratch". Without that, changing font-size on an
 * ancestor via CSS leaves the heightmap stale and the cursor drifts off
 * the text during Ctrl+wheel zoom.
 */
export function buildZoomTheme(pxSize: number) {
    return EditorView.theme({
        "&": {
            fontSize: `${pxSize}px`,
        },
    });
}

// ---------------------------------------------------------------------------
// Horizontal-rule cursor snapping helpers
// ---------------------------------------------------------------------------

function isHorizontalRuleLineText(text: string): boolean {
    return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(text);
}

function horizontalRuleCursorPos(line: { from: number; text: string }): number {
    const match = line.text.match(/^(\s{0,3})(-{3,}|\*{3,}|_{3,})/);
    if (!match) return line.from + line.text.length;
    return line.from + match[1].length + match[2].length;
}

function adjustHorizontalRuleCursor(
    view: EditorView,
    preserveAnchor: number | null = null,
): boolean {
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    if (!isHorizontalRuleLineText(line.text)) return false;
    const target = horizontalRuleCursorPos(line);
    if (selection.head === target) return false;
    view.dispatch({
        selection:
            preserveAnchor === null
                ? EditorSelection.cursor(target)
                : EditorSelection.range(preserveAnchor, target),
        scrollIntoView: true,
    });
    return true;
}

export function moveLineAndSnapHorizontalRule(
    view: EditorView,
    move: (view: EditorView) => boolean,
): boolean {
    const ok = move(view);
    if (!ok) return false;
    adjustHorizontalRuleCursor(view);
    return true;
}

export function selectLineAndSnapHorizontalRule(
    view: EditorView,
    move: (view: EditorView) => boolean,
): boolean {
    const anchor = view.state.selection.main.anchor;
    const ok = move(view);
    if (!ok) return false;
    adjustHorizontalRuleCursor(view, anchor);
    return true;
}

// ---------------------------------------------------------------------------
// Formatting commands (used by keymap + dispatchEditorCommand)
// ---------------------------------------------------------------------------

export function wrapSelection(
    view: EditorView,
    before: string,
    after?: string,
): boolean {
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to);
    const wrappedAfter = after ?? before;
    const replacement = `${before}${text || "text"}${wrappedAfter}`;
    view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: replacement },
        selection: {
            anchor: sel.from + before.length,
            head: sel.from + before.length + (text.length || 4),
        },
    });
    return true;
}

export function insertLink(view: EditorView): boolean {
    const sel = view.state.selection.main;
    const text = view.state.sliceDoc(sel.from, sel.to);
    const replacement = `[${text || "text"}](url)`;
    view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: replacement },
        selection: {
            anchor: sel.from + text.length + 3,
            head: sel.from + text.length + 6,
        },
    });
    return true;
}

// Set heading level (0 = remove heading, 1-6 = H1-H6)
export function setHeading(view: EditorView, level: number): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const existingMatch = line.text.match(/^#{1,6}\s*/);
    const removeLen = existingMatch ? existingMatch[0].length : 0;
    const prefix = level > 0 ? "#".repeat(level) + " " : "";
    const contentOffset =
        line.text.trim().length === 0
            ? 0
            : Math.max(0, pos - line.from - removeLen);
    const nextCursor = line.from + prefix.length + contentOffset;
    view.dispatch({
        changes: {
            from: line.from,
            to: line.from + removeLen,
            insert: prefix,
        },
        selection: { anchor: nextCursor },
    });
    return true;
}

// Delete the current line
export function deleteLine(view: EditorView): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const from = line.from;
    const to =
        line.number < view.state.doc.lines
            ? line.to + 1
            : line.from > 0
              ? line.from - 1
              : line.to;
    view.dispatch({
        changes: {
            from: Math.max(
                0,
                from > 0 && line.number === view.state.doc.lines
                    ? from - 1
                    : from,
            ),
            to,
        },
    });
    return true;
}

// Indent entire line from the start (for Ctrl+] / Ctrl+[)
export function indentLineFromStart(
    view: EditorView,
    indent: boolean,
): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    if (indent) {
        view.dispatch({ changes: { from: line.from, insert: "\t" } });
    } else {
        const match = line.text.match(/^(\t| {1,4})/);
        if (match) {
            view.dispatch({
                changes: {
                    from: line.from,
                    to: line.from + match[0].length,
                },
            });
        }
    }
    return true;
}

// Insert line below current line
export function insertLineBelow(view: EditorView): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    view.dispatch({
        changes: { from: line.to, insert: "\n" },
        selection: { anchor: line.to + 1 },
    });
    return true;
}

// Insert line above current line
export function insertLineAbove(view: EditorView): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    view.dispatch({
        changes: { from: line.from, insert: "\n" },
        selection: { anchor: line.from },
    });
    return true;
}

// Move line up or down
export function moveLine(view: EditorView, direction: number): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    if (direction === -1 && line.number === 1) return true;
    if (direction === 1 && line.number === view.state.doc.lines)
        return true;

    const targetLine = view.state.doc.line(line.number + direction);
    if (direction === -1) {
        // Swap with line above
        view.dispatch({
            changes: [
                {
                    from: targetLine.from,
                    to: line.to,
                    insert: line.text + "\n" + targetLine.text,
                },
            ],
            selection: { anchor: targetLine.from + (pos - line.from) },
        });
    } else {
        // Swap with line below
        view.dispatch({
            changes: [
                {
                    from: line.from,
                    to: targetLine.to,
                    insert: targetLine.text + "\n" + line.text,
                },
            ],
            selection: {
                anchor:
                    line.from +
                    targetLine.text.length +
                    1 +
                    (pos - line.from),
            },
        });
    }
    return true;
}

// Duplicate current line
export function duplicateLine(view: EditorView): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    view.dispatch({
        changes: { from: line.to, insert: "\n" + line.text },
        selection: { anchor: line.to + 1 + (pos - line.from) },
    });
    return true;
}

// Toggle HTML comment on current line
export function toggleComment(view: EditorView): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const trimmed = line.text.trim();
    if (trimmed.startsWith("<!--") && trimmed.endsWith("-->")) {
        // Unwrap comment
        const inner = trimmed.slice(4, -3).trim();
        view.dispatch({
            changes: { from: line.from, to: line.to, insert: inner },
        });
    } else {
        // Wrap in comment
        view.dispatch({
            changes: {
                from: line.from,
                to: line.to,
                insert: `<!-- ${line.text} -->`,
            },
        });
    }
    return true;
}

// Toggle blockquote on current line
export function toggleBlockquote(view: EditorView): boolean {
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    if (line.text.startsWith("> ")) {
        view.dispatch({ changes: { from: line.from, to: line.from + 2 } });
    } else {
        view.dispatch({ changes: { from: line.from, insert: "> " } });
    }
    return true;
}

// ---------------------------------------------------------------------------
// Extension assembly options
// ---------------------------------------------------------------------------

export interface BuildExtensionsOptions {
    /** Current view mode (source, live-preview, reading). */
    viewMode: ViewMode;
    /** Application settings snapshot. */
    settings: AppSettings;
    /** Vault root path for image previews. */
    vaultRoot: string;
    /** Current file path (used by paste handler and update listener). */
    path: string | null;
    /** Plugin-registered CM6 extensions. */
    pluginExtensions: Extension[];
    /** Compartment for zoom font-size theme. */
    zoomCompartment: Compartment;
    /** Returns true when this editor pane is the active one. */
    isPaneActive: () => boolean;
    /** Activate this editor pane (focus, plugin sync). */
    activatePane: () => void;
    /** Switch to adjacent tab. */
    switchTabFromEditor: (direction: "prev" | "next") => boolean;
    /** Build context menu items for the given view. */
    buildContextMenu: (view: EditorView) => { label: string; action: () => void; separator?: boolean }[];
    /** Set the context menu state (open/close). */
    setContextMenu: (menu: { x: number; y: number; items: any[] } | null) => void;
    /** Returns true while a programmatic document update is in progress. */
    isProgrammaticUpdate: () => boolean;
    /**
     * Callback invoked when an image is pasted into the editor.
     * Receives the DataTransfer from the paste event, the current note path,
     * and the configured attachment folder. Returns true if the paste was
     * handled (so the caller can preventDefault).
     */
    onPasteImage?: (blob: File, ext: string, currentNotePath: string, editorView: EditorView) => Promise<void>;
    /** Returns true while restoring shared search state (suppresses echo). */
    isRestoringSearchState: () => boolean;
}

// ---------------------------------------------------------------------------
// buildExtensions — assembles the full CM6 Extension[]
// ---------------------------------------------------------------------------

export function buildExtensions(options: BuildExtensionsOptions): Extension[] {
    const {
        viewMode,
        settings,
        vaultRoot,
        path: currentFilePath,
        pluginExtensions,
        zoomCompartment,
        isPaneActive,
        activatePane,
        switchTabFromEditor,
        buildContextMenu,
        setContextMenu,
        isProgrammaticUpdate,
        isRestoringSearchState,
    } = options;

    const isLivePreview = viewMode === "live-preview";
    const isReading = viewMode === "reading";
    const isSourceMode = viewMode === "source";

    // Line numbers + fold gutter: ONLY in source mode AND only if the user
    // has enabled line numbers in Settings. When disabled we skip the fold
    // gutter too so the left rail disappears entirely (previously an
    // empty fold gutter column remained).
    const showGutter =
        isSourceMode && settings.editor_line_numbers;

    const extensions: Extension[] = [
        // Force tab-based indentation globally — prevents CM6's
        // insertNewlineAndIndent from converting tabs to spaces.
        indentUnit.of(LIST_INDENT_UNIT),
        EditorState.tabSize.of(LIST_RENDER_TAB_SIZE),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        // NOTE: `highlightSelectionMatches()` is NOT installed in
        // any mode. We used to enable it in source mode, but the
        // user explicitly asked that selecting text should NOT
        // auto-paint every other occurrence of the same text —
        // that's what the dedicated search panel (Ctrl+F) is for.
        // Selection highlighting is left to the native browser
        // `.cm-selectionBackground` style only.
        ...(showGutter ? [foldGutter(), lineNumbers()] : []),
        markdown({
            base: markdownLanguage,
            extensions: [{ remove: ["SetextHeading"] }],
        }),
        // Custom highlight style MUST come first so it overrides the
        // default. `defaultHighlightStyle` from @codemirror/language
        // sets `textDecoration: "underline"` on `tags.heading`, which
        // draws an underline under every H1–H6 in source mode. We
        // strip that here and restore the bold/colour styling.
        syntaxHighlighting(mzHeadingHighlightStyle),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

        // List continuation (auto-continue on Enter, indent/outdent)
        listContinuationExtension(),

        // Install the search state/extension so the Ctrl+F panel
        // mounts at the TOP of the editor instead of the default
        // bottom position. CSS in editor.css then absolute-
        // positions that top panel as a floating VS Code-style
        // find widget in the top-right corner.
        //
        // `createPanel` swaps CM6's default form for a custom
        // VS Code-style panel (see extensions/searchPanel.ts) —
        // chevron toggle for the replace row, Aa/ab/.* toggles
        // as icon buttons, match counter, nav arrows, and
        // find-in-selection / close buttons.
        search({ top: true, createPanel: createVSCodeSearchPanel }),

        // `searchCounterExtension` used to append a match-count
        // span into CM6's default `.cm-search` form. Our custom
        // VS Code panel owns its own counter element and updates
        // it on every viewport/query update, so the old injector
        // would just drop a duplicate span in the DOM. It's kept
        // imported (below) but deliberately NOT installed.
        // searchCounterExtension(),

        // Search-reveal flash highlight — temporary decoration
        // fired from the global search panel when the user
        // clicks a result. Scrolls to the line and paints a
        // yellow-ish flash over the matched text for ~1.5s.
        searchFlashField,

        // Link handler (Ctrl+Click, wiki link autocomplete,
        // Ctrl+Alt+C/V link-anchor copy/paste)
        linkHandlerExtension(),

        // Source mode only: tag heading lines with mz-src-h1…h6
        // line classes so the CSS can apply heading font-size on the
        // line wrapper. Applying it on the inline .cm-header-N span
        // makes the visible line taller than CM6's measured height,
        // which breaks arrow-key movement and click positioning.
        ...(isSourceMode ? [sourceHeadingLineExtension()] : []),

        // Source mode: apply the shared list-styling extension so
        // ordered/unordered lists render with the same bullet,
        // ordered-marker color, hanging-indent wrap and nested
        // guide lines as live-preview. In live-preview mode the
        // same visuals are supplied by `livePreviewExtension`
        // below (which owns a superset of the list logic).
        ...(isSourceMode ? listStyleExtension() : []),

        // Live Preview extension (only in live-preview mode).
        // Block widgets (blockWidgetExtension) are NOT included here —
        // Decoration.replace({block:true}) makes code blocks / tables
        // atomic, so the cursor can't be placed inside, arrow keys
        // skip them, and clicks can't map to source lines. Instead,
        // livePreview.ts styles the raw source via line decorations
        // () so every character stays cursor-addressable.
        ...(isLivePreview
            ? livePreviewExtension(vaultRoot, currentFilePath ?? "")
            : []),

        // Reading mode: make editor non-editable
        ...(isReading ? [EditorState.readOnly.of(true)] : []),

        // Plugin-registered CM6 extensions (via registerEditorExtension)
        ...pluginExtensions,

        keymap.of([
            {
                key: "Mod-Shift-ArrowLeft",
                run: () => switchTabFromEditor("prev"),
            },
            {
                key: "Mod-Shift-ArrowRight",
                run: () => switchTabFromEditor("next"),
            },
            // PageUp / PageDown intentionally NOT overridden here —
            // we fall through to `defaultKeymap` which binds them
            // to `cursorPageUp` / `cursorPageDown`, i.e. scroll
            // the cursor by one viewport page. This matches VS
            // Code / the web default behaviour the
            // user explicitly asked us to preserve.
            ...(isLivePreview
                ? [
                      { key: "Home", run: cursorLineBoundaryBackward },
                      { key: "End", run: cursorLineBoundaryForward },
                      {
                          key: "Shift-Home",
                          run: selectLineBoundaryBackward,
                      },
                      { key: "Shift-End", run: selectLineBoundaryForward },
                      {
                          key: "Mod-Shift-Home",
                          run: selectLineBoundaryBackward,
                      },
                      {
                          key: "Mod-Shift-End",
                          run: selectLineBoundaryForward,
                      },
                      {
                          key: "ArrowUp",
                          run: (v: EditorView) =>
                              moveLineAndSnapHorizontalRule(
                                  v,
                                  cursorLineUp,
                              ),
                      },
                      {
                          key: "ArrowDown",
                          run: (v: EditorView) =>
                              moveLineAndSnapHorizontalRule(
                                  v,
                                  cursorLineDown,
                              ),
                      },
                      {
                          key: "Shift-ArrowUp",
                          run: (v: EditorView) =>
                              selectLineAndSnapHorizontalRule(
                                  v,
                                  selectLineUp,
                              ),
                      },
                      {
                          key: "Shift-ArrowDown",
                          run: (v: EditorView) =>
                              selectLineAndSnapHorizontalRule(
                                  v,
                                  selectLineDown,
                              ),
                      },
                  ]
                : []),
            // Formatting shortcuts — before defaultKeymap so they
            // take priority (e.g. Mod-i would otherwise hit
            // selectParentSyntax from @codemirror/commands).
            { key: "Mod-b", run: (v) => wrapSelection(v, "**") },
            { key: "Mod-i", run: (v) => wrapSelection(v, "*") },
            { key: "Mod-Shift-s", run: (v) => wrapSelection(v, "~~") },
            { key: "Mod-u", run: (v) => wrapSelection(v, "<u>", "</u>") },
            // Ctrl+E is reserved for toggling edit/preview mode (handled by global keydown).
            // Inline code: use Ctrl+Shift+E instead.
            { key: "Mod-Shift-e", run: (v) => wrapSelection(v, "`") },
            { key: "Mod-k", run: (v) => insertLink(v) },
            { key: "Mod-Shift-h", run: (v) => wrapSelection(v, "==") },
            // Heading shortcuts: Ctrl+1 ~ Ctrl+6 for H1-H6
            { key: "Mod-1", run: (v) => setHeading(v, 1) },
            { key: "Mod-2", run: (v) => setHeading(v, 2) },
            { key: "Mod-3", run: (v) => setHeading(v, 3) },
            { key: "Mod-4", run: (v) => setHeading(v, 4) },
            { key: "Mod-5", run: (v) => setHeading(v, 5) },
            { key: "Mod-6", run: (v) => setHeading(v, 6) },
            // Ctrl+0 = remove heading (normal paragraph)
            { key: "Mod-0", run: (v) => setHeading(v, 0) },
            ...defaultKeymap,
            ...historyKeymap,
            // Redo: Ctrl+Shift+Z (, overrides default Ctrl+Y)
            { key: "Mod-Shift-z", run: (v) => redo(v) },
            ...searchKeymap,
            ...foldKeymap,
            ...closeBracketsKeymap,
            // Ctrl+D: delete current line
            { key: "Mod-d", run: (v) => deleteLine(v) },
            // Ctrl+Shift+K: also delete line (VS Code style)
            { key: "Mod-Shift-k", run: (v) => deleteLine(v) },
            // Ctrl+]: indent entire line from start
            { key: "Mod-]", run: (v) => indentLineFromStart(v, true) },
            // Ctrl+[: outdent entire line from start
            { key: "Mod-[", run: (v) => indentLineFromStart(v, false) },
            // Ctrl+Enter: insert line below
            { key: "Mod-Enter", run: (v) => insertLineBelow(v) },
            // Ctrl+Shift+Enter: insert line above
            { key: "Mod-Shift-Enter", run: (v) => insertLineAbove(v) },
            // Alt+Up/Down: move line up/down
            { key: "Alt-ArrowUp", run: (v) => moveLine(v, -1) },
            { key: "Alt-ArrowDown", run: (v) => moveLine(v, 1) },
            // Alt+Left/Right: move by word; Alt+Shift extends selection by word.
            {
                key: "Alt-ArrowLeft",
                run: cursorGroupLeft,
                shift: selectGroupLeft,
                preventDefault: true,
            },
            {
                key: "Alt-ArrowRight",
                run: cursorGroupRight,
                shift: selectGroupRight,
                preventDefault: true,
            },
            // Ctrl+Shift+D: duplicate line
            { key: "Mod-Shift-d", run: (v) => duplicateLine(v) },
            // Ctrl+/: toggle comment (HTML comment for markdown)
            { key: "Mod-/", run: (v) => toggleComment(v) },
            // Ctrl+Shift+.: toggle callout/blockquote
            { key: "Mod-Shift-.", run: (v) => toggleBlockquote(v) },
            // Ctrl+Alt+Left / Ctrl+Alt+Right → switch tabs. The
            // same shortcut is ALSO handled by the capture-phase
            // keydown in App.tsx, but keeping a CM6 binding here
            // is a safety net for the case where the webview
            // doesn't deliver the event to the document listener
            // (which has bitten us in the past on certain
            // keyboard layouts and on Tauri focus transitions).
            //
            // The two paths are idempotent: whichever one fires
            // first calls preventDefault, which suppresses the
            // other. If somehow both fired, they'd both just set
            // the active file to the same `files[newIdx]`, so
            // there's no double-step bug.
        ]),

        EditorView.updateListener.of((update) => {
            if (update.docChanged && !isProgrammaticUpdate()) {
                const content = update.state.doc.toString();
                if (currentFilePath) {
                    editorStore.scheduleAutoSave(currentFilePath, content);
                }
                if (isPaneActive()) {
                    editorStore.updateStats(content);
                }
            }
            if (update.selectionSet && isPaneActive()) {
                const pos = update.state.selection.main.head;
                const line = update.state.doc.lineAt(pos);
                editorStore.setCursorLine(line.number);
                editorStore.setCursorCol(pos - line.from + 1);
            }
            if (update.selectionSet && currentFilePath) {
                const selection = update.state.selection.main;
                editorStore.setFileCursorSelection(currentFilePath, {
                    anchor: selection.anchor,
                    head: selection.head,
                });
            }

            // Mirror the CM6 search state into the shared find
            // signals so tab switches / mode switches pick up the
            // latest query + open-state without depending on the
            // onCleanup snapshot path. Gated on `isRestoringSearchState`
            // so we don't echo the effects we just dispatched from
            // restore back into the same signals. We only write
            // when values actually differ from the signal — Solid's
            // fine-grained reactivity already deduplicates equal
            // values but the comparisons here keep the work off the
            // hot path.
            if (!isRestoringSearchState()) {
                const nextOpen = searchPanelOpen(update.state);
                if (nextOpen !== findPanelOpen()) {
                    setFindPanelOpen(nextOpen);
                }
                const q = getSearchQuery(update.state);
                if (q) {
                    if ((q.search ?? "") !== findQuery()) {
                        setFindQuery(q.search ?? "");
                    }
                    if ((q.replace ?? "") !== findReplaceText()) {
                        setFindReplaceText(q.replace ?? "");
                    }
                    if (!!q.caseSensitive !== findCaseSensitive()) {
                        setFindCaseSensitive(!!q.caseSensitive);
                    }
                    if (!!q.wholeWord !== findWholeWord()) {
                        setFindWholeWord(!!q.wholeWord);
                    }
                    if (!!q.regexp !== findRegex()) {
                        setFindRegex(!!q.regexp);
                    }
                }
            }
        }),

        EditorView.domEventHandlers({
            keydown(event) {
                // Ctrl+Shift+Left / Ctrl+Shift+Right → switch tabs.
                // Ctrl+Alt+Left / Ctrl+Alt+Right remains an alias.
                //
                // Hard-coded match (not `matchesHotkey`) and uses
                // both `event.code` and `event.key` so non-US
                // keyboard layouts can't silently break this.
                // This is only a safety net — the primary path
                // is the capture-phase document listener in
                // App.tsx, which calls stopImmediatePropagation
                // before this handler would ever see the event.
                const keyCode = event.keyCode || event.which;
                const isHorizontalArrow =
                    event.code === "ArrowLeft" ||
                    event.code === "ArrowRight" ||
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowRight" ||
                    event.key === "Left" ||
                    event.key === "Right" ||
                    keyCode === 37 ||
                    keyCode === 39;
                if (
                    (event.ctrlKey || event.metaKey) &&
                    isHorizontalArrow &&
                    ((event.shiftKey && !event.altKey) ||
                        (event.altKey && !event.shiftKey))
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    event.stopImmediatePropagation?.();
                    const goLeft =
                        event.code === "ArrowLeft" ||
                        event.key === "ArrowLeft" ||
                        event.key === "Left" ||
                        keyCode === 37;
                    return switchTabFromEditor(goLeft ? "prev" : "next");
                }
                return false;
            },
            wheel(event) {
                if (event.ctrlKey) {
                    event.preventDefault();
                    const raw = -event.deltaY;
                    const step =
                        Math.sign(raw) *
                        Math.min(3, Math.max(1, Math.abs(raw) / 50));
                    editorStore.zoomEditorText(Math.round(step));
                    return true;
                }
                return false;
            },
            // contextmenu intentionally NOT here — see
            // domEventObservers below for explanation.
            focus() {
                activatePane();
                return false;
            },
            mousedown() {
                activatePane();
                return false;
            },
            paste(event, _view) {
                const items = event.clipboardData?.items;
                if (!items) {
                    return false;
                }

                if (options.onPasteImage) {
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        if (item.type.startsWith("image/")) {
                            event.preventDefault();
                            // Extract File blob synchronously in the
                            // event handler — DataTransferItemList items
                            // and getAsFile() are only guaranteed valid
                            // during the event dispatch. Passing the
                            // blob (not the DataTransfer) through the
                            // callback avoids stale-item issues in
                            // WebView2.
                            const blob = item.getAsFile();
                            const ext =
                                item.type
                                    .split("/")[1]
                                    ?.replace("jpeg", "jpg") || "png";
                            const notePath = currentFilePath ?? "";
                            if (blob) {
                                options.onPasteImage(
                                    blob,
                                    ext,
                                    notePath,
                                    _view,
                                );
                                return true;
                            }
                        }
                    }

                    // No image/* items found in clipboardData.items.
                    // Try Tauri native clipboard as fallback — this can read
                    // image data even when the browser clipboard API is blocked
                    // (e.g. WebView2 NotAllowedError on navigator.clipboard.read()).
                    event.preventDefault();
                    (async () => {
                        try {
                            const imageData = await readImage();
                            if (imageData) {
                                const rgba = await imageData.rgba();
                                const size = await imageData.size();
                                if (rgba && rgba.length > 0) {
                                    // Convert RGBA to PNG blob via canvas
                                    const canvas = document.createElement("canvas");
                                    canvas.width = size.width;
                                    canvas.height = size.height;
                                    const ctx = canvas.getContext("2d")!;
                                    const imgData = new ImageData(
                                        new Uint8ClampedArray(rgba),
                                        size.width,
                                        size.height,
                                    );
                                    ctx.putImageData(imgData, 0, 0);
                                    const blob = await new Promise<Blob>((resolve) =>
                                        canvas.toBlob((b) => resolve(b!), "image/png"),
                                    );
                                    const notePath = currentFilePath ?? "";
                                    options.onPasteImage?.(blob, "png", notePath, _view);
                                    return;
                                }
                            }
                        } catch (err) {
                            console.error("[paste] Tauri clipboard failed:", err);
                        }
                    })();
                    return true;
                }
                return false;
            },
        }),


        // Zoom compartment — holds the font-size theme. Reconfigured
        // on Ctrl+wheel to trigger a full height-map rebuild. Must
        // come BEFORE the base theme below so later theme rules (if
        // any target font-size) can still override it, and AFTER
        // state initialisation so createEffect can reconfigure it.
        zoomCompartment.of(
            buildZoomTheme(
                (editorStore.editorZoom() / 100) *
                    settings.font_size,
            ),
        ),

        EditorView.theme({
            "&": {
                height: "100%",
            },
            ".cm-scroller": {
                overflow: "auto",
                fontFamily: "var(--mz-font-sans)",
            },
            ".cm-content": {
                padding: "10px 24px",
                caretColor: "var(--mz-accent)",
                minHeight: "100%",
            },
            ".cm-cursor": {
                borderLeftColor: "var(--mz-accent)",
                borderLeftWidth: "2px",
            },
            ".cm-selectionBackground": {
                background: "var(--mz-bg-selection) !important",
            },
            ".cm-activeLine": { background: "var(--mz-bg-hover)" },
            ".cm-gutters": {
                background: "var(--mz-bg-secondary)",
                color: "var(--mz-text-muted)",
                border: "none",
                borderRight: "1px solid var(--mz-border)",
            },
            ".cm-activeLineGutter": { background: "var(--mz-bg-hover)" },
            "&.cm-focused .cm-matchingBracket": {
                background: "var(--mz-accent-subtle)",
            },
        }),

        EditorView.lineWrapping,
    ];

    return extensions;
}
