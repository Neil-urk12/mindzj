// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
    normalizeHotkeyKey,
    isCtrlHeld,
    matchesHotkey,
    isArrowKeyEvent,
    getTabSwitchDirectionFromEvent,
    __setMacPlatformForTesting,
} from "./keyboardUtils";

function makeEvent(key: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
}

describe("normalizeHotkeyKey", () => {
    it("passes through single chars uppercase", () => {
        expect(normalizeHotkeyKey("a")).toBe("A");
        expect(normalizeHotkeyKey("z")).toBe("Z");
    });

    it("passes through non-single-char as-is", () => {
        expect(normalizeHotkeyKey("Escape")).toBe("Escape");
        expect(normalizeHotkeyKey("Enter")).toBe("Enter");
    });

    it("normalizes arrow keys", () => {
        expect(normalizeHotkeyKey("ArrowLeft")).toBe("Left");
        expect(normalizeHotkeyKey("ArrowRight")).toBe("Right");
        expect(normalizeHotkeyKey("ArrowUp")).toBe("Up");
        expect(normalizeHotkeyKey("ArrowDown")).toBe("Down");
    });

    it("normalizes space", () => {
        expect(normalizeHotkeyKey(" ")).toBe("Space");
    });

    it("normalizes plus/ADD to =", () => {
        expect(normalizeHotkeyKey("+")).toBe("=");
        expect(normalizeHotkeyKey("ADD")).toBe("=");
        expect(normalizeHotkeyKey("Plus")).toBe("=");
    });

    it("normalizes minus/SUBTRACT to -", () => {
        expect(normalizeHotkeyKey("-")).toBe("-");
        expect(normalizeHotkeyKey("SUBTRACT")).toBe("-");
        expect(normalizeHotkeyKey("Minus")).toBe("-");
    });
});

describe("isCtrlHeld", () => {
    beforeEach(() => __setMacPlatformForTesting(null));
    it("returns true when ctrlKey is set", () => {
        const e = makeEvent("s", { ctrlKey: true });
        expect(isCtrlHeld(e)).toBe(true);
    });

    it("returns false when no modifier", () => {
        const e = makeEvent("s");
        expect(isCtrlHeld(e)).toBe(false);
    });
});

describe("isCtrlHeld - platform-specific", () => {
    beforeEach(() => __setMacPlatformForTesting(null));

    describe("on Mac", () => {
        beforeEach(() => __setMacPlatformForTesting(true));

        it("returns true for metaKey (Cmd)", () => {
            expect(isCtrlHeld(makeEvent("s", { metaKey: true }))).toBe(true);
        });

        it("returns true for both ctrlKey and metaKey", () => {
            expect(isCtrlHeld(makeEvent("s", { ctrlKey: true, metaKey: true }))).toBe(true);
        });
    });

    describe("on Windows/Linux", () => {
        beforeEach(() => __setMacPlatformForTesting(false));

        it("returns true for ctrlKey only", () => {
            expect(isCtrlHeld(makeEvent("s", { ctrlKey: true }))).toBe(true);
        });

        it("returns false for metaKey (Win key) alone", () => {
            expect(isCtrlHeld(makeEvent("s", { metaKey: true }))).toBe(false);
        });

        it("returns false when both ctrlKey and metaKey held", () => {
            expect(isCtrlHeld(makeEvent("s", { ctrlKey: true, metaKey: true }))).toBe(false);
        });
    });
});

describe("matchesHotkey", () => {
    beforeEach(() => __setMacPlatformForTesting(null));
    it("matches simple key with no modifiers", () => {
        expect(matchesHotkey(makeEvent("a"), "a")).toBe(true);
    });

    it("rejects wrong key", () => {
        expect(matchesHotkey(makeEvent("b"), "a")).toBe(false);
    });

    it("matches Ctrl+key", () => {
        expect(matchesHotkey(makeEvent("s", { ctrlKey: true }), "Ctrl+s")).toBe(true);
    });

    it("rejects Ctrl+key when Ctrl not held", () => {
        expect(matchesHotkey(makeEvent("s"), "Ctrl+s")).toBe(false);
    });

    it("matches Ctrl+Shift+key", () => {
        expect(matchesHotkey(makeEvent("P", { ctrlKey: true, shiftKey: true }), "Ctrl+Shift+P")).toBe(true);
    });

    it("matches Alt+key", () => {
        expect(matchesHotkey(makeEvent("g", { altKey: true }), "Alt+g")).toBe(true);
    });

    it("rejects when extra modifier held", () => {
        expect(matchesHotkey(makeEvent("s", { ctrlKey: true, altKey: true }), "Ctrl+s")).toBe(false);
    });
});

describe("matchesHotkey - metaKey guard", () => {
    beforeEach(() => __setMacPlatformForTesting(null));

    describe("on Mac", () => {
        beforeEach(() => __setMacPlatformForTesting(true));

        it("matches Cmd+S as Ctrl+S", () => {
            expect(matchesHotkey(makeEvent("s", { metaKey: true }), "Ctrl+s")).toBe(true);
        });

        it("matches Meta+key when combo includes Meta", () => {
            expect(matchesHotkey(makeEvent("s", { metaKey: true }), "Meta+s")).toBe(true);
        });
    });

    describe("on Windows/Linux", () => {
        beforeEach(() => __setMacPlatformForTesting(false));

        it("rejects Win+S when combo is Ctrl+S", () => {
            expect(matchesHotkey(makeEvent("s", { metaKey: true }), "Ctrl+s")).toBe(false);
        });

        it("rejects Win+Ctrl+S when combo is Ctrl+S", () => {
            expect(matchesHotkey(makeEvent("s", { ctrlKey: true, metaKey: true }), "Ctrl+s")).toBe(false);
        });

        it("matches Meta+key when combo explicitly includes Meta", () => {
            expect(matchesHotkey(makeEvent("s", { metaKey: true }), "Meta+s")).toBe(true);
        });
    });
});

describe("isArrowKeyEvent", () => {
    it("detects ArrowLeft by key", () => {
        expect(isArrowKeyEvent(makeEvent("ArrowLeft"))).toBe(true);
    });

    it("detects ArrowRight by key", () => {
        expect(isArrowKeyEvent(makeEvent("ArrowRight"))).toBe(true);
    });

    it("detects Left shorthand", () => {
        expect(isArrowKeyEvent(makeEvent("Left"))).toBe(true);
    });

    it("detects by code", () => {
        const e = new KeyboardEvent("keydown", { code: "ArrowUp", key: "Unidentified" });
        expect(isArrowKeyEvent(e)).toBe(true);
    });

    it("rejects non-arrow key", () => {
        expect(isArrowKeyEvent(makeEvent("a"))).toBe(false);
    });
});

describe("getTabSwitchDirectionFromEvent", () => {
    it("returns next for Ctrl+Alt+ArrowRight", () => {
        const e = makeEvent("ArrowRight", { ctrlKey: true, altKey: true });
        expect(getTabSwitchDirectionFromEvent(e)).toBe("next");
    });

    it("returns prev for Ctrl+Alt+ArrowLeft", () => {
        const e = makeEvent("ArrowLeft", { ctrlKey: true, altKey: true });
        expect(getTabSwitchDirectionFromEvent(e)).toBe("prev");
    });

    it("returns null when no modifier", () => {
        expect(getTabSwitchDirectionFromEvent(makeEvent("ArrowLeft"))).toBeNull();
    });

    it("returns null for non-arrow key", () => {
        const e = makeEvent("a", { ctrlKey: true, altKey: true });
        expect(getTabSwitchDirectionFromEvent(e)).toBeNull();
    });
});

describe("keyCode/which deprecation", () => {
    it("isArrowKeyEvent returns false for keyCode-only events (no key/code)", () => {
        // keyCode 37 = left arrow, but with empty key and code
        // After keyCode removal, this should NOT be detected as arrow
        const e = new KeyboardEvent("keydown", {
            key: "",
            code: "",
            keyCode: 37,
            which: 37,
            bubbles: true,
            cancelable: true,
        } as KeyboardEventInit & { keyCode: number; which: number });
        expect(isArrowKeyEvent(e)).toBe(false);
    });

    it("getTabSwitchDirectionFromEvent returns null for keyCode-only events", () => {
        const e = new KeyboardEvent("keydown", {
            key: "",
            code: "",
            keyCode: 37,
            which: 37,
            ctrlKey: true,
            altKey: true,
            bubbles: true,
            cancelable: true,
        } as KeyboardEventInit & { keyCode: number; which: number });
        expect(getTabSwitchDirectionFromEvent(e)).toBeNull();
    });
});
