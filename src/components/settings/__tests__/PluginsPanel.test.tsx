// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { PluginsPanel } from "../PluginsPanel";
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
  invoke: vi.fn(),
}));

const MOCK_PLUGIN = {
  manifest: {
    id: "test-plugin",
    name: "Test Plugin",
    description: "A test plugin",
  },
  enabled: true,
  has_settings: false,
  has_styles: false,
  dir_path: "/plugins/test-plugin",
};

describe("PluginsPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders without crashing", async () => {
      vi.mocked(invoke).mockResolvedValue([]);
      const { container } = render(() => <PluginsPanel />);
      expect(container).toBeTruthy();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });

    it("calls invoke('list_plugins') on mount", async () => {
      vi.mocked(invoke).mockResolvedValue([]);
      render(() => <PluginsPanel />);
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("list_plugins");
      });
    });
  });

  describe("Empty state", () => {
    it("shows empty state when no plugins loaded", async () => {
      vi.mocked(invoke).mockResolvedValue([]);
      render(() => <PluginsPanel />);
      await vi.waitFor(() => {
        expect(screen.getByText("settings.noPluginsInstalled")).toBeTruthy();
      });
    });
  });

  describe("Plugin list", () => {
    it("shows plugin entries when plugins exist", async () => {
      vi.mocked(invoke).mockResolvedValue([MOCK_PLUGIN]);
      render(() => <PluginsPanel />);
      await vi.waitFor(() => {
        expect(screen.getByText("Test Plugin")).toBeTruthy();
        expect(screen.getByText("A test plugin")).toBeTruthy();
      });
    });
  });
});
