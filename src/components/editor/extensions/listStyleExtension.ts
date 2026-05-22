/**
 * Shared list-styling extension for MindZJ's editor.
 *
 * Applies the visual rendering of ordered / unordered / task list lines
 * that USED to live solely inside `livePreview.ts`. Extracted here so
 * source mode can reuse the same styling without pulling in the rest
 * of the live-preview rendering (bold/italic/heading markers, link
 * collapsing, etc.).
 *
 * What this extension provides (same in source AND live-preview mode):
 *
 *   - Ordered-list marker (`1.`, `2.`, …) is drawn in the muted comment
 *     color via an inline `.mz-lp-ordered-marker` mark decoration.
 *   - Unordered-list marker (`-`, `*`, `+`) is replaced by a small
 *     round bullet widget on lines that DON'T hold the caret. On the
 *     caret line the raw character stays visible so the user can edit
 *     it normally.
 *   - The content portion of each list line is wrapped in an inline-
 *     block span (`.mz-lp-list-content`) that CSS uses to produce a
 *     hanging-indent wrap — the second visual line of a long list item
 *     lines up under the first character AFTER the marker, not back at
 *     column zero.
 *   - Nested list lines get a `.mz-lp-list-guides` line class that
 *     paints a repeating vertical guide for every level of indent.
 *   - A `ResizeObserver` keeps the `--mz-list-indent-step` CSS variable
 *     in sync with the editor's actual tab width so the hanging-indent
 *     math stays accurate when the font size changes.
 *
 * What this extension DOES NOT provide:
 *
 *   - Heading / blockquote / horizontal-rule / code-fence / table line
 *     decorations — those stay in `livePreview.ts` because they're
 *     only wanted in live-preview mode.
 *   - Inline formatting (bold, italic, highlight, link, tag, etc.).
 */

import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
} from "@codemirror/view";
import { Range, StateField, Transaction } from "@codemirror/state";
import {
    getContinuationInfo,
    bulletWidget,
    orderedMarkerDeco,
    listContentDeco,
    listGuideDeco,
    listWrapDeco,
    syncListGuideMetrics,
    listSharedTheme,
} from "./listUtils";

// ---------------------------------------------------------------------------
// Line-level decorations (StateField) — listWrapDeco + listGuideDeco
//
// These decorate the `<div class="cm-line">` wrapper and so CAN affect
// CM6's vertical layout. Per the CM6 docs, only decoration sets fed
// directly into `EditorView.decorations` (i.e. via a StateField's
// `provide` hook) are allowed to drive layout. A ViewPlugin would
// compute them AFTER layout and CM6's height map would stay stale.
// ---------------------------------------------------------------------------

function buildListLineDecorations(
    state: import("@codemirror/state").EditorState,
): DecorationSet {
    const doc = state.doc;
    const decos: Range<Decoration>[] = [];

    // Fence + table detection so we don't paint list styling on lines
    // that only LOOK like list items because they start with `-` (e.g.
    // table separator rows `|---|---|`).
    const tableSepRe = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
    const isTableRow = (t: string) =>
        t.trim().startsWith("|") && t.indexOf("|", t.indexOf("|") + 1) !== -1;

    let inFence = false;
    let fenceChar = "";

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;

        const fenceMatch = text.match(/^(`{3,}|~{3,})/);
        if (fenceMatch) {
            if (!inFence) {
                inFence = true;
                fenceChar = fenceMatch[1][0];
            } else if (text.startsWith(fenceChar.repeat(3))) {
                inFence = false;
                fenceChar = "";
            }
            continue;
        }
        if (inFence) continue;
        if (isTableRow(text) || tableSepRe.test(text)) continue;

        const listInfo = getContinuationInfo(text);
        if (!listInfo || listInfo.kind === "blockquote") continue;

        decos.push(
            listWrapDeco(listInfo.level, listInfo.marker.length).range(line.from),
        );
        if (listInfo.level > 0) {
            decos.push(listGuideDeco(listInfo.level).range(line.from));
        }
    }

    return Decoration.set(decos, true);
}

const listLineDecorationField = StateField.define<DecorationSet>({
    create(state) {
        return buildListLineDecorations(state);
    },
    update(value, tr: Transaction) {
        if (!tr.docChanged) return value;
        return buildListLineDecorations(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Inline / replace decorations (ViewPlugin)
//
// These don't change line heights, so running them in a ViewPlugin
// (which sees viewport updates only) is fast and safe for layout.
// ---------------------------------------------------------------------------

function buildListMarkDecorations(view: EditorView): DecorationSet {
    const decos: Range<Decoration>[] = [];
    const doc = view.state.doc;
    const cursorLine = doc.lineAt(view.state.selection.main.head).number;

    const tableSepRe = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
    const isTableRow = (t: string) =>
        t.trim().startsWith("|") && t.indexOf("|", t.indexOf("|") + 1) !== -1;

    let inFence = false;
    let fenceChar = "";

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        const isCurrentLine = i === cursorLine;

        if (!text.trim()) continue;

        const fenceMatch = text.match(/^(`{3,}|~{3,})/);
        if (fenceMatch) {
            if (!inFence) {
                inFence = true;
                fenceChar = fenceMatch[1][0];
            } else if (text.startsWith(fenceChar.repeat(3))) {
                inFence = false;
                fenceChar = "";
            }
            continue;
        }
        if (inFence) continue;
        if (isTableRow(text) || tableSepRe.test(text)) continue;

        // Ordered-list marker coloring — always applied so the muted
        // color stays even when the caret is on the line.
        const orderedMatch = text.match(/^(\s*)(\d+\.)\s/);
        if (orderedMatch) {
            const markerStart = line.from + orderedMatch[1].length;
            const markerEnd = markerStart + orderedMatch[2].length;
            decos.push(orderedMarkerDeco.range(markerStart, markerEnd));
        }

        // Unordered-list marker → round-bullet widget. Skipped on the
        // caret line so the raw `-` / `*` / `+` char stays editable.
        // Also skipped for task-list lines (`- [x] …`) because the
        // livePreview extension owns the checkbox-widget rendering
        // there — running two replace decorations on overlapping
        // ranges would raise a CM6 invariant error.
        const taskMatch = text.match(/^(\s*)-\s+\[([ xX])\]\s/);
        if (!taskMatch && !isCurrentLine) {
            const bulletMatch = text.match(/^(\s*)([-*+])(\s)/);
            if (bulletMatch) {
                const markerStart = line.from + bulletMatch[1].length;
                const markerEnd = markerStart + 1;
                decos.push(
                    Decoration.replace({ widget: bulletWidget }).range(
                        markerStart,
                        markerEnd,
                    ),
                );
            }
        }

        // Content span for hanging-indent wrap. Its `inline-block` CSS
        // gives it an explicit width equal to `100% - (marker area)`.
        const listInfo = getContinuationInfo(text);
        if (listInfo && listInfo.kind !== "blockquote") {
            const contentStart =
                line.from + listInfo.rawIndent.length + listInfo.marker.length;
            if (contentStart < line.to) {
                decos.push(listContentDeco.range(contentStart, line.to));
            }
        }
    }

    return Decoration.set(decos, true);
}

function createListStylePlugin() {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            resizeObserver: ResizeObserver | null = null;

            constructor(view: EditorView) {
                syncListGuideMetrics(view);
                this.decorations = buildListMarkDecorations(view);

                if (typeof ResizeObserver !== "undefined") {
                    this.resizeObserver = new ResizeObserver(() => {
                        syncListGuideMetrics(view);
                    });
                    this.resizeObserver.observe(view.dom);
                }
            }

            update(update: ViewUpdate) {
                if (update.geometryChanged || update.viewportChanged) {
                    syncListGuideMetrics(update.view);
                }
                if (
                    update.docChanged ||
                    update.selectionSet ||
                    update.viewportChanged
                ) {
                    this.decorations = buildListMarkDecorations(update.view);
                }
            }

            destroy() {
                this.resizeObserver?.disconnect();
            }
        },
        {
            decorations: (v) => v.decorations,
        },
    );
}

// ---------------------------------------------------------------------------
// Base theme — bullet + ordered-marker CSS
//
// Shipped with the extension rather than `editor.css` so both source
// and live-preview modes pick up exactly the same visuals wherever the
// extension is loaded. (Live-preview also installs this extension via
// its bundle, so it gets the styles too.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listStyleExtension() {
    return [listSharedTheme, listLineDecorationField, createListStylePlugin()];
}
