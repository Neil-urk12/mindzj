// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";
import { PluginSettingsPanel } from "../PluginSettingsPanel";
import { getPluginSettingTab } from "../../../stores/plugins";
import { invoke } from "@tauri-apps/api/core";

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../stores/plugins", () => ({
  pluginStore: {
    reloadPlugin: vi.fn(),
    unloadPlugin: vi.fn(),
  },
  getPluginSettingTab: vi.fn(() => null),
  pluginsVersion: vi.fn(() => 0),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([
    {
      manifest: {
        id: "test-plugin",
        name: "Test Plugin",
        version: "1.0.0",
        description: "A test plugin",
        author: "Tester",
        author_url: "",
        min_app_version: "",
        is_desktop_only: false,
      },
      enabled: true,
      has_styles: false,
      dir_path: "/plugins/test-plugin",
    },
  ]),
}));

describe("PluginSettingsPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders without crashing", () => {
      const { container } = render(() => (
        <PluginSettingsPanel pluginId="test-plugin" />
      ));
      expect(container).toBeTruthy();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });

    it("shows plugin info for the given pluginId", async () => {
      render(() => <PluginSettingsPanel pluginId="test-plugin" />);
      await waitFor(() => {
        expect(screen.getByText("test-plugin")).toBeTruthy();
      });
    });
  });

  describe("Settings availability", () => {
    it("does not show settings section when getPluginSettingTab returns null", () => {
      vi.mocked(getPluginSettingTab).mockReturnValue(null);
      render(() => <PluginSettingsPanel pluginId="test-plugin" />);
      expect(screen.queryByText("settings.pluginSettings")).toBeNull();
    });
  });

  describe("Custom settings tab", () => {
    it("renders custom tab content when getPluginSettingTab returns a tab", async () => {
      const mockDisplay = vi.fn();
      vi.mocked(getPluginSettingTab).mockReturnValue({
        display: mockDisplay,
        hide: vi.fn(),
        containerEl: document.createElement("div"),
      });

      render(() => <PluginSettingsPanel pluginId="test-plugin" />);

      await waitFor(() => {
        expect(screen.getByText("settings.pluginSettings")).toBeTruthy();
      });

      expect(mockDisplay).toHaveBeenCalled();
    });

    it("calls tab.hide() on unmount", async () => {
      const mockHide = vi.fn();
      vi.mocked(getPluginSettingTab).mockReturnValue({
        display: vi.fn(),
        hide: mockHide,
        containerEl: document.createElement("div"),
      });

      render(() => <PluginSettingsPanel pluginId="test-plugin" />);

      await waitFor(() => {
        expect(screen.getByText("settings.pluginSettings")).toBeTruthy();
      });

      cleanup();

      expect(mockHide).toHaveBeenCalled();
    });
  });

  describe("Reload plugin", () => {
    it("calls pluginStore.reloadPlugin when reload button clicked", async () => {
      const { pluginStore } = await import("../../../stores/plugins");
      const reloadSpy = vi.mocked(pluginStore.reloadPlugin);

      render(() => <PluginSettingsPanel pluginId="test-plugin" />);

      await waitFor(() => {
        expect(screen.getByText("settings.reloadPlugin")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("settings.reloadPlugin"));

      expect(reloadSpy).toHaveBeenCalledWith("test-plugin");
    });
  });

  describe("Open plugin folder", () => {
    it("calls invoke('open_path_in_file_manager') when folder button clicked", async () => {
      const invokeSpy = vi.mocked(invoke);

      render(() => <PluginSettingsPanel pluginId="test-plugin" />);

      await waitFor(() => {
        expect(screen.getByText("settings.openPluginFolder")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("settings.openPluginFolder"));

      await waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledWith("open_path_in_file_manager", {
          absolutePath: "/plugins/test-plugin",
        });
      });
    });
  });
});
