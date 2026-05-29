/**
 * Z-index layer tokens. Use these instead of inline magic numbers.
 *
 * Layers (low → high):
 *   Z_STATIC          — elements within a positioned container
 *   Z_BASE            — floating UI within a view (tooltips, badges)
 *   Z_DROPDOWN        — dropdowns, popovers
 *   Z_OVERLAY         — full-view overlays (modals, palettes)
 *   Z_CONTEXT_MENU    — context menus, floating toolbars
 *   Z_PLUGIN_DRAW     — plugin draw overlays (menu backdrops)
 *   Z_SCREENSHOT_CONTEXT — screenshot context menu
 *   Z_MODAL           — confirmation dialogs
 *   Z_SCREENSHOT      — screenshot capture overlay
 *   Z_SCREENSHOT_UI   — screenshot toolbar/handles
 *   Z_SCREENSHOT_DRAW — screenshot text input
 *   Z_TOOLTIP         — tooltips above everything
 */

export const Z_STATIC = "3";
export const Z_BASE = "100";
export const Z_DROPDOWN = "1000";
export const Z_OVERLAY = "9999";
export const Z_CONTEXT_MENU = "10000";
export const Z_PLUGIN_DRAW = "10001";
export const Z_SCREENSHOT_CONTEXT = "10002";
export const Z_MODAL = "20000";
export const Z_SCREENSHOT = "99999";
export const Z_SCREENSHOT_UI = "100000";
export const Z_SCREENSHOT_DRAW = "100001";
export const Z_TOOLTIP = "2147483646";
export const Z_TOOLTIP_TOP = "2147483647";
