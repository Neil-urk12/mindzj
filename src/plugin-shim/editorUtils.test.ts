import { describe, expect, it } from "vitest";
import { posToOffset, offsetToPos } from "./editorUtils";

// ---------------------------------------------------------------------------
// Helpers — minimal mocks for CodeMirror 6 EditorView state.doc
// ---------------------------------------------------------------------------

interface MockLine {
    from: number;
    to: number;
    number: number;
    text: string;
}

function createMockDoc(text: string) {
    const lines: MockLine[] = [];
    let offset = 0;
    const rawLines = text.split("\n");
    for (let i = 0; i < rawLines.length; i++) {
        const from = offset;
        const to = from + rawLines[i].length;
        lines.push({ from, to, number: i + 1, text: rawLines[i] });
        offset = to + 1; // +1 for the newline character
    }
    // Total length is offset - 1 if text ends with newline, but plain
    // split gives us the correct structure for CodeMirror's doc model.
    // CM6 doc.length equals the full string length.
    return {
        lines: rawLines.length,
        length: text.length,
        line(n: number) {
            return lines[n - 1]; // CM6 uses 1-based line numbers
        },
        lineAt(offset: number) {
            for (const l of lines) {
                if (offset >= l.from && offset <= l.to) return l;
            }
            // Past the end — return the last line
            return lines[lines.length - 1];
        },
    };
}

function mockView(text: string) {
    return { state: { doc: createMockDoc(text) } } as any;
}

// ---------------------------------------------------------------------------
// posToOffset
// ---------------------------------------------------------------------------
describe("posToOffset", () => {
    const doc = "hello\nworld\nfoo";
    // line 0: "hello"  (from=0,  to=5)
    // line 1: "world"  (from=6,  to=11)
    // line 2: "foo"    (from=12, to=15)

    it("converts {line:0, ch:0} to offset 0", () => {
        expect(posToOffset(mockView(doc), { line: 0, ch: 0 })).toBe(0);
    });

    it("converts {line:0, ch:3} to offset 3", () => {
        expect(posToOffset(mockView(doc), { line: 0, ch: 3 })).toBe(3);
    });

    it("converts {line:1, ch:0} to offset 6", () => {
        expect(posToOffset(mockView(doc), { line: 1, ch: 0 })).toBe(6);
    });

    it("converts {line:1, ch:2} to offset 8", () => {
        expect(posToOffset(mockView(doc), { line: 1, ch: 2 })).toBe(8);
    });

    it("converts {line:2, ch:0} to offset 12", () => {
        expect(posToOffset(mockView(doc), { line: 2, ch: 0 })).toBe(12);
    });

    it("clamps ch beyond line end to line.to", () => {
        // line 0 ("hello") has length 5, ch=999 should clamp to 5
        expect(posToOffset(mockView(doc), { line: 0, ch: 999 })).toBe(5);
    });

    it("clamps negative ch to 0", () => {
        expect(posToOffset(mockView(doc), { line: 0, ch: -5 })).toBe(0);
    });

    it("clamps line < 0 to line 1 (index 0)", () => {
        expect(posToOffset(mockView(doc), { line: -1, ch: 0 })).toBe(0);
    });

    it("clamps line > last line to last line", () => {
        // 3 lines, last is line index 2
        expect(posToOffset(mockView(doc), { line: 99, ch: 0 })).toBe(12);
    });

    it("handles single-line document", () => {
        const single = "abcdef";
        expect(posToOffset(mockView(single), { line: 0, ch: 3 })).toBe(3);
        expect(posToOffset(mockView(single), { line: 0, ch: 999 })).toBe(6);
    });
});

// ---------------------------------------------------------------------------
// offsetToPos
// ---------------------------------------------------------------------------
describe("offsetToPos", () => {
    const doc = "hello\nworld\nfoo";
    // line 0: "hello"  (from=0,  to=5)
    // line 1: "world"  (from=6,  to=11)
    // line 2: "foo"    (from=12, to=15)

    it("converts offset 0 to {line:0, ch:0}", () => {
        expect(offsetToPos(mockView(doc), 0)).toEqual({ line: 0, ch: 0 });
    });

    it("converts offset 3 to {line:0, ch:3}", () => {
        expect(offsetToPos(mockView(doc), 3)).toEqual({ line: 0, ch: 3 });
    });

    it("converts offset 6 (start of line 1) to {line:1, ch:0}", () => {
        expect(offsetToPos(mockView(doc), 6)).toEqual({ line: 1, ch: 0 });
    });

    it("converts offset 8 to {line:1, ch:2}", () => {
        expect(offsetToPos(mockView(doc), 8)).toEqual({ line: 1, ch: 2 });
    });

    it("converts offset 11 (end of line 1) to {line:1, ch:5}", () => {
        expect(offsetToPos(mockView(doc), 11)).toEqual({ line: 1, ch: 5 });
    });

    it("converts offset 12 (start of line 2) to {line:2, ch:0}", () => {
        expect(offsetToPos(mockView(doc), 12)).toEqual({ line: 2, ch: 0 });
    });

    it("converts offset 15 (end of document) to {line:2, ch:3}", () => {
        expect(offsetToPos(mockView(doc), 15)).toEqual({ line: 2, ch: 3 });
    });

    it("clamps negative offset to 0", () => {
        expect(offsetToPos(mockView(doc), -10)).toEqual({ line: 0, ch: 0 });
    });

    it("clamps offset beyond document length to last line", () => {
        // lineAt receives clamped offset (15), ch uses clamped offset too
        expect(offsetToPos(mockView(doc), 999)).toEqual({ line: 2, ch: 3 });
    });

    it("handles single-line document", () => {
        const single = "abcdef";
        expect(offsetToPos(mockView(single), 0)).toEqual({ line: 0, ch: 0 });
        expect(offsetToPos(mockView(single), 6)).toEqual({ line: 0, ch: 6 });
    });
});
