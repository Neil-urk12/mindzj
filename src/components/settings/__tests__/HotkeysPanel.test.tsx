// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { HotkeysPanel } from "../HotkeysPanel";
import { settingsStore } from "../../../stores/settings";

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../stores/settings", () => ({
  settingsStore: {
    settings: vi.fn(() => ({
      hotkey_overrides: {},
    })),
    updateSetting: vi.fn(),
  },
}));

describe("HotkeysPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders without crashing", () => {
      const { container } = render(() => <HotkeysPanel />);
      expect(container).toBeTruthy();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });

    it("shows search input", () => {
      render(() => <HotkeysPanel />);
      const searchInput = document.querySelector("input[type='text']");
      expect(searchInput).toBeTruthy();
      expect(searchInput?.getAttribute("placeholder")).toBe("settings.hotkeysSearchPlaceholder");
    });

    it("shows hotkey entries from DEFAULT_HOTKEYS", () => {
      render(() => <HotkeysPanel />);
      expect(screen.getByText("hotkeys.saveFile")).toBeTruthy();
      expect(screen.getByText("toolbar.bold")).toBeTruthy();
      expect(screen.getByText("toolbar.italic")).toBeTruthy();
    });

    it("shows key combos for hotkeys", () => {
      render(() => <HotkeysPanel />);
      expect(screen.getByText("Ctrl+S")).toBeTruthy();
      expect(screen.getByText("Ctrl+B")).toBeTruthy();
      expect(screen.getByText("Ctrl+I")).toBeTruthy();
    });

    it("shows reset button for each hotkey", () => {
      render(() => <HotkeysPanel />);
      const resetButtons = document.querySelectorAll("button");
      // At least one reset button per hotkey entry
      expect(resetButtons.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe("Search / Filtering", () => {
    it("filters hotkeys when typing in search", async () => {
      render(() => <HotkeysPanel />);
      const searchInput = document.querySelector("input[type='text']") as HTMLInputElement;

      // All entries visible initially
      expect(screen.getByText("hotkeys.saveFile")).toBeTruthy();
      expect(screen.getByText("toolbar.bold")).toBeTruthy();

      // Type a filter query
      await fireEvent.input(searchInput, { target: { value: "save" } });

      // "save" should remain, "bold" should be filtered out
      expect(screen.getByText("hotkeys.saveFile")).toBeTruthy();
      expect(screen.queryByText("toolbar.bold")).toBeNull();
    });

    it("shows all hotkeys when search is cleared", async () => {
      render(() => <HotkeysPanel />);
      const searchInput = document.querySelector("input[type='text']") as HTMLInputElement;

      // Filter down
      await fireEvent.input(searchInput, { target: { value: "save" } });
      expect(screen.queryByText("toolbar.bold")).toBeNull();

      // Clear search
      await fireEvent.input(searchInput, { target: { value: "" } });
      expect(screen.getByText("hotkeys.saveFile")).toBeTruthy();
      expect(screen.getByText("toolbar.bold")).toBeTruthy();
    });
  });

  describe("Settings integration", () => {
    it("calls updateSetting when reset button clicked", async () => {
      const { settingsStore } = await import("../../../stores/settings");
      const settingsSpy = vi.mocked(settingsStore.settings);
      const updateSettingSpy = vi.mocked(settingsStore.updateSetting);
      updateSettingSpy.mockClear();

      // Mock a custom override so the reset button renders
      settingsSpy.mockReturnValue({
        hotkey_overrides: { save: "Ctrl+Shift+S" },
      });

      render(() => <HotkeysPanel />);

      // Reset button has title="settings.resetToDefault"
      const resetBtn = document.querySelector('button[title="settings.resetToDefault"]');
      expect(resetBtn).toBeTruthy();
      resetBtn!.click();

      expect(updateSettingSpy).toHaveBeenCalledWith(
        "hotkey_overrides",
        {},
      );
    });
  });

  describe("Key capture flow", () => {
    beforeEach(() => {
      vi.mocked(settingsStore.settings).mockReturnValue({
        hotkey_overrides: {},
      });
    });
    it("enters capture mode when hotkey button clicked", async () => {
      render(() => <HotkeysPanel />);
      const hotkeyButton = screen.getByText("Ctrl+S");
      fireEvent.click(hotkeyButton);
      await vi.waitFor(() => {
        expect(screen.getByText("settings.pressShortcut")).toBeTruthy();
      });
    });

    it("saves captured key combination on keydown", async () => {
      const { settingsStore } = await import("../../../stores/settings");
      const updateSettingSpy = vi.mocked(settingsStore.updateSetting);
      updateSettingSpy.mockClear();

      render(() => <HotkeysPanel />);
      fireEvent.click(screen.getByText("Ctrl+S"));

      await vi.waitFor(() => {
        expect(screen.getByText("settings.pressShortcut")).toBeTruthy();
      });

      fireEvent.keyDown(document, { key: "k", ctrlKey: true, shiftKey: true });

      await vi.waitFor(() => {
        expect(updateSettingSpy).toHaveBeenCalledWith(
          "hotkey_overrides",
          expect.objectContaining({ save: "Ctrl+Shift+K" }),
        );
      });
    });

    it("exits capture mode on Escape", async () => {
      render(() => <HotkeysPanel />);
      fireEvent.click(screen.getByText("Ctrl+S"));

      await vi.waitFor(() => {
        expect(screen.getByText("settings.pressShortcut")).toBeTruthy();
      });

      fireEvent.keyDown(document, { key: "Escape" });

      await vi.waitFor(() => {
        expect(screen.queryByText("settings.pressShortcut")).toBeNull();
      });
      expect(screen.getByText("Ctrl+S")).toBeTruthy();
    });

    it("ignores modifier-only keypresses", async () => {
      render(() => <HotkeysPanel />);
      fireEvent.click(screen.getByText("Ctrl+S"));

      await vi.waitFor(() => {
        expect(screen.getByText("settings.pressShortcut")).toBeTruthy();
      });

      fireEvent.keyDown(document, { key: "Control", ctrlKey: true });

      expect(screen.getByText("settings.pressShortcut")).toBeTruthy();
    });
  });

  describe("Custom override styling", () => {
    it("applies accent styling to overridden hotkeys", async () => {
      const { settingsStore } = await import("../../../stores/settings");
      vi.mocked(settingsStore.settings).mockReturnValue({
        hotkey_overrides: { "new-note": "Alt+N" },
      });

      render(() => <HotkeysPanel />);

      const hotkeyButton = screen.getByText("Alt+N");
      expect(hotkeyButton.getAttribute("style")).toContain("var(--mz-accent)");
    });
  });
});
