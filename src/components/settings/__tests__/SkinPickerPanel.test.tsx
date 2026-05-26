// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@solidjs/testing-library";

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../stores/settings", () => ({
  settingsStore: {
    settings: vi.fn(() => ({
      theme: "dark",
    })),
    updateSetting: vi.fn(),
    reloadCustomSkin: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "list_themes") return Promise.resolve([]);
    if (cmd === "import_theme") return Promise.resolve(undefined);
    if (cmd === "delete_theme") return Promise.resolve(undefined);
    if (cmd === "write_theme") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../common/ConfirmDialog", () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
  promptDialog: vi.fn().mockResolvedValue("test-name"),
}));

vi.mock("../../../styles/themes", () => ({
  BUILT_IN_SKINS: [
    { id: "dark", label: "MindZJ Dark", mode: "dark", swatch: ["#231f1a", "#1aad3f"] },
    { id: "light", label: "MindZJ Light", mode: "light", swatch: ["#ffffff", "#1aad3f"] },
    { id: "dracula", label: "Dracula", mode: "dark", swatch: ["#282a36", "#bd93f9"] },
  ],
  CUSTOM_SKIN_PREFIX: "custom:",
  isBuiltInSkin: vi.fn((id: string) => ["dark", "light", "dracula"].includes(id)),
  isCustomSkin: vi.fn((id: string) => id.startsWith("custom:")),
  customSkinName: vi.fn((id: string) => (id.startsWith("custom:") ? id.slice(7) : "")),
}));

// Import after mocks are set up
import { SkinPickerPanel } from "../SkinPickerPanel";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { confirmDialog, promptDialog } from "../../common/ConfirmDialog";
import { settingsStore } from "../../../stores/settings";

describe("SkinPickerPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders without crashing", () => {
      const { container } = render(() => <SkinPickerPanel />);
      expect(container).toBeTruthy();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });

    it("shows the appearance section title", () => {
      render(() => <SkinPickerPanel />);
      expect(screen.getByText("settings.skinGroupDark")).toBeTruthy();
    });
  });

  describe("Built-in skins", () => {
    it("shows built-in skin options", () => {
      render(() => <SkinPickerPanel />);
      expect(screen.getByText("MindZJ Dark")).toBeTruthy();
      expect(screen.getByText("MindZJ Light")).toBeTruthy();
      expect(screen.getByText("Dracula")).toBeTruthy();
    });
  });

  describe("Custom skins", () => {
    it("shows 'Create Custom Skin' button", () => {
      render(() => <SkinPickerPanel />);
      expect(screen.getByText("settings.skinNew")).toBeTruthy();
    });

    it("shows empty state when no custom themes exist", async () => {
      render(() => <SkinPickerPanel />);
      // With list_themes returning [], the empty state message should appear
      await waitFor(() => {
        expect(screen.getByText("settings.noCustomSkins")).toBeTruthy();
      });
    });
  });

  describe("Theme import", () => {
    it("opens file dialog and imports theme on selection", async () => {
      vi.mocked(dialogOpen).mockResolvedValue("/path/to/theme.css" as string | string[] | null);
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "list_themes") return Promise.resolve([]);
        if (cmd === "import_theme") return Promise.resolve("my-theme.css");
        return Promise.resolve(undefined);
      });

      render(() => <SkinPickerPanel />);

      await waitFor(() => {
        expect(screen.getByText("settings.skinImport")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("settings.skinImport"));

      await waitFor(() => {
        expect(dialogOpen).toHaveBeenCalledWith(
          expect.objectContaining({
            filters: [{ name: "CSS", extensions: ["css"] }],
          }),
        );
        expect(vi.mocked(invoke)).toHaveBeenCalledWith("import_theme", {
          sourceAbsolutePath: "/path/to/theme.css",
          overwrite: true,
        });
        expect(vi.mocked(settingsStore.updateSetting)).toHaveBeenCalledWith(
          "theme",
          "custom:my-theme",
        );
      });
    });

    it("does nothing when dialog is cancelled", async () => {
      vi.mocked(dialogOpen).mockResolvedValue(null as string | string[] | null);

      render(() => <SkinPickerPanel />);

      await waitFor(() => {
        expect(screen.getByText("settings.skinImport")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("settings.skinImport"));

      await vi.waitFor(() => {
        expect(dialogOpen).toHaveBeenCalled();
      });

      const importCalls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === "import_theme",
      );
      expect(importCalls).toHaveLength(0);
    });
  });

  describe("Create empty theme", () => {
    it("opens prompt and creates theme on confirmation", async () => {
      vi.mocked(promptDialog).mockResolvedValue("my-new-theme");
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "list_themes") return Promise.resolve([]);
        if (cmd === "write_theme") return Promise.resolve("my-new-theme.css");
        return Promise.resolve(undefined);
      });

      render(() => <SkinPickerPanel />);

      await waitFor(() => {
        expect(screen.getByText("settings.skinNew")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("settings.skinNew"));

      await waitFor(() => {
        expect(vi.mocked(invoke)).toHaveBeenCalledWith(
          "write_theme",
          expect.objectContaining({ bareName: "my-new-theme" }),
        );
        expect(vi.mocked(settingsStore.updateSetting)).toHaveBeenCalledWith(
          "theme",
          "custom:my-new-theme",
        );
      });
    });
  });

  describe("Delete custom skin", () => {
    it("shows confirm and deletes skin on confirmation", async () => {
      vi.mocked(settingsStore.settings).mockReturnValue({
        theme: "custom:my-theme",
      });
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === "list_themes") return Promise.resolve(["my-theme.css"]);
        if (cmd === "delete_theme") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });
      vi.mocked(confirmDialog).mockResolvedValue(true);

      render(() => <SkinPickerPanel />);

      await waitFor(() => {
        expect(screen.getByText("my-theme")).toBeTruthy();
      });

      const deleteButton = screen.getByTitle("common.delete");
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(vi.mocked(invoke)).toHaveBeenCalledWith("delete_theme", {
          name: "my-theme.css",
        });
        expect(vi.mocked(settingsStore.updateSetting)).toHaveBeenCalledWith(
          "theme",
          "dark",
        );
      });
    });
  });

  describe("Active skin selection", () => {
    it("applies skin when a skin card is clicked", async () => {
      render(() => <SkinPickerPanel />);

      await waitFor(() => {
        expect(screen.getByText("MindZJ Dark")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("MindZJ Dark").closest("button")!);

      expect(vi.mocked(settingsStore.updateSetting)).toHaveBeenCalledWith(
        "theme",
        "dark",
      );
    });

    it("shows accent styling on active skin", async () => {
      vi.mocked(settingsStore.settings).mockReturnValue({ theme: "dark" });

      render(() => <SkinPickerPanel />);

      await waitFor(() => {
        expect(screen.getByText("MindZJ Dark")).toBeTruthy();
      });

      const skinButton = screen.getByText("MindZJ Dark").closest("button")!;
      expect(skinButton.getAttribute("style")).toContain("var(--mz-accent)");
    });
  });

  describe("Reload active", () => {
    it("calls reloadCustomSkin when reload button clicked", async () => {
      const reloadSpy = vi.mocked(settingsStore.reloadCustomSkin);

      render(() => <SkinPickerPanel />);

      await waitFor(() => {
        expect(screen.getByText("common.reload")).toBeTruthy();
      });

      fireEvent.click(screen.getByText("common.reload"));

      await vi.waitFor(() => {
        expect(reloadSpy).toHaveBeenCalled();
      });
    });
  });
});
