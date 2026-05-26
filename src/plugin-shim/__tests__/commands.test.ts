// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    EDITOR_COMMANDS,
    HEADING_COMMANDS,
    getBuiltinCommands,
    normalizeHotkeyKey,
    matchesPluginHotkey,
    installPluginHotkeys,
    pluginCommandRegistry,
    _resetPluginHotkeysInstalled,
} from "../commands";

// ---------------------------------------------------------------------------
// normalizeHotkeyKey
// ---------------------------------------------------------------------------
describe("normalizeHotkeyKey", () => {
    it('converts "Space" to a space character', () => {
        expect(normalizeHotkeyKey("Space")).toBe(" ");
    });

    it("lowercases keys", () => {
        expect(normalizeHotkeyKey("CTRL")).toBe("ctrl");
        expect(normalizeHotkeyKey("Shift")).toBe("shift");
        expect(normalizeHotkeyKey("META")).toBe("meta");
    });

    it('returns "" for undefined', () => {
        expect(normalizeHotkeyKey(undefined)).toBe("");
    });

    it('returns "" for empty string', () => {
        expect(normalizeHotkeyKey("")).toBe("");
    });

    it("preserves already-lowercase keys", () => {
        expect(normalizeHotkeyKey("a")).toBe("a");
        expect(normalizeHotkeyKey("enter")).toBe("enter");
    });
});

// ---------------------------------------------------------------------------
// matchesPluginHotkey
// ---------------------------------------------------------------------------
describe("matchesPluginHotkey", () => {
    function makeEvent(
        key: string,
        opts: {
            ctrl?: boolean;
            meta?: boolean;
            shift?: boolean;
            alt?: boolean;
        } = {},
    ): KeyboardEvent {
        return new KeyboardEvent("keydown", {
            key,
            ctrlKey: opts.ctrl ?? false,
            metaKey: opts.meta ?? false,
            shiftKey: opts.shift ?? false,
            altKey: opts.alt ?? false,
        });
    }

    it("returns false for undefined hotkey", () => {
        expect(matchesPluginHotkey(makeEvent("a"), undefined)).toBe(false);
    });

    it("returns false for hotkey with no key", () => {
        expect(
            matchesPluginHotkey(makeEvent("a"), { modifiers: ["ctrl"] }),
        ).toBe(false);
    });

    it("returns true for matching key with no modifiers", () => {
        expect(
            matchesPluginHotkey(makeEvent("a"), { key: "a" }),
        ).toBe(true);
    });

    it("returns true for matching key + shift modifier", () => {
        expect(
            matchesPluginHotkey(makeEvent("a", { shift: true }), {
                key: "a",
                modifiers: ["shift"],
            }),
        ).toBe(true);
    });

    it("returns false when expected modifier is not pressed", () => {
        expect(
            matchesPluginHotkey(makeEvent("a"), {
                key: "a",
                modifiers: ["shift"],
            }),
        ).toBe(false);
    });

    it("returns false when unexpected modifier is pressed", () => {
        expect(
            matchesPluginHotkey(makeEvent("a", { ctrl: true }), {
                key: "a",
            }),
        ).toBe(false);
    });

    it("returns false when key does not match", () => {
        expect(
            matchesPluginHotkey(makeEvent("b", { shift: true }), {
                key: "a",
                modifiers: ["shift"],
            }),
        ).toBe(false);
    });

    it("normalizes Space key in event and hotkey", () => {
        expect(
            matchesPluginHotkey(makeEvent("Space"), { key: "Space" }),
        ).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// EDITOR_COMMANDS
// ---------------------------------------------------------------------------
describe("EDITOR_COMMANDS", () => {
    it("has 21 entries", () => {
        expect(EDITOR_COMMANDS).toHaveLength(21);
    });

    it("every entry is a [id, name, command] tuple", () => {
        for (const entry of EDITOR_COMMANDS) {
            expect(entry).toHaveLength(3);
            expect(typeof entry[0]).toBe("string"); // id
            expect(typeof entry[1]).toBe("string"); // name
            expect(typeof entry[2]).toBe("string"); // command
        }
    });

    it('all ids start with "editor:"', () => {
        for (const [id] of EDITOR_COMMANDS) {
            expect(id).toMatch(/^editor:/);
        }
    });
});

// ---------------------------------------------------------------------------
// HEADING_COMMANDS
// ---------------------------------------------------------------------------
describe("HEADING_COMMANDS", () => {
    it("has 6 entries", () => {
        expect(HEADING_COMMANDS).toHaveLength(6);
    });

    it("covers heading levels 1 through 6", () => {
        const levels = HEADING_COMMANDS.map(([, , level]) => level);
        expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('all ids start with "editor:set-heading-"', () => {
        for (const [id] of HEADING_COMMANDS) {
            expect(id).toMatch(/^editor:set-heading-/);
        }
    });

    it("every entry is a [id, name, level] tuple", () => {
        for (const entry of HEADING_COMMANDS) {
            expect(entry).toHaveLength(3);
            expect(typeof entry[0]).toBe("string");
            expect(typeof entry[1]).toBe("string");
            expect(typeof entry[2]).toBe("number");
        }
    });
});

// ---------------------------------------------------------------------------
// getBuiltinCommands
// ---------------------------------------------------------------------------
describe("getBuiltinCommands", () => {
    let dispatchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        dispatchSpy = vi.spyOn(document, "dispatchEvent");
    });

    it("returns 30 commands total (21 editor + 6 heading + 3 app)", () => {
        const commands = getBuiltinCommands();
        expect(commands).toHaveLength(30);
    });

    it("every command has id, name, and callback", () => {
        const commands = getBuiltinCommands();
        for (const cmd of commands) {
            expect(typeof cmd.id).toBe("string");
            expect(cmd.id.length).toBeGreaterThan(0);
            expect(typeof cmd.name).toBe("string");
            expect(cmd.name.length).toBeGreaterThan(0);
            expect(typeof cmd.callback).toBe("function");
        }
    });

    it('editor commands dispatch "mindzj:editor-command" with correct command detail', () => {
        const commands = getBuiltinCommands();
        // Find a known editor command
        const boldCmd = commands.find((c) => c.id === "editor:toggle-bold");
        expect(boldCmd).toBeDefined();

        boldCmd!.callback!();

        expect(dispatchSpy).toHaveBeenCalledOnce();
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe("mindzj:editor-command");
        expect(event.detail).toEqual({ command: "bold" });
    });

    it('heading commands dispatch "mindzj:editor-command" with heading + level detail', () => {
        const commands = getBuiltinCommands();
        const h3Cmd = commands.find((c) => c.id === "editor:set-heading-3");
        expect(h3Cmd).toBeDefined();

        h3Cmd!.callback!();

        expect(dispatchSpy).toHaveBeenCalledOnce();
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe("mindzj:editor-command");
        expect(event.detail).toEqual({ command: "heading", level: 3 });
    });

    it('sidebar commands dispatch "mindzj:app-command"', () => {
        const commands = getBuiltinCommands();
        const leftCmd = commands.find(
            (c) => c.id === "app:toggle-left-sidebar",
        );
        expect(leftCmd).toBeDefined();

        leftCmd!.callback!();

        expect(dispatchSpy).toHaveBeenCalledOnce();
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe("mindzj:app-command");
        expect(event.detail).toEqual({ command: "toggle-left-sidebar" });
    });
});

// ---------------------------------------------------------------------------
// installPluginHotkeys
// ---------------------------------------------------------------------------
describe("installPluginHotkeys", () => {
    let addSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        pluginCommandRegistry.clear();
        _resetPluginHotkeysInstalled();
        addSpy = vi.spyOn(document, "addEventListener");

        // We need executeCommandById — it is re-exported or we call via runPluginCommand
        // For testing installPluginHotkeys we verify the listener registration and behavior
        // by capturing the handler that installPluginHotkeys registers.
    });

    it("registers a keydown listener on document (capture phase)", () => {
        installPluginHotkeys();
        expect(addSpy).toHaveBeenCalledWith(
            "keydown",
            expect.any(Function),
            true, // capture phase
        );
    });

    it("only registers once (idempotent)", () => {
        installPluginHotkeys();
        installPluginHotkeys();
        // Should have only one keydown listener from installPluginHotkeys
        const keydownCalls = addSpy.mock.calls.filter(
            ([type]) => type === "keydown",
        );
        expect(keydownCalls).toHaveLength(1);
    });
});
