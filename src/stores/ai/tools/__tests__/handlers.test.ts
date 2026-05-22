import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────
// Paths are relative to this test file: src/stores/ai/tools/__tests__/handlers.test.ts
// handlers.ts is at src/stores/ai/tools/handlers.ts
// It imports from "../../vault" = src/stores/vault
// From __tests__/, that's ../../../vault

vi.mock("../../../vault", () => ({
  vaultStore: {
    fileTree: vi.fn(() => [
      { name: "a.md", relative_path: "notes/a.md", is_dir: false, size: 10, modified: "2025-01-01", extension: "md" },
      { name: "sub", relative_path: "notes/sub", is_dir: true, size: 0, modified: "2025-01-01", extension: "" },
    ]),
    activeFile: vi.fn(() => ({ path: "notes/a.md", content: "hello" })),
    openFile: vi.fn(),
    createFile: vi.fn(),
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
    deleteDir: vi.fn(),
    createDir: vi.fn(),
    renameFilePath: vi.fn(),
    refreshFileTree: vi.fn(),
  },
}));

vi.mock("../../../editor", () => ({
  editorStore: {
    getViewModeForFile: vi.fn(() => "live-preview"),
    setViewMode: vi.fn(),
  },
}));

vi.mock("../../../settings", () => ({
  settingsStore: {
    settings: vi.fn(() => ({})),
    updateSetting: vi.fn(),
  },
}));

vi.mock("../../../plugins", () => ({
  listPluginCommands: vi.fn(() => []),
  runPluginCommand: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("executeTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list_notes returns flattened file tree", async () => {
    const { executeTool } = await import("../handlers");
    const result = await executeTool("list_notes", {});

    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as any[]).length).toBeGreaterThan(0);
  });

  it("list_notes calls vaultStore.fileTree()", async () => {
    const { vaultStore } = await import("../../../vault");
    const { executeTool } = await import("../handlers");
    await executeTool("list_notes", {});

    expect(vaultStore.fileTree).toHaveBeenCalled();
  });

  it("read_note calls invoke with path", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce({
      path: "test.md",
      content: "# Hello",
    });

    const { executeTool } = await import("../handlers");
    const result = await executeTool("read_note", { path: "test.md" });

    expect(invoke).toHaveBeenCalledWith("read_file", {
      relativePath: "test.md",
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ path: "test.md", content: "# Hello" });
  });

  it("search_notes calls invoke with query", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValueOnce([]);

    const { executeTool } = await import("../handlers");
    const result = await executeTool("search_notes", { query: "test" });

    expect(invoke).toHaveBeenCalledWith("search_vault", {
      query: "test",
      limit: 20,
      extensionFilter: null,
      pathFilter: null,
    });
    expect(result.ok).toBe(true);
  });

  it("unknown_tool returns error", async () => {
    const { executeTool } = await import("../handlers");
    const result = await executeTool("unknown_tool", {});

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Unknown tool");
  });
});
