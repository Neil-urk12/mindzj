// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../../i18n", () => ({ t: (k: string) => k }));
vi.mock("../../utils/displayName", () => ({ displayName: vi.fn(() => "") }));
vi.mock("../../utils/openFileRouted", () => ({ openFileRouted: vi.fn() }));
vi.mock("../../stores/editor", () => ({
    editorStore: { activeView: vi.fn(() => null) },
}));

vi.mock("../../stores/vault", () => ({
    vaultStore: {
        activeFile: vi.fn(() => null),
        listFiles: vi.fn(() => []),
        openFile: vi.fn(),
        readFile: vi.fn(() => ""),
    },
}));

vi.mock("../common/ConfirmDialog", () => ({
    confirmDialog: vi.fn(() => Promise.resolve(false)),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("SearchPanel module-level vault-file-saved listener", () => {
    let addSpy: ReturnType<typeof vi.spyOn>;
    let removeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
        addSpy = vi.spyOn(document, "addEventListener");
        removeSpy = vi.spyOn(document, "removeEventListener");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("registers a vault-file-saved listener when the module loads", async () => {
        await import("../SearchPanel.tsx");

        const call = addSpy.mock.calls.find(
            ([type]) => type === "mindzj:vault-file-saved",
        );
        expect(call).toBeDefined();
    });

    it("uses a named handler (not anonymous) so it can be cleaned up", async () => {
        await import("../SearchPanel.tsx");

        const call = addSpy.mock.calls.find(
            ([type]) => type === "mindzj:vault-file-saved",
        );
        expect(call).toBeDefined();

        // The handler must be a named function (have a non-empty `.name`).
        // An anonymous arrow function or unnamed function expression has
        // name === "". The fix should export a named handler so cleanup is
        // possible.
        const handler = call![1] as Function;
        expect(handler.name).not.toBe("");
    });

    it("exports a cleanup function that removes the vault-file-saved listener", async () => {
        const mod = await import("../SearchPanel.tsx");

        // After the fix, the module should export a function like
        // `removeVaultFileSavedListener` or `searchPanelCleanup`.
        const cleanup =
            (mod as any).removeVaultFileSavedListener ??
            (mod as any).searchPanelCleanup ??
            (mod as any).cleanupSearchPanel ??
            (mod as any).cleanupVaultFileSavedListener;

        expect(typeof cleanup).toBe("function");

        // Calling cleanup should remove the listener
        if (typeof cleanup === "function") {
            cleanup();
        }
        expect(removeSpy).toHaveBeenCalledWith(
            "mindzj:vault-file-saved",
            expect.any(Function),
        );
    });
});
