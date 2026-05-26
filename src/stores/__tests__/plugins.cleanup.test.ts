// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

const { mockInvoke } = vi.hoisted(() => ({
    mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: mockInvoke,
}));

vi.mock("../vault", () => ({
    vaultStore: {
        activeFile: vi.fn(() => null),
        vaultInfo: vi.fn(() => ({ path: "/tmp/test-vault", name: "test" })),
        openFile: vi.fn(),
        saveFile: vi.fn(),
    },
}));

vi.mock("../../plugin-shim", () => ({
    installObsidianDomExtensions: vi.fn(),
    createObsidianShim: vi.fn(() => ({})),
    createAppObject: vi.fn(() => ({
        workspace: { activeLeaf: null },
    })),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("installWorkspaceBridges listener cleanup", () => {
    let docAddSpy: ReturnType<typeof vi.spyOn>;
    let docRemoveSpy: ReturnType<typeof vi.spyOn>;
    let winAddSpy: ReturnType<typeof vi.spyOn>;
    let winRemoveSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();

        docAddSpy = vi.spyOn(document, "addEventListener");
        docRemoveSpy = vi.spyOn(document, "removeEventListener");
        winAddSpy = vi.spyOn(window, "addEventListener");
        winRemoveSpy = vi.spyOn(window, "removeEventListener");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("registers a mindzj:workspace-trigger listener", async () => {
        const { pluginStore } = await import("../plugins");

        // Trigger plugin loading which calls installWorkspaceBridges
        mockInvoke.mockImplementation(async (cmd: string) => {
            if (cmd === "list_plugins") return [];
            return null;
        });

        await pluginStore.loadAllPlugins();

        const call = docAddSpy.mock.calls.find(
            ([type]) => type === "mindzj:workspace-trigger",
        );
        expect(call).toBeDefined();
    });

    it("registers a window resize listener", async () => {
        const { pluginStore } = await import("../plugins");

        mockInvoke.mockImplementation(async (cmd: string) => {
            if (cmd === "list_plugins") return [];
            return null;
        });

        await pluginStore.loadAllPlugins();

        const call = winAddSpy.mock.calls.find(([type]) => type === "resize");
        expect(call).toBeDefined();
    });

    it("exports a teardown function that removes the workspace-trigger listener", async () => {
        const { pluginStore } = await import("../plugins");

        mockInvoke.mockImplementation(async (cmd: string) => {
            if (cmd === "list_plugins") return [];
            return null;
        });

        await pluginStore.loadAllPlugins();

        // After the fix, the module should export a teardown/uninstall function
        const mod = await import("../plugins");
        const teardown =
            (mod as any).uninstallWorkspaceBridges ??
            (mod as any).teardownWorkspaceBridges ??
            (mod as any).cleanupWorkspaceBridges ??
            (mod as any).removeWorkspaceBridges;

        expect(typeof teardown).toBe(
            "function",
            "Expected a teardown function to be exported for workspace bridge listeners",
        );

        if (typeof teardown === "function") {
            teardown();
        }

        expect(docRemoveSpy).toHaveBeenCalledWith(
            "mindzj:workspace-trigger",
            expect.any(Function),
        );
    });

    it("exports a teardown function that removes the window resize listener", async () => {
        const { pluginStore } = await import("../plugins");

        mockInvoke.mockImplementation(async (cmd: string) => {
            if (cmd === "list_plugins") return [];
            return null;
        });

        await pluginStore.loadAllPlugins();

        const mod = await import("../plugins");
        const teardown =
            (mod as any).uninstallWorkspaceBridges ??
            (mod as any).teardownWorkspaceBridges ??
            (mod as any).cleanupWorkspaceBridges ??
            (mod as any).removeWorkspaceBridges;

        expect(typeof teardown).toBe(
            "function",
            "Expected a teardown function to be exported for workspace bridge listeners",
        );

        if (typeof teardown === "function") {
            teardown();
        }

        expect(winRemoveSpy).toHaveBeenCalledWith(
            "resize",
            expect.any(Function),
        );
    });
});
