import { describe, it, expect } from "vitest";
import { clampZoom, clampAutoSaveInterval } from "../clamp";

// ── clampZoom (range: 50–200) ──────────────────────────────────────────────

describe("clampZoom", () => {
  it("passes through values already in range", () => {
    expect(clampZoom(50)).toBe(50);
    expect(clampZoom(100)).toBe(100);
    expect(clampZoom(200)).toBe(200);
    expect(clampZoom(125)).toBe(125);
  });

  it("clamps values below minimum to 50", () => {
    expect(clampZoom(0)).toBe(50);
    expect(clampZoom(-100)).toBe(50);
    expect(clampZoom(49)).toBe(50);
  });

  it("clamps values above maximum to 200", () => {
    expect(clampZoom(201)).toBe(200);
    expect(clampZoom(300)).toBe(200);
    expect(clampZoom(9999)).toBe(200);
  });

  it("handles exact boundary values", () => {
    expect(clampZoom(50)).toBe(50);
    expect(clampZoom(200)).toBe(200);
  });

  it("preserves non-integer inputs (no rounding)", () => {
    expect(clampZoom(50.4)).toBe(50.4);
    expect(clampZoom(50.6)).toBe(50.6);
    expect(clampZoom(199.7)).toBe(199.7);
    expect(clampZoom(100.1)).toBe(100.1);
  });

  it("handles NaN by clamping to min", () => {
    expect(clampZoom(NaN)).toBe(50);
  });

  it("handles Infinity by clamping to max", () => {
    expect(clampZoom(Infinity)).toBe(200);
  });

  it("handles -Infinity by clamping to min", () => {
    expect(clampZoom(-Infinity)).toBe(50);
  });
});

// ── clampAutoSaveInterval (range: 500–30000) ────────────────────────────────

describe("clampAutoSaveInterval", () => {
  it("passes through values already in range", () => {
    expect(clampAutoSaveInterval(500)).toBe(500);
    expect(clampAutoSaveInterval(2000)).toBe(2000);
    expect(clampAutoSaveInterval(30000)).toBe(30000);
    expect(clampAutoSaveInterval(15000)).toBe(15000);
  });

  it("clamps values below minimum to 500", () => {
    expect(clampAutoSaveInterval(0)).toBe(500);
    expect(clampAutoSaveInterval(-1)).toBe(500);
    expect(clampAutoSaveInterval(499)).toBe(500);
    expect(clampAutoSaveInterval(100)).toBe(500);
  });

  it("clamps values above maximum to 30000", () => {
    expect(clampAutoSaveInterval(30001)).toBe(30000);
    expect(clampAutoSaveInterval(60000)).toBe(30000);
    expect(clampAutoSaveInterval(999999)).toBe(30000);
  });

  it("handles exact boundary values", () => {
    expect(clampAutoSaveInterval(500)).toBe(500);
    expect(clampAutoSaveInterval(30000)).toBe(30000);
  });

  it("rounds non-integer inputs before clamping", () => {
    expect(clampAutoSaveInterval(500.4)).toBe(500);
    expect(clampAutoSaveInterval(500.6)).toBe(501);
    expect(clampAutoSaveInterval(29999.7)).toBe(30000);
    expect(clampAutoSaveInterval(2000.3)).toBe(2000);
  });

  it("handles NaN by clamping to min", () => {
    expect(clampAutoSaveInterval(NaN)).toBe(500);
  });

  it("handles Infinity by clamping to max", () => {
    expect(clampAutoSaveInterval(Infinity)).toBe(30000);
  });

  it("handles -Infinity by clamping to min", () => {
    expect(clampAutoSaveInterval(-Infinity)).toBe(500);
  });
});
