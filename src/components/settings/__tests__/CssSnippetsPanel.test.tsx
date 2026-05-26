// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";

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

  describe("Snippet selection and loading", () => {
    it("loads snippet content when a snippet card is clicked", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const invokeSpy = vi.mocked(invoke);
      invokeSpy.mockImplementation((cmd: string) => {
        if (cmd === "list_css_snippets") return Promise.resolve(["test-snippet"]);
        if (cmd === "read_css_snippet") return Promise.resolve("body { color: red; }");
        if (cmd === "get_snippets_dir") return Promise.resolve("/mock/snippets");
        return Promise.resolve(undefined);
      });

      render(() => <CssSnippetsPanel />);

      const cards = await screen.findAllByText("test-snippet");
      cards[0].click();

      await vi.waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledWith("read_css_snippet", { name: "test-snippet" });
      });
    });
  });

  describe("Save snippet", () => {
    it("calls invoke('write_file') when save button clicked after editing", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const invokeSpy = vi.mocked(invoke);
      invokeSpy.mockImplementation((cmd: string) => {
        if (cmd === "list_css_snippets") return Promise.resolve(["test-snippet"]);
        if (cmd === "read_css_snippet") return Promise.resolve("body { color: red; }");
        if (cmd === "get_snippets_dir") return Promise.resolve("/mock/snippets");
        if (cmd === "write_file") return Promise.resolve(undefined);
        return Promise.resolve(undefined);
      });

      render(() => <CssSnippetsPanel />);

      // Select snippet
      const cards = await screen.findAllByText("test-snippet");
      cards[0].click();

      // Wait for textarea to appear and edit it to make dirty
      const textarea = await screen.findByRole("textbox");
      await fireEvent.input(textarea, { target: { value: "body { color: blue; }" } });

      // Now save button should be enabled
      await vi.waitFor(() => {
        const saveBtn = screen.getByText("common.save");
        expect(saveBtn).toBeTruthy();
        saveBtn.click();
      });

      await vi.waitFor(() => {
        expect(invokeSpy).toHaveBeenCalledWith("write_file", expect.objectContaining({
          content: expect.stringContaining("blue"),
        }));
      });
    });
  });

  describe("Create snippet", () => {
    it("opens prompt dialog when 'New Snippet' button clicked", async () => {
      const { promptDialog } = await import("../../common/ConfirmDialog");
      const promptSpy = vi.mocked(promptDialog);

      render(() => <CssSnippetsPanel />);

      const newBtn = screen.getByText("settings.newSnippet");
      newBtn.click();

      await vi.waitFor(() => {
        expect(promptSpy).toHaveBeenCalled();
      });
    });
  });
});
