import { describe, it, expect } from "vitest";
import * as z from "../zIndex";

describe("z-index layer tokens", () => {
  it("layers are in ascending order", () => {
    const layers = [
      z.Z_STATIC,
      z.Z_BASE,
      z.Z_DROPDOWN,
      z.Z_OVERLAY,
      z.Z_CONTEXT_MENU,
      z.Z_PLUGIN_DRAW,
      z.Z_SCREENSHOT_CONTEXT,
      z.Z_MODAL,
      z.Z_SCREENSHOT,
      z.Z_SCREENSHOT_UI,
      z.Z_SCREENSHOT_DRAW,
      z.Z_TOOLTIP,
      z.Z_TOOLTIP_TOP,
    ].map(Number);

    for (let i = 1; i < layers.length; i++) {
      expect(layers[i]).toBeGreaterThan(layers[i - 1]);
    }
  });

  it("all values are numeric strings", () => {
    for (const [name, value] of Object.entries(z)) {
      expect(Number(value).toString(), `${name} should be numeric string`).toBe(value);
    }
  });
});
