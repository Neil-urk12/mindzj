// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
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

const MOCK_CORE_PLUGIN = {
  manifest: {
    id: "core-plugin",
    name: "Core Plugin",
    description: "A core plugin",
  },
  enabled: true,
  has_settings: false,
  has_styles: false,
  dir_path: "/plugins/core-plugin",
  is_core: true,
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

  describe("Search and filtering", () => {
    it("filters plugins by name when typing in search", async () => {
      const MOCK_PLUGINS = [
        {
          manifest: { id: "alpha", name: "Alpha Plugin", description: "First", author: "A", author_url: "", version: "1.0", min_app_version: "", is_desktop_only: false },
          enabled: true, has_styles: false, dir_path: "/plugins/alpha",
        },
        {
          manifest: { id: "beta", name: "Beta Plugin", description: "Second", author: "B", author_url: "", version: "1.0", min_app_version: "", is_desktop_only: false },
          enabled: true, has_styles: false, dir_path: "/plugins/beta",
        },
      ];
      vi.mocked(invoke).mockResolvedValue(MOCK_PLUGINS);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Alpha Plugin")).toBeTruthy();
      });

      const searchInput = screen.getByRole("textbox") as HTMLInputElement;
      await fireEvent.input(searchInput, { target: { value: "alpha" } });

      expect(screen.getByText("Alpha Plugin")).toBeTruthy();
      expect(screen.queryByText("Beta Plugin")).toBeNull();
    });
  });

  describe("Toggle plugin", () => {
    it("calls invoke('toggle_plugin') and reloadPlugin when enabling", async () => {
      const { pluginStore } = await import("../../../stores/plugins");
      const MOCK_DISABLED = [{
        manifest: { id: "test-plugin", name: "Test Plugin", description: "A test", author: "T", author_url: "", version: "1.0", min_app_version: "", is_desktop_only: false },
        enabled: false, has_styles: false, dir_path: "/plugins/test-plugin",
      }];
      vi.mocked(invoke).mockResolvedValue(MOCK_DISABLED);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Test Plugin")).toBeTruthy();
      });
      const toggle = screen.getByTestId("plugin-toggle-test-plugin") as HTMLButtonElement;
      toggle.click();

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("toggle_plugin", { pluginId: "test-plugin", enabled: true });
        expect(pluginStore.reloadPlugin).toHaveBeenCalledWith("test-plugin");
      });
    });

    it("calls toggle_plugin with enabled=false when disabling", async () => {
      const { pluginStore } = await import("../../../stores/plugins");
      vi.mocked(invoke).mockResolvedValue([MOCK_PLUGIN]);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Test Plugin")).toBeTruthy();
      });

      const toggle = screen.getByTestId("plugin-toggle-test-plugin") as HTMLButtonElement;
      toggle.click();

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("toggle_plugin", { pluginId: "test-plugin", enabled: false });
        expect(pluginStore.unloadPlugin).toHaveBeenCalledWith("test-plugin");
      });
    });

    it("marks core plugin toggle as aria-disabled", async () => {
      vi.mocked(invoke).mockResolvedValue([MOCK_CORE_PLUGIN]);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Core Plugin")).toBeTruthy();
      });

      const toggle = screen.getByTestId("plugin-toggle-core-plugin") as HTMLButtonElement;
      expect(toggle.getAttribute("aria-disabled")).toBe("true");
    });

    it("does not set aria-disabled on non-core plugin toggle", async () => {
      vi.mocked(invoke).mockResolvedValue([MOCK_PLUGIN]);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Test Plugin")).toBeTruthy();
      });

      const toggle = screen.getByTestId("plugin-toggle-test-plugin") as HTMLButtonElement;
      expect(toggle.hasAttribute("aria-disabled")).toBe(false);
    });

    it("does not call toggle_plugin when clicking core plugin toggle", async () => {
      const { pluginStore } = await import("../../../stores/plugins");
      vi.mocked(invoke).mockResolvedValue([MOCK_CORE_PLUGIN]);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Core Plugin")).toBeTruthy();
      });

      const toggle = screen.getByTestId("plugin-toggle-core-plugin") as HTMLButtonElement;
      toggle.click();

      expect(invoke).not.toHaveBeenCalledWith("toggle_plugin", expect.objectContaining({ pluginId: expect.any(String) }));
      expect(pluginStore.reloadPlugin).not.toHaveBeenCalled();
    });
  });

  describe("Delete plugin", () => {
    it("shows confirm dialog and deletes plugin on confirmation", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.mocked(invoke).mockResolvedValue([MOCK_PLUGIN]);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Test Plugin")).toBeTruthy();
      });

      const deleteBtn = screen.getByTitle("settings.deletePlugin") as HTMLButtonElement;
      deleteBtn.click();
      await vi.waitFor(() => {
        expect(confirmSpy).toHaveBeenCalled();
        expect(invoke).toHaveBeenCalledWith("delete_plugin", { pluginId: "test-plugin" });
      });
    });

    it("hides delete button for core plugin", async () => {
      vi.mocked(invoke).mockResolvedValue([MOCK_CORE_PLUGIN]);

      render(() => <PluginsPanel />);

      await vi.waitFor(() => {
        expect(screen.getByText("Core Plugin")).toBeTruthy();
      });

      expect(screen.queryByTitle("settings.deletePlugin")).toBeNull();
    });
  });
});
