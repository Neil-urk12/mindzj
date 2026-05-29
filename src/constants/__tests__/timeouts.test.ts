import { describe, it, expect } from "vitest";
import * as timeouts from "../timeouts";

describe("timeout constants", () => {
  it("all constants are positive numbers", () => {
    for (const [name, value] of Object.entries(timeouts)) {
      expect(typeof value, `${name} should be a number`).toBe("number");
      expect(value, `${name} should be positive`).toBeGreaterThan(0);
    }
  });

  it("defines expected UI timeouts", () => {
    expect(timeouts.SHORTCUT_TOAST_DISMISS_MS).toBe(1200);
    expect(timeouts.SEARCH_FLASH_MS).toBe(1000);
    expect(timeouts.READING_FLASH_MS).toBe(1500);
    expect(timeouts.FOLDER_STATE_SAVE_DEBOUNCE_MS).toBe(1000);
    expect(timeouts.WINDOW_SAVE_DEBOUNCE_MS).toBe(500);
  });
});
