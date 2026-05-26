// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@solidjs/testing-library";

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../stores/settings", () => ({
  settingsStore: {
    settings: vi.fn(() => ({
      theme: "dark",
    })),
    updateSetting: vi.fn(),
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
});
