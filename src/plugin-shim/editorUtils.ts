import type { EditorView } from "@codemirror/view";

/**
 * Convert an Obsidian-style {line, ch} position to a CodeMirror 6 document
 * offset.  Lines are 0-indexed (Obsidian convention).  Out-of-range values are
 * clamped to valid bounds.
 */
export function posToOffset(
    view: EditorView,
    pos: { line: number; ch: number },
): number {
    const lineNum = Math.max(1, Math.min(view.state.doc.lines, pos.line + 1));
    const line = view.state.doc.line(lineNum);
    return Math.min(line.to, line.from + Math.max(0, pos.ch));
}

/**
 * Convert a CodeMirror 6 document offset to an Obsidian-style {line, ch}
 * position.  Lines are 0-indexed (Obsidian convention).  Out-of-range offsets
 * are clamped to valid bounds.
 */
export function offsetToPos(
    view: EditorView,
    offset: number,
): { line: number; ch: number } {
    const clamped = Math.max(0, Math.min(view.state.doc.length, offset));
    const line = view.state.doc.lineAt(clamped);
    return { line: line.number - 1, ch: Math.max(0, clamped - line.from) };
}
