import { describe, expect, it } from "vitest";
import { pickTabReplacement } from "./pickTabReplacement";

describe("pickTabReplacement", () => {
    it("close middle tab → picks left neighbor", () => {
        // Original: ["a", "b", "c", "d"], closed "b" at index 1
        // Remaining: ["a", "c", "d"]
        expect(pickTabReplacement(1, ["a", "c", "d"])).toBe("a");
    });

    it("close leftmost tab → picks new leftmost", () => {
        // Original: ["a", "b", "c", "d"], closed "a" at index 0
        // Remaining: ["b", "c", "d"]
        expect(pickTabReplacement(0, ["b", "c", "d"])).toBe("b");
    });

    it("close rightmost tab → picks left neighbor", () => {
        // Original: ["a", "b", "c", "d"], closed "d" at index 3
        // Remaining: ["a", "b", "c"]
        expect(pickTabReplacement(3, ["a", "b", "c"])).toBe("c");
    });

    it("single remaining → returns it", () => {
        expect(pickTabReplacement(0, ["a"])).toBe("a");
    });

    it("empty list → returns null", () => {
        expect(pickTabReplacement(0, [])).toBeNull();
    });

    it("exclude skips candidate and picks next", () => {
        // Remaining: ["a", "b", "c"], closed at index 1, exclude "a"
        // Walk left: index 0 = "a" (excluded), walk right: index 1 = "b"
        expect(pickTabReplacement(1, ["a", "b", "c"], "a")).toBe("b");
    });

    it("exclude with leftmost closed skips to next", () => {
        // Remaining: ["b", "c"], closed "a" at index 0, exclude "b"
        // Walk right: index 0 = "b" (excluded), index 1 = "c"
        expect(pickTabReplacement(0, ["b", "c"], "b")).toBe("c");
    });

    it("close middle, exclude left → goes right", () => {
        // Remaining: ["a", "b", "c"], closed at index 1, exclude "a"
        // Walk left: index 0 = "a" (excluded), walk right: index 1 = "b"
        expect(pickTabReplacement(1, ["a", "b", "c"], "a")).toBe("b");
    });

    it("all excluded → returns null", () => {
        // Only one remaining and it's excluded
        expect(pickTabReplacement(0, ["a"], "a")).toBeNull();
    });

    it("closed at index 1 with 2 remaining picks left", () => {
        // Original: ["a", "b"], closed "b" at index 1
        // Remaining: ["a"]
        expect(pickTabReplacement(1, ["a"])).toBe("a");
    });

    it("walks past excluded left neighbor to find right", () => {
        // Remaining: ["a", "b", "c", "d"], closed at index 2, exclude "b"
        // Walk left: index 1 = "b" (excluded), index 0 = "a"
        expect(pickTabReplacement(2, ["a", "b", "c", "d"], "b")).toBe("a");
    });
});
