/**
 * MindZJ Live Preview Extension for CodeMirror 6
 *
 * Renders Markdown inline while editing:
 * - Headings display at their rendered size
 * - Bold / italic / strikethrough / highlight render visually
 * - Links become clickable (when cursor is not on them)
 * - Images show inline previews
 * - Task list checkboxes are interactive
 * - Syntax markers (**, ~~, ==, etc.) hide when cursor is elsewhere
 *
 * Design principle: the line the cursor is on always shows raw Markdown,
 * all other lines show the rendered preview. This matches
 * Live Preview behavior.
 */

import {
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    WidgetType,
} from "@codemirror/view";
import {
    EditorSelection,
    Range,
    StateField,
    Transaction,
} from "@codemirror/state";
import katex from "katex";
import { URL_REGEX, trimTrailingPunct } from "../../../utils/autoLink";
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
import { t } from "../../../i18n";
import { livePreviewTheme } from "./livePreviewTheme";
import {
    applyFencedCodeSyntax,
    normalizeFenceLanguage,
    codeFenceOpenDeco,
    codeFenceCloseDeco,
    codeContentLineDeco,
} from "./codeSyntaxHighlighting";
import { ImageWidget, CheckboxWidget } from "./imageWidgets";
import { showImageContextMenu } from "../../../utils/imageInteraction";



/** Inline math widget rendered with KaTeX */
class InlineMathWidget extends WidgetType {
    constructor(private tex: string) {
        super();
    }

    toDOM(): HTMLElement {
        const span = document.createElement("span");
        span.className = "mz-lp-inline-math";
        try {
            katex.render(this.tex.trim(), span, {
                displayMode: false,
                throwOnError: false,
                output: "html",
                trust: true,
            });
        } catch {
            span.textContent = `$${this.tex}$`;
            span.style.color = "var(--mz-error)";
        }
        return span;
    }

    eq(other: InlineMathWidget): boolean {
        return this.tex === other.tex;
    }
}

// ---------------------------------------------------------------------------
// Decoration builders
// ---------------------------------------------------------------------------

/**
 * Hide syntax markers (**, __, ~~, ==, [, ](url), etc.) via a MARK
 * decoration with CSS that collapses them to zero visual width.
 *
 * Previous approach used `Decoration.replace({})` which REMOVED the
 * characters from the DOM entirely. That caused two problems:
 *   1. CM6's `posAtCoords` lost positional accuracy because the
 *      replaced range was an atomic gap in the DOM — clicks on styled
 *      text near a hidden marker would land on the wrong character.
 *   2. Arrow-key movement skipped over replaced ranges unpredictably.
 *
 * Mark decorations keep the characters IN the DOM (so CM6's character-
 * level position map stays complete) but make them visually invisible
 * via CSS. The key CSS trick is `font-size: 0` which collapses the
 * text node to zero width/height while CM6 still knows those positions
 * exist. This is the same approach  uses for marker hiding.
 */
const hideMarker = Decoration.mark({ class: "mz-lp-hidden" });

/**
 * Heading decorations applied at the LINE level (not as mark spans).
 *
 * Using `Decoration.line` to set the class on the line's wrapping div
 * lets CM6 correctly measure line heights via `lineBlockAt`. The old
 * `Decoration.mark` approach wrapped only the heading text in a span
 * with `font-size: 1.8em`, and CM6's cached line-block heights stayed
 * at the normal line height until a later measure cycle — so clicks
 * on a heading landed on the line BELOW it (the "click on H1, cursor
 * jumps down" bug the user kept reporting). Line decorations invalidate
 * CM6's height cache correctly.
 */
const headingLineDeco: Record<number, Decoration> = {
    1: Decoration.line({ class: "mz-lp-h1-line" }),
    2: Decoration.line({ class: "mz-lp-h2-line" }),
    3: Decoration.line({ class: "mz-lp-h3-line" }),
    4: Decoration.line({ class: "mz-lp-h4-line" }),
    5: Decoration.line({ class: "mz-lp-h5-line" }),
    6: Decoration.line({ class: "mz-lp-h6-line" }),
};

const boldDeco = Decoration.mark({ class: "mz-lp-bold" });
const italicDeco = Decoration.mark({ class: "mz-lp-italic" });
const strikethroughDeco = Decoration.mark({ class: "mz-lp-strikethrough" });
const highlightDeco = Decoration.mark({ class: "mz-lp-highlight" });
const inlineCodeDeco = Decoration.mark({ class: "mz-lp-inline-code" });
const linkDeco = Decoration.mark({ class: "mz-lp-link" });
// linkUrlDeco removed — link URLs are hidden in preview
// Blockquote + HR: same reasoning as headings — use line decorations so
// their padding / border changes invalidate CM6's height cache and
// clicks map to the correct source line.
const blockquoteLineDeco = Decoration.line({ class: "mz-lp-blockquote-line" });
const hrLineDeco = Decoration.line({ class: "mz-lp-hr-line" });

function eventTargetElement(target: EventTarget | null): Element | null {
    if (target instanceof Element) return target;
    return target instanceof Node ? target.parentElement : null;
}

function isUnorderedListLine(text: string): boolean {
    return /^\s*[-*+]\s+/.test(text);
}

function isFenceLine(text: string): boolean {
    return /^(`{3,}|~{3,})/.test(text);
}

function isHorizontalRuleLine(text: string): boolean {
    return /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(text);
}

function horizontalRuleCursorPos(line: { from: number; text: string }): number {
    const match = line.text.match(/^(\s{0,3})(-{3,}|\*{3,}|_{3,})/);
    if (!match) return line.from + line.text.length;
    return line.from + match[1].length + match[2].length;
}

function lineFromDomTarget(
    view: EditorView,
    target: EventTarget | null,
): {
    element: HTMLElement;
    line: ReturnType<typeof view.state.doc.line>;
} | null {
    const lineElement = eventTargetElement(target)?.closest(".cm-line");
    if (
        !(lineElement instanceof HTMLElement) ||
        !view.dom.contains(lineElement)
    ) {
        return null;
    }

    try {
        return {
            element: lineElement,
            line: view.state.doc.lineAt(view.posAtDOM(lineElement, 0)),
        };
    } catch {
        return null;
    }
}

function visibleTextRight(element: HTMLElement): number | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let maxRight: number | null = null;
    let node: Node | null;

    while ((node = walker.nextNode())) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
            if (rect.width > 0.5) {
                maxRight =
                    maxRight === null
                        ? rect.right
                        : Math.max(maxRight, rect.right);
            }
        }
        range.detach();
    }

    return maxRight;
}

function domCaretPositionFromPoint(
    view: EditorView,
    event: MouseEvent,
): number | null {
    try {
        const caretPosition = document.caretPositionFromPoint?.(
            event.clientX,
            event.clientY,
        );
        if (caretPosition) {
            return view.posAtDOM(
                caretPosition.offsetNode,
                caretPosition.offset,
            );
        }

        const legacyDocument = document as Document & {
            caretRangeFromPoint?: (
                x: number,
                y: number,
            ) => globalThis.Range | null;
        };
        const caretRange = legacyDocument.caretRangeFromPoint?.(
            event.clientX,
            event.clientY,
        );
        if (caretRange) {
            return view.posAtDOM(
                caretRange.startContainer,
                caretRange.startOffset,
            );
        }
    } catch {
        return null;
    }

    return null;
}

function clampToLine(pos: number, line: { from: number; to: number }): number {
    return Math.min(line.to, Math.max(line.from, pos));
}

const listLineBoundaryClickHandler = EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
        if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
        ) {
            return false;
        }

        const domLine = lineFromDomTarget(view, event.target);
        if (!domLine || !isUnorderedListLine(domLine.line.text)) return false;

        const nextLine =
            domLine.line.number < view.state.doc.lines
                ? view.state.doc.line(domLine.line.number + 1)
                : null;
        const needsBoundaryCorrection =
            domLine.line.text.includes("[[") ||
            (nextLine !== null && isFenceLine(nextLine.text));
        if (!needsBoundaryCorrection) return false;

        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;

        const mappedLine = view.state.doc.lineAt(pos);
        if (mappedLine.number === domLine.line.number) return false;

        const caretPos = domCaretPositionFromPoint(view, event);
        const textRight = visibleTextRight(domLine.element);
        const targetPos =
            caretPos !== null &&
            caretPos >= domLine.line.from &&
            caretPos <= domLine.line.to
                ? caretPos
                : textRight !== null && event.clientX >= textRight - 1
                  ? domLine.line.to
                  : clampToLine(pos, domLine.line);

        event.preventDefault();
        view.dispatch({
            selection: EditorSelection.cursor(targetPos),
            scrollIntoView: true,
        });
        view.focus();
        return true;
    },
});

const horizontalRuleClickHandler = EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
        if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
        ) {
            return false;
        }

        const domLine = lineFromDomTarget(view, event.target);
        if (!domLine || !isHorizontalRuleLine(domLine.line.text)) return false;

        event.preventDefault();
        view.dispatch({
            selection: EditorSelection.cursor(
                horizontalRuleCursorPos(domLine.line),
            ),
            scrollIntoView: true,
        });
        view.focus();
        return true;
    },
});

const tableHeaderDeco = Decoration.line({ class: "mz-lp-table-header-line" });
const tableSepDeco = Decoration.line({ class: "mz-lp-table-separator-line" });
const tableRowDeco = Decoration.line({ class: "mz-lp-table-row-line" });

function horizontalRuleActiveLine(
    state: import("@codemirror/state").EditorState,
) {
    return state.doc.lineAt(state.selection.main.head).number;
}

const tagDeco = Decoration.mark({ class: "mz-lp-tag" });
const footnoteDeco = Decoration.mark({ class: "mz-lp-footnote" });
// Highlights the raw `[ ]` / `[x]` task brackets on the cursor line where the
// checkbox widget is not shown — without this they're rendered in the muted
// comment color and are almost invisible in the dark theme.
const taskMarkerDeco = Decoration.mark({ class: "mz-lp-task-marker" });
// Styling for the `](url)` portion of markdown links on the cursor line.
// Without an explicit rule this tail falls through to the muted comment
// colour and is hard to read — especially for anchor links like
// `](#section-name)` which hold actual readable content.
const linkUrlTailDeco = Decoration.mark({ class: "mz-lp-link-url-tail" });


// ---------------------------------------------------------------------------
// Core logic: build decorations from document content
// ---------------------------------------------------------------------------

function buildDecorations(
    view: EditorView,
    vaultRoot: string,
    currentFilePath: string,
): DecorationSet {
    try {
        return buildDecorationsImpl(view, vaultRoot, currentFilePath);
    } catch (err) {
        // A single bad decoration would otherwise throw from Decoration.set
        // and take down the live-preview plugin, leaving the editor blank.
        console.error("[live-preview] buildDecorations failed:", err);
        return Decoration.none;
    }
}

function buildDecorationsImpl(
    view: EditorView,
    vaultRoot: string,
    currentFilePath: string,
): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    const doc = view.state.doc;
    const activeHorizontalRuleLine = horizontalRuleActiveLine(view.state);
    // No block widgets — line decorations in buildLineDecorations handle
    // the visual rendering of code fences and tables while keeping every
    // character cursor-addressable. Here we only need to skip inline
    // formatting inside fenced code blocks and table rows.
    const tableSepRe = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
    const isTableRow = (t: string) =>
        t.trim().startsWith("|") && t.indexOf("|", t.indexOf("|") + 1) !== -1;
    let inFence = false;
    let activeFence = "";
    let activeFenceLang = "";

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;
        const isCurrentLine = i === activeHorizontalRuleLine;

        // Skip empty lines
        if (!text.trim()) continue;

        const fenceMatch = text.match(/^(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            if (!inFence) {
                inFence = true;
                activeFence = fenceMatch[1][0];
                activeFenceLang = normalizeFenceLanguage(fenceMatch[2] ?? "");
            } else if (text.startsWith(activeFence.repeat(3))) {
                inFence = false;
                activeFence = "";
                activeFenceLang = "";
            }
            continue;
        }
        if (inFence) {
            applyFencedCodeSyntax(text, line.from, activeFenceLang, decorations);
            continue;
        }

        // --- Headings ---
        // NOTE: the line-level heading class (mz-lp-h{level}-line) is
        // attached by `lineDecorationField` — a StateField — not here.
        // The ViewPlugin path runs after viewport layout and its line
        // decorations wouldn't invalidate CM6's height cache, which
        // caused the click-on-heading-lands-below bug. Here we only
        // hide the `### ` markers on non-cursor lines.
        const headingMatch = text.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const markerEnd = line.from + headingMatch[1].length + 1; // include space
            if (!isCurrentLine) {
                decorations.push(hideMarker.range(line.from, markerEnd));
            }
            continue; // Headings don't contain other inline syntax in this pass
        }

        // --- Horizontal rule ---
        //
        // Must run before table separator detection. A bare `---`
        // also matches the table separator regex, while `***` does
        // not. Checking tables first is exactly what made dash rules
        // leak their raw marker while asterisk rules looked correct.
        // Line class is supplied by lineDecorationField. Here we just
        // hide the raw marker on every non-cursor line. This keeps
        // `---` and `***` identical once the caret leaves the line.
        if (isHorizontalRuleLine(text)) {
            if (!isCurrentLine) {
                decorations.push(hideMarker.range(line.from, line.to));
            }
            continue;
        }

        if (isTableRow(text) || tableSepRe.test(text)) continue;

        // --- Blockquote ---
        // Line class is supplied by lineDecorationField. Here we just
        // hide the `> ` marker on non-cursor lines.
        if (text.startsWith("> ")) {
            if (!isCurrentLine) {
                decorations.push(hideMarker.range(line.from, line.from + 2));
            }
        }

        // --- Task list checkboxes ---
        const taskMatch = text.match(/^(\s*)-\s+\[([ xX])\]\s/);
        if (taskMatch) {
            // Always style the "[ ]" / "[x]" brackets so they're readable on
            // the cursor line too (where the widget replacement is skipped).
            const bracketStart = line.from + taskMatch[1].length + 2; // after "- "
            const bracketEnd = bracketStart + 3; // "[x]" or "[ ]"
            decorations.push(taskMarkerDeco.range(bracketStart, bracketEnd));
        }
        const orderedMatch = text.match(/^(\s*)(\d+\.)\s/);
        if (orderedMatch) {
            const markerStart = line.from + orderedMatch[1].length;
            const markerEnd = markerStart + orderedMatch[2].length;
            decorations.push(orderedMarkerDeco.range(markerStart, markerEnd));
        }
        if (taskMatch && !isCurrentLine) {
            const checkStart = line.from + taskMatch[1].length;
            const checkEnd =
                checkStart + taskMatch[0].length - taskMatch[1].length;
            const isChecked = taskMatch[2] !== " ";

            // Replace "- [x] " with checkbox widget
            decorations.push(
                Decoration.replace({
                    widget: new CheckboxWidget(isChecked),
                }).range(checkStart, checkEnd),
            );
        } else if (!taskMatch && !isCurrentLine) {
            // --- Unordered list bullet (plain, not a task item) ---
            // Replace the `-`, `*`, or `+` marker with a round bullet.
            // Leading whitespace (tabs) is kept — it provides the natural
            // indentation.
            const bulletMatch = text.match(/^(\s*)([-*+])(\s)/);
            if (bulletMatch) {
                const markerStart = line.from + bulletMatch[1].length;
                const markerEnd = markerStart + 1;
                decorations.push(
                    Decoration.replace({ widget: bulletWidget }).range(
                        markerStart,
                        markerEnd,
                    ),
                );
            }
        }

        const listInfo = getContinuationInfo(text);
        if (listInfo && listInfo.kind !== "blockquote") {
            const contentStart =
                line.from + listInfo.rawIndent.length + listInfo.marker.length;
            if (contentStart < line.to) {
                decorations.push(listContentDeco.range(contentStart, line.to));
            }
        }

        // --- Inline formatting (only apply when cursor is not on this line) ---
        if (!isCurrentLine) {
            // Bold: exactly two asterisks only. Triple asterisks stay plain.
            applyInlineFormat(
                text,
                line.from,
                /(?<!\*)\*\*(?!\*)(.+?)(?<!\*)\*\*(?!\*)/g,
                2,
                2,
                boldDeco,
                decorations,
            );

            // Italic: exactly one asterisk only. Avoid list markers and bold.
            applyInlineFormat(
                text,
                line.from,
                /(?<!\*)\*(?![\s*])(.+?)(?<![\s*])\*(?!\*)/g,
                1,
                1,
                italicDeco,
                decorations,
            );

            // Strikethrough: ~~text~~
            applyInlineFormat(
                text,
                line.from,
                /~~(.+?)~~/g,
                2,
                2,
                strikethroughDeco,
                decorations,
            );

            // Highlight: ==text==
            applyInlineFormat(
                text,
                line.from,
                /==(.+?)==/g,
                2,
                2,
                highlightDeco,
                decorations,
            );

            // Inline code: `text`
            applyInlineFormat(
                text,
                line.from,
                /(?<!`)`(?!`)(.+?)(?<!`)`(?!`)/g,
                1,
                1,
                inlineCodeDeco,
                decorations,
            );

            // Markdown links: [text](url) — not images
            const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
            let linkMatch;
            while ((linkMatch = linkRegex.exec(text)) !== null) {
                const fullStart = line.from + linkMatch.index;
                const fullEnd = fullStart + linkMatch[0].length;
                const textStart = fullStart + 1;
                const textEnd = textStart + linkMatch[1].length;
                // Hide [ and ](url)
                decorations.push(hideMarker.range(fullStart, textStart)); // [
                decorations.push(hideMarker.range(textEnd, fullEnd)); // ](url)
                // Style the link text
                decorations.push(linkDeco.range(textStart, textEnd));
            }

            // Wiki links: [[target]] or [[target|display]]
            const wikiRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
            let wikiMatch;
            while ((wikiMatch = wikiRegex.exec(text)) !== null) {
                const fullStart = line.from + wikiMatch.index;
                const fullEnd = fullStart + wikiMatch[0].length;
                const displayStart = wikiMatch[2]
                    ? fullStart + 2 + wikiMatch[1].length + 1
                    : fullStart + 2;
                const displayEnd = fullEnd - 2;

                // Hide [[ and ]] (and target| if display text exists)
                if (wikiMatch[2]) {
                    decorations.push(hideMarker.range(fullStart, displayStart)); // [[target|
                    decorations.push(hideMarker.range(displayEnd, fullEnd)); // ]]
                } else {
                    decorations.push(
                        hideMarker.range(fullStart, fullStart + 2),
                    ); // [[
                    decorations.push(hideMarker.range(fullEnd - 2, fullEnd)); // ]]
                }
                decorations.push(linkDeco.range(displayStart, displayEnd));
            }

            // Auto-linked bare URLs (github.com/foo, https://…). Gated
            // on the `auto_link_urls` setting so users can opt out
            // and get unstyled plain text. We skip matches that fall
            // inside one of the already-decorated `[text](url)` or
            // `[[wiki]]` link spans — those are handled above and
            // double-decorating them visually clashes with the
            // existing link styling.
            if (settingsStore.settings().auto_link_urls) {
                const occupied: { from: number; to: number }[] = [];
                let lm: RegExpExecArray | null;
                const mdLinkRe = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
                while ((lm = mdLinkRe.exec(text)) !== null) {
                    occupied.push({
                        from: line.from + lm.index,
                        to: line.from + lm.index + lm[0].length,
                    });
                }
                const wikiRe2 = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
                while ((lm = wikiRe2.exec(text)) !== null) {
                    occupied.push({
                        from: line.from + lm.index,
                        to: line.from + lm.index + lm[0].length,
                    });
                }

                URL_REGEX.lastIndex = 0;
                let urlMatch: RegExpExecArray | null;
                while ((urlMatch = URL_REGEX.exec(text)) !== null) {
                    const trimmed = trimTrailingPunct(urlMatch[0]);
                    if (!trimmed) continue;
                    const start = line.from + urlMatch.index;
                    const end = start + trimmed.length;
                    const overlapsLink = occupied.some(
                        (r) => start < r.to && end > r.from,
                    );
                    if (overlapsLink) continue;
                    decorations.push(linkDeco.range(start, end));
                }
            }

            // Inline math: $...$ (not $$)
            const mathRegex = /(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g;
            let mathMatch;
            while ((mathMatch = mathRegex.exec(text)) !== null) {
                const start = line.from + mathMatch.index;
                const end = start + mathMatch[0].length;
                const tex = mathMatch[1];
                decorations.push(
                    Decoration.replace({
                        widget: new InlineMathWidget(tex),
                    }).range(start, end),
                );
            }

            // Tags: #tag (but not inside code or links)
            const tagRegex =
                /(?<=\s|^)#([a-zA-Z\u4e00-\u9fff][\w\u4e00-\u9fff/\-]*)/g;
            let tagMatch;
            while ((tagMatch = tagRegex.exec(text)) !== null) {
                const start = line.from + tagMatch.index;
                const end = start + tagMatch[0].length;
                decorations.push(tagDeco.range(start, end));
            }

            // Footnote references: [^id]
            const fnRegex = /\[\^([^\]]+)\]/g;
            let fnMatch;
            while ((fnMatch = fnRegex.exec(text)) !== null) {
                // Skip footnote definitions at start of line
                if (
                    fnMatch.index === 0 &&
                    text.startsWith("[^") &&
                    text.includes("]:")
                )
                    continue;
                const start = line.from + fnMatch.index;
                const end = start + fnMatch[0].length;
                decorations.push(footnoteDeco.range(start, end));
            }
        }

        // Images: ![alt](src)
        //
        // OUTSIDE the `if (!isCurrentLine)` guard so images are
        // ALWAYS visible regardless of cursor position.
        //
        // Strategy:
        //  - An INLINE widget (side: 1) after the `![alt](src)`
        //    text renders the image. It's "inline" from CM6's
        //    perspective (ViewPlugin can't provide block widgets),
        //    but ImageWidget's toDOM() returns a `<div>` which
        //    the browser renders on its own line — giving us
        //    block-like visual behavior without triggering CM6's
        //    "Block decorations may not be specified via plugins"
        //    restriction.
        //  - On NON-CURSOR lines: the raw `![alt](src)` text is
        //    hidden via `hideMarker` (fontSize:0 + transparent).
        //    Only the image shows.
        //  - On the CURSOR LINE: the raw text stays visible so
        //    the user can edit the link/alt. The image stays
        //    below it.
        {
            const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
            let imgMatch;
            while ((imgMatch = imgRegex.exec(text)) !== null) {
                const start = line.from + imgMatch.index;
                const end = start + imgMatch[0].length;
                const alt = imgMatch[1];
                const src = imgMatch[2];
                // Always show image (inline widget after the text)
                decorations.push(
                    Decoration.widget({
                        widget: new ImageWidget(
                            src,
                            alt,
                            vaultRoot,
                            currentFilePath,
                        ),
                        side: 1,
                    }).range(end),
                );
                // Hide the raw markdown text on non-cursor lines
                if (!isCurrentLine) {
                    decorations.push(hideMarker.range(start, end));
                }
            }
        }

        // Cursor-line readability: on the active line we keep raw markdown
        // visible, but the `](url)` tail of a link defaults to a dim colour.
        // Mark it with a brighter class so anchors like `](#section)` stay
        // legible while the user is editing.
        if (isCurrentLine) {
            const linkRegexC = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
            let lmC;
            while ((lmC = linkRegexC.exec(text)) !== null) {
                const tailStart = line.from + lmC.index + 1 + lmC[1].length;
                const tailEnd = line.from + lmC.index + lmC[0].length;
                if (tailStart < tailEnd) {
                    decorations.push(linkUrlTailDeco.range(tailStart, tailEnd));
                }
            }
        }
    }

    // Sort decorations by position (required by CM6)
    decorations.sort(
        (a, b) => a.from - b.from || a.value.startSide - b.value.startSide,
    );

    // Remove overlapping decorations (CM6 doesn't allow overlaps for replace decorations)
    const filtered = removeOverlaps(decorations);

    return Decoration.set(filtered);
}

/** Apply a regex-based inline format, hiding markers and styling content */
function applyInlineFormat(
    text: string,
    lineFrom: number,
    regex: RegExp,
    markerLenBefore: number,
    markerLenAfter: number,
    deco: Decoration,
    decorations: Range<Decoration>[],
) {
    let match;
    while ((match = regex.exec(text)) !== null) {
        const start = lineFrom + match.index;
        const end = start + match[0].length;
        const contentStart = start + markerLenBefore;
        const contentEnd = end - markerLenAfter;

        if (contentStart >= contentEnd) continue;

        // Hide opening marker
        decorations.push(hideMarker.range(start, contentStart));
        // Hide closing marker
        decorations.push(hideMarker.range(contentEnd, end));
        // Apply style to content
        decorations.push(deco.range(contentStart, contentEnd));
    }
}

/**
 * Drop decorations that would form invalid overlaps for CM6.
 *
 * CM6 rules (only the ones we care about here):
 * - Mark decorations can freely overlap each other (they nest into `<span>`s).
 * - Two REPLACE decorations on the same span are rejected by CM6.
 *
 * The previous implementation dropped any pair of overlapping decorations,
 * which silently erased legitimate styling — for example the `> ` hide marker
 * on a blockquote line that overlaps the full-line blockquote mark. That made
 * large chunks of a note disappear because the marker-hiding decorations got
 * thrown away along with their styling partners. Here we only suppress later
 * decorations that would collide with an ALREADY-ACCEPTED replace range.
 */
function removeOverlaps(decos: Range<Decoration>[]): Range<Decoration>[] {
    if (decos.length === 0) return decos;

    // A PointDecoration (widget / replace) has `point === true` on its value.
    // A MarkDecoration has `point === false`. A replace decoration, unlike a
    // plain widget, has `from < to`, so we use that to distinguish them.
    const isReplaceRange = (r: Range<Decoration>): boolean =>
        (r.value as any).point === true && r.from < r.to;

    const result: Range<Decoration>[] = [];
    const claimedReplaces: Array<[number, number]> = [];

    for (const curr of decos) {
        let conflict = false;
        for (const [cf, ct] of claimedReplaces) {
            if (curr.from < ct && curr.to > cf) {
                conflict = true;
                break;
            }
        }
        if (conflict) continue;
        result.push(curr);
        if (isReplaceRange(curr)) {
            claimedReplaces.push([curr.from, curr.to]);
        }
    }
    return result;
}


// ---------------------------------------------------------------------------
// Line decorations (headings / blockquote / hr) via a StateField
// ---------------------------------------------------------------------------
//
// CRITICAL: line-level decorations that change font-size or padding affect
// CM6's vertical layout. Per the `EditorView.decorations` facet docs:
//
//   > Only decoration sets provided directly are allowed to influence the
//   > editor's vertical layout structure. The ones provided as functions
//   > are called _after_ the new viewport has been computed […]
//
// A `ViewPlugin.decorations` source is the "provided as function" path,
// so line decorations from a ViewPlugin end up in CM6's layout AFTER
// heights are measured. That staleness is exactly why clicking on a
// heading / blockquote / hr line kept landing on the line BELOW — CM6
// was using the pre-decoration line height for `posAtCoords`.
//
// A StateField instead feeds into `EditorView.decorations` directly via
// `provide: f => EditorView.decorations.from(f)`, runs during state
// updates (not after layout), and IS allowed to affect vertical layout.
// We keep inline/mark decorations in the ViewPlugin below (they don't
// change heights) for performance — only layout-affecting decorations
// need to go through the StateField path.

/**
 * Build JUST the line-level decorations (point decorations attached to
 * `line.from` that add a class to the `<div class="cm-line">` wrapper).
 * These are the ones that change height.
 */
/**
 * Build line-level decorations for the "visual preview" rendering of
 * the raw source. Every line of the document is classified and tagged
 * with a CSS class on its `.cm-line` wrapper. The CSS in
 * `livePreviewTheme` then styles each class so the raw source
 * LOOKS like a rendered preview while every character remains a real
 * cursor position (arrow keys move one line at a time, clicks land
 * on the exact character).
 */
function buildLineDecorations(
    state: import("@codemirror/state").EditorState,
): DecorationSet {
    const doc = state.doc;
    const decos: Range<Decoration>[] = [];
    // No block-widget exclusion — every line is styled via line
    // decorations so raw source LOOKS like rendered blocks while
    // every character stays a real cursor position.
    const tableSepRe = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
    const isTableRow = (t: string) =>
        t.trim().startsWith("|") && t.indexOf("|", t.indexOf("|") + 1) !== -1;

    let inFence = false;
    let fenceChar = "";
    let fenceLineNumber = 0;

    for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        const text = line.text;

        // --- Fenced code block ---
        // Detect opening/closing fences and tag every line with a CSS
        // class so code blocks render with monospace font, background,
        // and border while keeping every character cursor-addressable.
        const fenceMatch = text.match(/^(`{3,}|~{3,})/);
        if (fenceMatch) {
            if (!inFence) {
                // Opening fence
                inFence = true;
                fenceChar = fenceMatch[1][0];
                fenceLineNumber = 0;
                decos.push(codeFenceOpenDeco.range(line.from));
            } else if (text.startsWith(fenceChar.repeat(3))) {
                // Closing fence
                inFence = false;
                fenceChar = "";
                fenceLineNumber = 0;
                decos.push(codeFenceCloseDeco.range(line.from));
            } else {
                // Fence-like line inside a different fence type — treat as content
                fenceLineNumber += 1;
                decos.push(
                    codeContentLineDeco(fenceLineNumber).range(line.from),
                );
            }
            continue;
        }
        if (inFence) {
            fenceLineNumber += 1;
            decos.push(codeContentLineDeco(fenceLineNumber).range(line.from));
            continue;
        }

        // --- Heading ---
        const headingMatch = text.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            if (headingLineDeco[level]) {
                decos.push(headingLineDeco[level].range(line.from));
            }
            continue;
        }

        // --- Horizontal rule ---
        if (isHorizontalRuleLine(text)) {
            decos.push(hrLineDeco.range(line.from));
            continue;
        }

        // --- Blockquote ---
        if (text.startsWith("> ")) {
            decos.push(blockquoteLineDeco.range(line.from));
        }

        // --- List lines ---
        {
            const listInfo = getContinuationInfo(text);
            if (listInfo && listInfo.kind !== "blockquote") {
                decos.push(
                    listWrapDeco(listInfo.level, listInfo.marker.length).range(
                        line.from,
                    ),
                );
                if (listInfo.level > 0) {
                    decos.push(listGuideDeco(listInfo.level).range(line.from));
                }
            }
        }

        if (isTableRow(text)) {
            if (tableSepRe.test(text)) {
                decos.push(tableSepDeco.range(line.from));
            } else if (
                i + 1 <= doc.lines &&
                tableSepRe.test(doc.line(i + 1).text)
            ) {
                decos.push(tableHeaderDeco.range(line.from));
            } else {
                // Body row — only decorate if a separator exists above
                let j = i - 1;
                let inTable = false;
                while (j >= 1) {
                    const pt = doc.line(j).text;
                    if (tableSepRe.test(pt)) {
                        inTable = true;
                        break;
                    }
                    if (!isTableRow(pt)) break;
                    j--;
                }
                if (inTable) decos.push(tableRowDeco.range(line.from));
            }
            continue;
        }
    }
    return Decoration.set(decos);
}

const lineDecorationField = StateField.define<DecorationSet>({
    create(state) {
        return buildLineDecorations(state);
    },
    update(deco, tr: Transaction) {
        const beforeLine = tr.startState.doc.lineAt(
            tr.startState.selection.main.head,
        ).number;
        const afterLine = tr.state.doc.lineAt(
            tr.state.selection.main.head,
        ).number;
        // Keep this mapped on cursor moves so CM6 refreshes the
        // horizontal-rule line class together with inline marker hiding.
        if (tr.docChanged || beforeLine !== afterLine) {
            return buildLineDecorations(tr.state);
        }
        return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
});

// (forceMeasurePlugin removed — once block-widget `estimatedHeight`
// returns -1, CM6 measures actual DOM heights on render and HeightMap
// stays accurate without any manual measure-request nagging.)

// ---------------------------------------------------------------------------
// ViewPlugin: inline/mark decorations only (bold, italic, hide markers, etc.)
// ---------------------------------------------------------------------------

function createLivePreviewPlugin(vaultRoot: string, currentFilePath: string) {
    function cursorLineChanged(update: ViewUpdate): boolean {
        if (!update.selectionSet) return false;
        const before = update.startState.doc.lineAt(
            update.startState.selection.main.head,
        ).number;
        const after = update.state.doc.lineAt(
            update.state.selection.main.head,
        ).number;
        return before !== after;
    }

    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            resizeObserver: ResizeObserver | null = null;

            constructor(view: EditorView) {
                syncListGuideMetrics(view);
                this.decorations = buildDecorations(
                    view,
                    vaultRoot,
                    currentFilePath,
                );

                if (typeof ResizeObserver !== "undefined") {
                    this.resizeObserver = new ResizeObserver(() => {
                        syncListGuideMetrics(view);
                    });
                    this.resizeObserver.observe(view.dom);
                }
            }

            update(update: ViewUpdate) {
                if (update.geometryChanged) {
                    syncListGuideMetrics(update.view);
                }
                // Rebuild inline decorations only when the document
                // changes or the cursor head crosses into another line.
                // Ctrl+F can trigger viewport/focus updates while opening
                // its panel; those must not rescan every line in large
                // split panes.
                if (update.docChanged || cursorLineChanged(update)) {
                    this.decorations = buildDecorations(
                        update.view,
                        vaultRoot,
                        currentFilePath,
                    );
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

/**
 * Create the complete Live Preview extension bundle.
 *
 * Order matters:
 *   1. `livePreviewTheme` — base theme styles.
 *   2. `lineDecorationField` — StateField that owns line-level
 *      decorations (headings/blockquote/hr). MUST come through a
 *      StateField so CM6 can use it for vertical layout (see the
 *      long comment above `buildLineDecorations`).
 *   3. `createLivePreviewPlugin(vaultRoot)` — ViewPlugin that owns
 *      inline/mark/replace decorations (bold, italic, hide markers,
 *      links, etc.). These don't change line heights so they're safe
 *      to compute in the faster viewport-triggered path.
 *
 * @param vaultRoot - Absolute path to the vault root (for resolving image paths)
 * @returns Array of CM6 extensions to add to the editor
 */
export function livePreviewExtension(
    vaultRoot: string,
    currentFilePath: string,
) {
    return [
        listSharedTheme,
        livePreviewTheme,
        listLineBoundaryClickHandler,
        horizontalRuleClickHandler,
        lineDecorationField,
        createLivePreviewPlugin(vaultRoot, currentFilePath),
    ];
}
