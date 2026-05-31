import { describe, it, expect } from "vitest";
import {
    isViewMode,
    resolveDefaultViewMode,
    isSplitDirection,
    isPaneSlot,
    normalizeSplitRatio,
} from "./paneUtils";

describe("paneUtils", () => {
    // ── isViewMode ──

    describe("isViewMode", () => {
        it("accepts 'source'", () => {
            expect(isViewMode("source")).toBe(true);
        });

        it("accepts 'live-preview'", () => {
            expect(isViewMode("live-preview")).toBe(true);
        });

        it("accepts 'reading'", () => {
            expect(isViewMode("reading")).toBe(true);
        });

        it("rejects null", () => {
            expect(isViewMode(null)).toBe(false);
        });

        it("rejects empty string", () => {
            expect(isViewMode("")).toBe(false);
        });

        it("rejects case-mismatched 'Source'", () => {
            expect(isViewMode("Source")).toBe(false);
        });

        it("rejects arbitrary string", () => {
            expect(isViewMode("preview")).toBe(false);
        });
    });

    // ── resolveDefaultViewMode ──

    describe("resolveDefaultViewMode", () => {
        it("normalizes 'Source' to 'source'", () => {
            expect(resolveDefaultViewMode("Source")).toBe("source");
        });

        it("normalizes 'source' to 'source'", () => {
            expect(resolveDefaultViewMode("source")).toBe("source");
        });

        it("normalizes 'Reading' to 'reading'", () => {
            expect(resolveDefaultViewMode("Reading")).toBe("reading");
        });

        it("normalizes 'reading' to 'reading'", () => {
            expect(resolveDefaultViewMode("reading")).toBe("reading");
        });

        it("normalizes 'LivePreview' to 'live-preview'", () => {
            expect(resolveDefaultViewMode("LivePreview")).toBe("live-preview");
        });

        it("normalizes 'live-preview' to 'live-preview'", () => {
            expect(resolveDefaultViewMode("live-preview")).toBe("live-preview");
        });

        it("defaults null to 'live-preview'", () => {
            expect(resolveDefaultViewMode(null)).toBe("live-preview");
        });

        it("defaults undefined to 'live-preview'", () => {
            expect(resolveDefaultViewMode(undefined)).toBe("live-preview");
        });

        it("defaults empty string to 'live-preview'", () => {
            expect(resolveDefaultViewMode("")).toBe("live-preview");
        });

        it("defaults unknown string to 'live-preview'", () => {
            expect(resolveDefaultViewMode("random")).toBe("live-preview");
        });
    });

    // ── isSplitDirection ──

    describe("isSplitDirection", () => {
        it("accepts 'left'", () => {
            expect(isSplitDirection("left")).toBe(true);
        });

        it("accepts 'right'", () => {
            expect(isSplitDirection("right")).toBe(true);
        });

        it("accepts 'up'", () => {
            expect(isSplitDirection("up")).toBe(true);
        });

        it("accepts 'down'", () => {
            expect(isSplitDirection("down")).toBe(true);
        });

        it("rejects 'diagonal'", () => {
            expect(isSplitDirection("diagonal")).toBe(false);
        });

        it("rejects null", () => {
            expect(isSplitDirection(null)).toBe(false);
        });

        it("rejects number", () => {
            expect(isSplitDirection(42)).toBe(false);
        });

        it("rejects empty string", () => {
            expect(isSplitDirection("")).toBe(false);
        });
    });

    // ── isPaneSlot ──

    describe("isPaneSlot", () => {
        it("accepts 'primary'", () => {
            expect(isPaneSlot("primary")).toBe(true);
        });

        it("accepts 'secondary'", () => {
            expect(isPaneSlot("secondary")).toBe(true);
        });

        it("rejects 'tertiary'", () => {
            expect(isPaneSlot("tertiary")).toBe(false);
        });

        it("rejects null", () => {
            expect(isPaneSlot(null)).toBe(false);
        });

        it("rejects empty string", () => {
            expect(isPaneSlot("")).toBe(false);
        });
    });

    // ── normalizeSplitRatio ──

    describe("normalizeSplitRatio", () => {
        it("passes through valid ratio", () => {
            expect(normalizeSplitRatio(0.5)).toBe(0.5);
        });

        it("clamps below 0.2", () => {
            expect(normalizeSplitRatio(0.1)).toBe(0.2);
        });

        it("clamps above 0.8", () => {
            expect(normalizeSplitRatio(0.9)).toBe(0.8);
        });

        it("accepts boundary 0.2", () => {
            expect(normalizeSplitRatio(0.2)).toBe(0.2);
        });

        it("accepts boundary 0.8", () => {
            expect(normalizeSplitRatio(0.8)).toBe(0.8);
        });

        it("defaults NaN to 0.5", () => {
            expect(normalizeSplitRatio(NaN)).toBe(0.5);
        });

        it("defaults Infinity to 0.5", () => {
            expect(normalizeSplitRatio(Infinity)).toBe(0.5);
        });

        it("defaults negative to 0.5 (not finite check)", () => {
            // -1 is finite but < 0.2, so clamped to 0.2
            expect(normalizeSplitRatio(-1)).toBe(0.2);
        });

        it("defaults string to 0.5", () => {
            expect(normalizeSplitRatio("text" as unknown)).toBe(0.5);
        });

        it("defaults null to 0.5", () => {
            expect(normalizeSplitRatio(null)).toBe(0.5);
        });

        it("defaults undefined to 0.5", () => {
            expect(normalizeSplitRatio(undefined)).toBe(0.5);
        });
    });
});
