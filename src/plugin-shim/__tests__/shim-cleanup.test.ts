// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createObsidianShim } from "../index";

// ── Tests ────────────────────────────────────────────────────────

describe("Plugin shim onunload() listener cleanup", () => {
    let shim: ReturnType<typeof createObsidianShim>;
    let plugin: any;
    let mockApp: any;

    beforeEach(() => {
        vi.restoreAllMocks();

        shim = createObsidianShim("test-plugin");

        // Minimal app with workspace that has on/off/_domListeners
        // Mirrors the real workspace object from plugin-shim/index.ts:1239
        mockApp = {
            workspace: {
                _activeLeaf: null,
                _eventHandlers: {} as Record<string, Function[]>,
                _domListeners: [] as Array<{ handler: EventListener }>,
                on(event: string, cb: Function) {
                    if (!this._eventHandlers[event])
                        this._eventHandlers[event] = [];
                    this._eventHandlers[event].push(cb);
                    const handler = ((e: CustomEvent) => {
                        if (e.detail?.event === event) {
                            try {
                                cb();
                            } catch {}
                        }
                    }) as EventListener;
                    document.addEventListener(
                        "mindzj:workspace-trigger",
                        handler,
                    );
                    this._domListeners.push({ handler });
                    return { id: Math.random(), event, cb, _handler: handler };
                },
                off(event: string, ref: any) {
                    if (this._eventHandlers[event]) {
                        this._eventHandlers[event] = this._eventHandlers[
                            event
                        ].filter((fn: Function) => fn !== ref?.cb);
                    }
                    if (ref?._handler) {
                        document.removeEventListener(
                            "mindzj:workspace-trigger",
                            ref._handler,
                        );
                    }
                },
                activeLeaf: null,
            },
        };

        plugin = new shim.Plugin(mockApp, { id: "test-plugin" });
    });

    // ── Baseline: workspace.on() correctly registers ─────────────

    it("workspace.on() registers a DOM listener for mindzj:workspace-trigger", () => {
        const addSpy = vi.spyOn(document, "addEventListener");

        plugin.app.workspace.on("active-leaf-change", vi.fn());

        expect(addSpy).toHaveBeenCalledWith(
            "mindzj:workspace-trigger",
            expect.any(Function),
        );
    });

    // ── Baseline: registerDomEvent + onunload works ──────────────

    it("onunload() removes DOM listeners registered via registerDomEvent()", () => {
        const el = document.createElement("div");
        const elAddSpy = vi.spyOn(el, "addEventListener");
        const elRemoveSpy = vi.spyOn(el, "removeEventListener");

        const cb = vi.fn();
        plugin.registerDomEvent(el, "click", cb);

        expect(elAddSpy).toHaveBeenCalledWith("click", cb, undefined);

        plugin.onunload();

        expect(elRemoveSpy).toHaveBeenCalledWith("click", cb, undefined);
    });

    // ── Bug: workspace.on() listeners leak through onunload() ────

    it("onunload() removes DOM listeners registered via workspace.on()", () => {
        // TDD RED: this should pass after fix. Currently fails because
        // onunload() only iterates plugin._domListeners, not
        // workspace._domListeners.
        const addSpy = vi.spyOn(document, "addEventListener");
        const removeSpy = vi.spyOn(document, "removeEventListener");

        plugin.app.workspace.on("active-leaf-change", vi.fn());

        const registeredHandler = addSpy.mock.calls.find(
            ([type]) => type === "mindzj:workspace-trigger",
        )?.[1] as EventListener;

        addSpy.mockClear();
        removeSpy.mockClear();

        plugin.onunload();

        expect(removeSpy).toHaveBeenCalledWith(
            "mindzj:workspace-trigger",
            registeredHandler,
        );
    });

    it("workspace._domListeners entries have the same shape as plugin._domListeners entries", () => {
        // TDD RED: after fix, workspace.on() should push entries with
        // {handler} that onunload() can process. Currently onunload
        // destructures {el, type, callback, options} — incompatible.
        plugin.app.workspace.on("active-leaf-change", vi.fn());

        const wsEntry = plugin.app.workspace._domListeners[0];

        // After fix, onunload must be able to extract a handler from
        // workspace entries to call removeEventListener. Currently the
        // entries have {handler} but onunload destructures {el, type, ...}
        // making cleanup a no-op.
        expect(wsEntry).toHaveProperty("handler");

        // The handler must be usable for removeEventListener — verify
        // it's a function (not undefined due to shape mismatch)
        expect(typeof wsEntry.handler).toBe("function");

        // After fix, onunload should use the handler field to clean up.
        // Test by verifying removeEventListener is called with this handler.
        const removeSpy = vi.spyOn(document, "removeEventListener");
        plugin.onunload();

        expect(removeSpy).toHaveBeenCalledWith(
            "mindzj:workspace-trigger",
            wsEntry.handler,
        );
    });

    it("all workspace.on() listeners are cleaned up after onunload()", () => {
        // TDD RED: after fix, every registered workspace listener
        // must be removed on unload.
        const addSpy = vi.spyOn(document, "addEventListener");
        const removeSpy = vi.spyOn(document, "removeEventListener");

        plugin.app.workspace.on("active-leaf-change", vi.fn());
        plugin.app.workspace.on("file-open", vi.fn());
        plugin.app.workspace.on("resize", vi.fn());

        const addedHandlers = addSpy.mock.calls
            .filter(([type]) => type === "mindzj:workspace-trigger")
            .map(([, handler]) => handler);

        expect(addedHandlers.length).toBe(3);

        removeSpy.mockClear();

        plugin.onunload();

        for (const handler of addedHandlers) {
            expect(removeSpy).toHaveBeenCalledWith(
                "mindzj:workspace-trigger",
                handler,
            );
        }
    });
});
