/**
 * Timeout and boundary constants extracted from magic numbers.
 */

// ── Zoom bounds (editor.ts) ──
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;

// ── Auto-save bounds (editor.ts) ──
export const AUTO_SAVE_MIN_MS = 500;
export const AUTO_SAVE_MAX_MS = 30000;

// ── File tree (vault.ts) ──
export const FILE_TREE_MAX_DEPTH = 10;

// ── Search (handlers.ts) ──
export const SEARCH_RESULT_LIMIT = 20;

// ── AI tokens (anthropic.ts) ──
export const AI_MAX_TOKENS = 4096;

// ── UI timeouts ──
export const SHORTCUT_TOAST_DISMISS_MS = 1200;
export const SCROLL_THROTTLE_MS = 80;
export const READING_SCROLL_THROTTLE_MS = 60;
export const SEARCH_FLASH_MS = 1000;
export const OUTLINE_FLASH_MS = 1000;
export const READING_FLASH_MS = 1500;
export const FILE_TREE_REVEAL_MS = 1500;
export const FOLDER_STATE_SAVE_DEBOUNCE_MS = 1000;
export const TAB_TOOLTIP_DELAY_MS = 1000;
export const WORKSPACE_SAVE_DEBOUNCE_MS = 1000;
export const WINDOW_SAVE_DEBOUNCE_MS = 500;
export const NOTICE_FADE_MS = 300;
export const NOTICE_DISMISS_MS = 4000;
export const IMAGE_RESIZE_DEBOUNCE_MS = 200;
