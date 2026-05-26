// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../stores/settings", () => ({
  settingsStore: {
    settings: vi.fn(() => ({
      css_snippets: [],
    })),
    updateSetting: vi.fn(),
  },
  reloadCssSnippets: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === "list_css_snippets") return Promise.resolve([]);
    if (cmd === "read_css_snippet") return Promise.resolve("");
    if (cmd === "get_snippets_dir") return Promise.resolve("/mock/snippets");
    return Promise.resolve(undefined);
  }),
}));

vi.mock("../../common/ConfirmDialog", () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
  promptDialog: vi.fn().mockResolvedValue("test-snippet"),
}));

vi.mock("../../../constants/vaultPaths", () => ({
  VAULT_CONFIG_DIR: ".mindzj",
  SNIPPETS_DIR: "snippets",
}));

// Import after mocks are set up
import { CssSnippetsPanel } from "../CssSnippetsPanel";

describe("CssSnippetsPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders without crashing", () => {
      const { container } = render(() => <CssSnippetsPanel />);
      expect(container).toBeTruthy();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });

    it("shows the CSS snippets title", () => {
      render(() => <CssSnippetsPanel />);
      expect(screen.getByText("settings.cssSnippets")).toBeTruthy();
    });

    it("shows 'New Snippet' button", () => {
      render(() => <CssSnippetsPanel />);
      expect(screen.getByText("settings.newSnippet")).toBeTruthy();
    });

    it("shows empty state when no snippets exist", async () => {
      render(() => <CssSnippetsPanel />);
      expect(await screen.findByText("settings.noSnippetFiles")).toBeTruthy();
    });
  });

  describe("Initialization", () => {
    it("calls invoke('list_css_snippets') on mount", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const invokeSpy = vi.mocked(invoke);
      invokeSpy.mockClear();
      render(() => <CssSnippetsPanel />);
      await vi.waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledWith("list_css_snippets");
      });
    });
  });
});
