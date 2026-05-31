import type { PaneSlot, SplitDirection, ViewMode } from "../types/app";

/**
 * Type guard: check if a string is a valid ViewMode.
 */
export function isViewMode(value: string | null): value is ViewMode {
    return (
        value === "source" ||
        value === "live-preview" ||
        value === "reading"
    );
}

/**
 * Normalize a stored view mode string to a canonical ViewMode.
 */
export function resolveDefaultViewMode(
    value: string | null | undefined,
): ViewMode {
    switch (value) {
        case "Source":
        case "source":
            return "source";
        case "Reading":
        case "reading":
            return "reading";
        case "LivePreview":
        case "live-preview":
        default:
            return "live-preview";
    }
}

/**
 * Type guard: check if a value is a valid SplitDirection.
 */
export function isSplitDirection(value: unknown): value is SplitDirection {
    return (
        value === "left" ||
        value === "right" ||
        value === "up" ||
        value === "down"
    );
}

/**
 * Type guard: check if a value is a valid PaneSlot.
 */
export function isPaneSlot(value: unknown): value is PaneSlot {
    return value === "primary" || value === "secondary";
}

/**
 * Normalize a split ratio to the valid range [0.2, 0.8].
 * Returns 0.5 (default) for invalid inputs.
 */
export function normalizeSplitRatio(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.max(0.2, Math.min(0.8, value))
        : 0.5;
}
