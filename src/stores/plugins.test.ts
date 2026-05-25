// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────
// Use vi.hoisted so the variable is available when the hoisted vi.mock runs

const { mockInvoke } = vi.hoisted(() => ({
    mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: mockInvoke,
}));

vi.mock("./vault", () => ({
    vaultStore: {
        activeFile: vi.fn(() => null),
        vaultInfo: vi.fn(() => ({ path: "/tmp/test-vault", name: "test" })),
        openFile: vi.fn(),
        saveFile: vi.fn(),
    },
}));

vi.mock("../plugin-shim", () => ({
    installObsidianDomExtensions: vi.fn(),
    createObsidianShim: vi.fn(() => ({})),
    createAppObject: vi.fn(() => ({
        workspace: { activeLeaf: null },
    })),
}));

// NOTE: we intentionally do NOT mock ../plugin-shim/plugin-data-dir.
// The real setPluginDataDir must run so it returns false for unsafe ids.

// ── Helpers ──────────────────────────────────────────────────────

/** Build a PluginInfo-shaped object with the given manifest id. */
function makePlugin(id: string) {
    return {
        manifest: {
            id,
            name: `Plugin ${id}`,
            version: "1.0.0",
            description: "",
            author: "",
        },
        enabled: true,
        has_styles: false,
        dir_path: `/tmp/plugins/${id}`,
    };
}

// ── Tests ────────────────────────────────────────────────────────

describe("loadPlugin safety", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        ["path traversal: ../evil", "../evil"],
        ["contains space: my plugin", "my plugin"],
        ["slash separator: foo/bar", "foo/bar"],
        ["empty string", ""],
        ["parent dir literal: ..", ".."],
        ["current dir literal: .", "."],
    ])(
        "should NOT call read_plugin_main when pluginId is unsafe (%s)",
        async (_label, unsafeId) => {
            const { pluginStore } = await import("./plugins");

            // list_plugins returns one plugin with the unsafe id
            mockInvoke.mockImplementation(async (cmd: string) => {
                if (cmd === "list_plugins") {
                    return [makePlugin(unsafeId)];
                }
                return "";
            });

            await pluginStore.loadAllPlugins();

            // setPluginDataDir returns false for unsafe ids.
            // loadPlugin MUST abort before reaching JS execution.
            expect(mockInvoke).not.toHaveBeenCalledWith("read_plugin_main", {
                pluginId: unsafeId,
            });
        },
    );

    it("proceeds to load plugin when pluginId is safe", async () => {
        const { pluginStore } = await import("./plugins");

        mockInvoke.mockImplementation(async (cmd: string) => {
            if (cmd === "list_plugins") {
                return [makePlugin("my-plugin")];
            }
            return "";
        });

        await pluginStore.loadAllPlugins();

        expect(mockInvoke).toHaveBeenCalledWith("read_plugin_main", {
            pluginId: "my-plugin",
        });
    });
});
