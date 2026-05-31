// Pure keyboard utility functions extracted from useKeyboardShortcuts.ts
// for independent testability.

const _isMacPlatform =
    typeof navigator !== "undefined" && /mac|iphone|ipod|ipad/i.test(
        typeof navigator !== "undefined" ? navigator.platform : "",
    );

export function normalizeHotkeyKey(key: string): string {
    const normalized = key.length === 1 ? key.toUpperCase() : key;
    if (normalized === "+" || normalized === "ADD" || normalized === "Plus")
        return "=";
    if (normalized === "SUBTRACT" || normalized === "Minus") return "-";
    if (normalized === "ArrowLeft") return "Left";
    if (normalized === "ArrowRight") return "Right";
    if (normalized === "ArrowUp") return "Up";
    if (normalized === "ArrowDown") return "Down";
    if (normalized === " ") return "Space";
    return normalized;
}

/** Returns true when the primary "Ctrl-like" modifier is held. */
export function isCtrlHeld(e: KeyboardEvent): boolean {
    if (_isMacPlatform) return e.ctrlKey || e.metaKey;
    return e.ctrlKey && !e.metaKey;
}

/**
 * Match a KeyboardEvent against a hotkey combo string like "Alt+G", "Ctrl+Shift+S".
 */
export function matchesHotkey(e: KeyboardEvent, combo: string): boolean {
    const parts = combo.split("+");
    const keyPart = parts[parts.length - 1];
    const needCtrl = parts.includes("Ctrl");
    const needShift = parts.includes("Shift");
    const needAlt = parts.includes("Alt");
    const needMeta = parts.includes("Meta");

    const ctrlHeld = _isMacPlatform ? e.ctrlKey || e.metaKey : e.ctrlKey;
    if (needCtrl !== ctrlHeld) return false;
    if (needShift !== e.shiftKey) return false;
    if (needAlt !== e.altKey) return false;
    if (!_isMacPlatform && !needMeta && e.metaKey) return false;
    if (needMeta && !e.metaKey) return false;

    const eventKey = normalizeHotkeyKey(e.key);
    const comboKey = normalizeHotkeyKey(keyPart);
    return eventKey === comboKey;
}

export function isArrowKeyEvent(e: KeyboardEvent): boolean {
    return (
        e.code === "ArrowUp" ||
        e.code === "ArrowDown" ||
        e.code === "ArrowLeft" ||
        e.code === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "Up" ||
        e.key === "Down" ||
        e.key === "Left" ||
        e.key === "Right"
    );
}

export function getTabSwitchDirectionFromEvent(
    e: KeyboardEvent,
): "prev" | "next" | null {
    const isLeft =
        e.code === "ArrowLeft" ||
        e.key === "ArrowLeft" ||
        e.key === "Left";
    const isRight =
        e.code === "ArrowRight" ||
        e.key === "ArrowRight" ||
        e.key === "Right";
    const isTabSwitchHotkey =
        isCtrlHeld(e) &&
        (isLeft || isRight) &&
        ((e.shiftKey && !e.altKey) || (e.altKey && !e.shiftKey));

    if (!isTabSwitchHotkey) return null;
    return isLeft ? "prev" : "next";
}
