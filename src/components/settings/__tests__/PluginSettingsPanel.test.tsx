// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@solidjs/testing-library";
import { PluginSettingsPanel } from "../PluginSettingsPanel";
import { getPluginSettingTab } from "../../../stores/plugins";

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
});
