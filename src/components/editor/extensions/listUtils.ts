export const LIST_INDENT_UNIT = "\t";
export const LIST_INDENT_WIDTH = 4;
export const LIST_RENDER_TAB_SIZE = 5;
export const LIST_INDENT_EXTRA_PX = 4;
export const DEFAULT_CHILD_LIST_MARKER = "- ";

export type ContinuationKind =
    | "task"
    | "unordered"
    | "ordered"
    | "blockquote";

export interface ContinuationInfo {
    kind: ContinuationKind;
    rawIndent: string;
    indent: string;
    level: number;
    marker: string;
    continuation: string;
}

interface ContinuationPattern {
    kind: ContinuationKind;
    pattern: RegExp;
    emptyPattern: RegExp;
    marker: (match: RegExpMatchArray) => string;
    continuation: (match: RegExpMatchArray) => string;
}

const CONTINUATION_PATTERNS: ContinuationPattern[] = [
    {
        kind: "task",
        pattern: /^(\s*)- \[([ xX])\]\s/,
        emptyPattern: /^(\s*)- \[([ xX])\]\s*$/,
        marker: (match) => `- [${match[2]}] `,
        continuation: () => "- [ ] ",
    },
    {
        kind: "unordered",
        pattern: /^(\s*)([-*+])\s/,
        emptyPattern: /^(\s*)([-*+])\s*$/,
        marker: (match) => `${match[2]} `,
        continuation: (match) => `${match[2]} `,
    },
    {
        kind: "ordered",
        pattern: /^(\s*)(\d+)(\.)\s/,
        emptyPattern: /^(\s*)(\d+)(\.)\s*$/,
        marker: (match) => `${match[2]}${match[3]} `,
        continuation: (match) => `${Number.parseInt(match[2], 10) + 1}${match[3]} `,
    },
    {
        kind: "blockquote",
        pattern: /^(\s*)(>)\s/,
        emptyPattern: /^(\s*)(>)\s*$/,
        marker: (match) => `${match[2]} `,
        continuation: () => "> ",
    },
];

function matchContinuation(
    text: string,
    mode: "content" | "empty",
): ContinuationInfo | null {
    for (const pattern of CONTINUATION_PATTERNS) {
        const match = text.match(
            mode === "empty" ? pattern.emptyPattern : pattern.pattern,
        );
        if (!match) continue;

        const rawIndent = match[1] ?? "";
        const indent = normalizeIndent(rawIndent);
        return {
            kind: pattern.kind,
            rawIndent,
            indent,
            level: indent.length,
            marker: pattern.marker(match),
            continuation: pattern.continuation(match),
        };
    }
    return null;
}

export function measureIndentColumns(whitespace: string): number {
    let columns = 0;
    for (const char of whitespace) {
        columns += char === "\t" ? LIST_INDENT_WIDTH : 1;
    }
    return columns;
}

export function indentLevelFromWhitespace(whitespace: string): number {
    return Math.floor(measureIndentColumns(whitespace) / LIST_INDENT_WIDTH);
}

export function normalizeIndent(whitespace: string): string {
    return LIST_INDENT_UNIT.repeat(indentLevelFromWhitespace(whitespace));
}

export function buildIndentFromColumns(columns: number): string {
    const normalizedColumns = Math.max(0, columns);
    const fullLevels = Math.floor(normalizedColumns / LIST_INDENT_WIDTH);
    const extraSpaces = normalizedColumns % LIST_INDENT_WIDTH;
    return `${LIST_INDENT_UNIT.repeat(fullLevels)}${" ".repeat(extraSpaces)}`;
}

export function getContinuationInfo(text: string): ContinuationInfo | null {
    return matchContinuation(text, "content");
}

export function getEmptyContinuationInfo(text: string): ContinuationInfo | null {
    return matchContinuation(text, "empty");
}

export function isListItemLine(text: string): boolean {
    const info = getContinuationInfo(text);
    return info !== null && info.kind !== "blockquote";
}

// ---------------------------------------------------------------------------
// Shared list-styling primitives
//
// Used by both livePreview.ts (live-preview mode) and listStyleExtension.ts
// (source mode). Extracted here to avoid duplication.
// ---------------------------------------------------------------------------

import {
    Decoration,
    EditorView,
    WidgetType,
} from "@codemirror/view";

/**
 * Inline widget that replaces the raw `-` / `*` / `+` marker with
 * a round bullet. Inline (non-block) replace, so CM6 doesn't treat it
 * as atomic — arrow keys can move normally through the line.
 */
export class BulletWidget extends WidgetType {
    toDOM(): HTMLElement {
        const anchor = document.createElement("span");
        anchor.className = "mz-lp-bullet-anchor";
        const dot = document.createElement("span");
        dot.className = "mz-lp-bullet";
        anchor.appendChild(dot);
        return anchor;
    }
    eq(): boolean {
        return true;
    }
}
export const bulletWidget = new BulletWidget();

// ---------------------------------------------------------------------------
// Decoration factories
// ---------------------------------------------------------------------------

export const orderedMarkerDeco = Decoration.mark({ class: "mz-lp-ordered-marker" });
export const listContentDeco = Decoration.mark({ class: "mz-lp-list-content" });

export function listGuideDeco(level: number): Decoration {
    return Decoration.line({
        class: "mz-lp-list-guides",
        attributes: {
            style: `--mz-list-level: ${level};`,
        },
    });
}

export function listWrapDeco(level: number, markerChars: number): Decoration {
    return Decoration.line({
        class: "mz-list-wrap-line",
        attributes: {
            style: `--mz-list-wrap-tabs: ${level}; --mz-list-wrap-marker: ${markerChars};`,
        },
    });
}

// ---------------------------------------------------------------------------
// Indent measurement
// ---------------------------------------------------------------------------

export function measureListIndentWidth(view: EditorView): number {
    if (typeof document === "undefined") {
        return LIST_INDENT_WIDTH * 8 + LIST_INDENT_EXTRA_PX;
    }

    const probe = document.createElement("span");
    probe.textContent = "\t";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.whiteSpace = "pre";
    probe.style.padding = "0";
    probe.style.margin = "0";
    probe.style.border = "0";
    probe.style.font = getComputedStyle(view.contentDOM).font;
    probe.style.tabSize = `${LIST_RENDER_TAB_SIZE}`;
    probe.style.setProperty("-moz-tab-size", `${LIST_RENDER_TAB_SIZE}`);
    view.contentDOM.appendChild(probe);
    const measured = probe.getBoundingClientRect().width;
    probe.remove();
    if (Number.isFinite(measured) && measured > 0) {
        return measured + LIST_INDENT_EXTRA_PX;
    }

    return (
        Math.max(1, view.defaultCharacterWidth) * LIST_INDENT_WIDTH +
        LIST_INDENT_EXTRA_PX
    );
}

export function syncListGuideMetrics(view: EditorView): void {
    const rawIndentWidth = Math.max(40, Math.round(measureListIndentWidth(view)));
    const indentWidth = rawIndentWidth % 2 === 0 ? rawIndentWidth : rawIndentWidth + 1;
    const guideOffset = Math.max(1, indentWidth / 2);
    view.contentDOM.style.setProperty("tab-size", `${indentWidth}px`);
    view.contentDOM.style.setProperty("-moz-tab-size", `${indentWidth}px`);
    view.contentDOM.style.setProperty("--mz-list-indent-step", `${indentWidth}px`);
    view.contentDOM.style.setProperty(
        "--mz-list-guide-offset",
        `${guideOffset}px`,
    );
}

// ---------------------------------------------------------------------------
// Shared base theme — bullet + ordered-marker CSS
// ---------------------------------------------------------------------------

export const listSharedTheme = EditorView.baseTheme({
    ".mz-lp-bullet-anchor": {
        display: "inline-block",
        width: "1ch",
        height: "1em",
        position: "relative",
        verticalAlign: "middle",
    },
    ".mz-lp-bullet": {
        position: "absolute",
        left: "0.5ch",
        top: "50%",
        width: "0.3em",
        height: "0.3em",
        borderRadius: "999px",
        background: "var(--mz-text-muted)",
        transform: "translate(-50%, -50%)",
        pointerEvents: "none",
    },
    ".mz-lp-ordered-marker": {
        color: "var(--mz-text-muted)",
    },
});