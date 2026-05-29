import { describe, it, expect } from "vitest";
import * as timeouts from "../timeouts";

describe("timeout constants", () => {
  // ── Zoom boundaries ──
  describe("Zoom boundaries", () => {
    it("ZOOM_MIN is 50", () => {
      expect(timeouts.ZOOM_MIN).toBe(50);
    });

    it("ZOOM_MAX is 200", () => {
      expect(timeouts.ZOOM_MAX).toBe(200);
    });

    it("ZOOM_MIN < ZOOM_MAX", () => {
      expect(timeouts.ZOOM_MIN).toBeLessThan(timeouts.ZOOM_MAX);
    });
  });

  // ── Auto-save boundaries ──
  describe("Auto-save boundaries", () => {
    it("AUTO_SAVE_MIN_MS is 500", () => {
      expect(timeouts.AUTO_SAVE_MIN_MS).toBe(500);
    });

    it("AUTO_SAVE_MAX_MS is 30000", () => {
      expect(timeouts.AUTO_SAVE_MAX_MS).toBe(30000);
    });

    it("AUTO_SAVE_MIN_MS < AUTO_SAVE_MAX_MS", () => {
      expect(timeouts.AUTO_SAVE_MIN_MS).toBeLessThan(timeouts.AUTO_SAVE_MAX_MS);
    });
  });

  // ── File tree ──
  describe("File tree", () => {
    it("FILE_TREE_MAX_DEPTH is 10", () => {
      expect(timeouts.FILE_TREE_MAX_DEPTH).toBe(10);
    });

    it("FILE_TREE_REVEAL_MS is 1500", () => {
      expect(timeouts.FILE_TREE_REVEAL_MS).toBe(1500);
    });

    it("FOLDER_STATE_SAVE_DEBOUNCE_MS is 1000", () => {
      expect(timeouts.FOLDER_STATE_SAVE_DEBOUNCE_MS).toBe(1000);
    });
  });

  // ── Search ──
  describe("Search", () => {
    it("SEARCH_RESULT_LIMIT is 20", () => {
      expect(timeouts.SEARCH_RESULT_LIMIT).toBe(20);
    });

    it("SEARCH_INPUT_DEBOUNCE_MS is 150", () => {
      expect(timeouts.SEARCH_INPUT_DEBOUNCE_MS).toBe(150);
    });
  });

  // ── AI tokens ──
  describe("AI tokens", () => {
    it("AI_MAX_TOKENS is 4096", () => {
      expect(timeouts.AI_MAX_TOKENS).toBe(4096);
    });
  });

  // ── UI timeouts ──
  describe("UI timeouts", () => {
    it("SHORTCUT_TOAST_DISMISS_MS is 1200", () => {
      expect(timeouts.SHORTCUT_TOAST_DISMISS_MS).toBe(1200);
    });

    it("SCROLL_THROTTLE_MS is 80", () => {
      expect(timeouts.SCROLL_THROTTLE_MS).toBe(80);
    });

    it("READING_SCROLL_THROTTLE_MS is 60", () => {
      expect(timeouts.READING_SCROLL_THROTTLE_MS).toBe(60);
    });

    it("SEARCH_FLASH_MS is 1000", () => {
      expect(timeouts.SEARCH_FLASH_MS).toBe(1000);
    });

    it("OUTLINE_FLASH_MS is 1000", () => {
      expect(timeouts.OUTLINE_FLASH_MS).toBe(1000);
    });

    it("READING_FLASH_MS is 1500", () => {
      expect(timeouts.READING_FLASH_MS).toBe(1500);
    });

    it("TAB_TOOLTIP_DELAY_MS is 1000", () => {
      expect(timeouts.TAB_TOOLTIP_DELAY_MS).toBe(1000);
    });

    it("WORKSPACE_SAVE_DEBOUNCE_MS is 1000", () => {
      expect(timeouts.WORKSPACE_SAVE_DEBOUNCE_MS).toBe(1000);
    });

    it("WINDOW_SAVE_DEBOUNCE_MS is 500", () => {
      expect(timeouts.WINDOW_SAVE_DEBOUNCE_MS).toBe(500);
    });

    it("NOTICE_FADE_MS is 300", () => {
      expect(timeouts.NOTICE_FADE_MS).toBe(300);
    });

    it("NOTICE_DISMISS_MS is 4000", () => {
      expect(timeouts.NOTICE_DISMISS_MS).toBe(4000);
    });

    it("IMAGE_RESIZE_DEBOUNCE_MS is 200", () => {
      expect(timeouts.IMAGE_RESIZE_DEBOUNCE_MS).toBe(200);
    });
  });

  // ── PDF export ──
  describe("PDF export", () => {
    it("PDF_EXPORT_TIMEOUT_MS is 30000", () => {
      expect(timeouts.PDF_EXPORT_TIMEOUT_MS).toBe(30000);
    });
  });

  // ── Skin picker ──
  describe("Skin picker", () => {
    it("SKIN_PREVIEW_DELAY_MS is 2400", () => {
      expect(timeouts.SKIN_PREVIEW_DELAY_MS).toBe(2400);
    });
  });

  // ── All constants are positive numbers ──
  it("all constants are positive numbers", () => {
    for (const [name, value] of Object.entries(timeouts)) {
      expect(typeof value, `${name} should be a number`).toBe("number");
      expect(value, `${name} should be positive`).toBeGreaterThan(0);
    }
  });
});
