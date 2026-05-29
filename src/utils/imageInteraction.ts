import { IMAGE_RESIZE_DEBOUNCE_MS } from "../constants/timeouts";

/**
 * Image interaction utilities for MindZJ
 *
 * Provides:
 * - Alt+mousewheel zoom on images (configurable modifier key)
 * - Ctrl+click behavior (open in new tab / default app / explorer)
 * - Resize presets for the right-click context menu
 *
 * Works in both LivePreview and ReadingView.
 *
 * SCROLL BUG FIX: The wheel handler is attached directly to each <img>
 * element (NOT the scroll container). This ensures that Chrome's scroll
 * compositor optimization is only disabled for events whose target is an
 * image — all other wheel events go through the fast compositor path.
 *
 * Additionally:
 * - We NEVER call stopPropagation() — CodeMirror always sees the event
 *   and can update its internal scroll-position bookkeeping.
 * - DOM changes (image width) are batched via requestAnimationFrame so
 *   a rapid stream of wheel events doesn't overwhelm CM6's layout.
 */

import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "../stores/settings";
import { openFileRouted } from "./openFileRouted";
import { t } from "../i18n";
import { Z_PLUGIN_DRAW, Z_SCREENSHOT_CONTEXT } from "@/constants/zIndex";
import { copyToClipboard } from "./clipboard";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the comma-separated resize options string into an array of labels */
export function parseResizeOptions(optStr: string): string[] {
  return optStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Check if the modifier key for the given event matches the configured key */
function isModifierPressed(e: WheelEvent | MouseEvent, key: string): boolean {
  switch (key) {
    case "Alt":
      return e.altKey;
    case "Ctrl":
      return e.ctrlKey || e.metaKey;
    case "Shift":
      return e.shiftKey;
    default:
      return e.altKey;
  }
}

/**
 * Get the natural (intrinsic) width of an image. Falls back to rendered
 * width if naturalWidth is unavailable (e.g. image not yet fully loaded).
 */
function getNaturalWidth(img: HTMLImageElement): number {
  return img.naturalWidth || img.offsetWidth || 400;
}

/** Resolve image vault-relative path from raw markdown src */
function resolveImagePath(
  imageSrc: string,
  currentFilePath: string,
): string {
  let imgPath = imageSrc;
  if (imgPath.startsWith("./") || imgPath.startsWith("../")) {
    const dir = currentFilePath.includes("/")
      ? currentFilePath.split("/").slice(0, -1).join("/")
      : "";
    const parts = (dir ? dir + "/" + imgPath : imgPath).split("/");
    const resolved: string[] = [];
    for (const p of parts) {
      if (p === "..") resolved.pop();
      else if (p !== ".") resolved.push(p);
    }
    imgPath = resolved.join("/");
  }
  if (imgPath.startsWith("/")) imgPath = imgPath.slice(1);
  return imgPath;
}

// ---------------------------------------------------------------------------
// Mousewheel zoom — per-image listener with RAF throttle
// ---------------------------------------------------------------------------

/**
 * Options for `attachWheelZoom`.
 */
export interface AttachWheelZoomOptions {
    /**
     * Called each time the handler commits a new width (once per
     * rAF tick, NOT per wheel event). Used to persist the size to
     * the markdown source so it survives reloads. The caller is
     * responsible for finding the right image in the source and
     * rewriting its alt suffix — this library doesn't know what
     * source positions mean.
     *
     * The callback is debounced INTERNALLY by the rAF batching —
     * spinning the wheel fires at most ~60 onResize calls/second.
     * Callers that want to debounce further (e.g. only persist
     * after the user stops wheeling) should layer their own
     * `setTimeout` on top.
     */
    onResize?: (newWidth: number) => void;
}

/**
 * Attach a wheel listener to an individual <img> element.
 *
 * Key design decisions that fix the scroll bug:
 *
 *  1. The listener lives on the <img>, NOT on the scroll container.
 *     Chrome's compositor can therefore fast-path all wheel events
 *     that don't target an image — normal scrolling stays buttery
 *     smooth regardless of how many images are on the page.
 *
 *  2. We never call `stopPropagation()`. CodeMirror's own scroll
 *     handler still sees the event. Since `defaultPrevented` is true,
 *     CM6 doesn't actually scroll but it DOES update its internal
 *     scroll-position tracking — preventing the "stale viewport"
 *     de-sync that caused subsequent scrolling to glitch.
 *
 *  3. DOM mutations (img.style.width) are batched via rAF so that a
 *     fast scroll wheel doesn't force synchronous layout on every
 *     single wheel tick.
 *
 *  4. `opts.onResize` is called with the new committed width after
 *     each rAF batch — the caller can persist the size to the
 *     markdown source. A separate debounce layer lives on top so
 *     we only actually write to disk once the wheel stops.
 *
 * Returns a cleanup function to remove the listener.
 */
export function attachWheelZoom(
  img: HTMLImageElement,
  opts: AttachWheelZoomOptions = {},
): (() => void) | null {
  const s = settingsStore.settings();
  if (!s.image_wheel_zoom) return null;

  let rafId = 0;
  let pendingDelta = 0;
  // Debounce the onResize persistence so a rapid wheel spin
  // doesn't fire 60 source-edits per second. We commit the size
  // to the source ~200ms after the last wheel event.
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCommittedWidth = 0;

  function handler(e: WheelEvent) {
    const settings = settingsStore.settings();
    if (!settings.image_wheel_zoom) return;
    if (!isModifierPressed(e, settings.image_wheel_modifier)) return;

    // Prevent the scroll — but do NOT stopPropagation.
    e.preventDefault();

    // Accumulate delta and batch the DOM write into one rAF frame.
    pendingDelta += e.deltaY;
    if (rafId) return; // already scheduled

    rafId = requestAnimationFrame(() => {
      rafId = 0;
      const delta = pendingDelta;
      pendingDelta = 0;

      const step = settings.image_wheel_zoom_step / 100;
      const invert = settings.image_wheel_invert;
      const direction = invert
        ? (delta > 0 ? 1 : -1)
        : (delta > 0 ? -1 : 1);

      const currentWidth =
        img.style.width && img.style.width.endsWith("px")
          ? parseFloat(img.style.width)
          : img.offsetWidth || getNaturalWidth(img);

      const newWidth = Math.max(
        20,
        Math.round(currentWidth * (1 + direction * step)),
      );
      img.style.width = newWidth + "px";
      img.style.height = "auto";
      img.setAttribute("data-ppi-wheel-inline-width", String(newWidth));
      lastCommittedWidth = newWidth;

      // Schedule a debounced persist. We ALWAYS reset the timer
      // on every rAF tick so a continuous wheel spin keeps
      // deferring the commit until the user lets go.
      if (opts.onResize) {
        if (persistTimer) clearTimeout(persistTimer);
        persistTimer = setTimeout(() => {
          persistTimer = null;
          opts.onResize!(lastCommittedWidth);
        }, IMAGE_RESIZE_DEBOUNCE_MS);
      }
    });
  }

  img.addEventListener("wheel", handler, { passive: false });

  return () => {
    img.removeEventListener("wheel", handler);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
  };
}

// ---------------------------------------------------------------------------
// Ctrl + click behavior
// ---------------------------------------------------------------------------

/**
 * Attach a click listener that handles Ctrl+click on the image
 * according to user settings.
 *
 * Returns a cleanup function.
 */
export function attachCtrlClick(
  img: HTMLImageElement,
  imageSrc: string,
  currentFilePath: string,
): (() => void) | null {
  function handler(e: MouseEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();

    const settings = settingsStore.settings();
    const imgPath = resolveImagePath(imageSrc, currentFilePath);

    switch (settings.image_ctrl_click) {
      case "open-in-default-app":
        invoke("open_in_default_app", { relativePath: imgPath }).catch(
          (err) => console.warn("[ImageCtrlClick] open_in_default_app:", err),
        );
        break;
      case "show-in-explorer":
        invoke("reveal_in_file_manager", { relativePath: imgPath }).catch(
          (err) => console.warn("[ImageCtrlClick] reveal_in_file_manager:", err),
        );
        break;
      case "open-in-new-tab":
      default:
        void openFileRouted(imgPath);
        break;
    }
  }

  img.addEventListener("click", handler);
  return () => img.removeEventListener("click", handler);
}

// ---------------------------------------------------------------------------
// Resize presets — context menu integration
// ---------------------------------------------------------------------------

/**
 * Apply a resize preset to an image element.
 * Supports:
 * - Percentage values like "50%" — relative to natural width
 * - Pixel values like "600px" — absolute pixel width
 *
 * If `onResize` is provided it's called once with the committed
 * pixel width so the caller can persist the size to the markdown
 * source (same path as the wheel-zoom persistence).
 */
export function applyResizePreset(
  img: HTMLImageElement,
  preset: string,
  onResize?: (newWidth: number) => void,
) {
  const trimmed = preset.trim();
  let newWidth: number;

  if (trimmed.endsWith("%")) {
    const pct = parseFloat(trimmed) / 100;
    newWidth = Math.round(getNaturalWidth(img) * pct);
  } else if (trimmed.endsWith("px")) {
    newWidth = parseInt(trimmed);
  } else {
    newWidth = parseInt(trimmed);
    if (isNaN(newWidth)) return;
  }

  if (isNaN(newWidth) || newWidth < 10) return;

  img.style.width = newWidth + "px";
  img.style.height = "auto";
  img.setAttribute("data-ppi-wheel-inline-width", String(newWidth));
  if (onResize) onResize(newWidth);
}

/**
 * Build an array of resize preset menu item configs to be added
 * to the image context menu.
 */
export function getResizePresets(): string[] {
  const s = settingsStore.settings();
  return parseResizeOptions(s.image_resize_options);
}

// ---------------------------------------------------------------------------
// Image context menu
// ---------------------------------------------------------------------------

/**
 * Show a right-click context menu on an image with options to:
 * - Delete image from note and from vault storage
 * - Open image in default app
 * - Show image in file manager
 * - Copy image path
 */
export function showImageContextMenu(
    e: MouseEvent,
    imageSrc: string,
    currentFilePath: string,
    imgElement?: HTMLImageElement,
    // Optional persister called after the resize preset runs --
    // lets the caller write the new width back into the markdown
    // source so it survives across reloads. Passed by both the
    // live-preview ImageWidget AND the reading-view image post-
    // processor; if it's omitted the DOM change is ephemeral and
    // lost on the next render.
    onResize?: (newWidth: number) => void,
) {
    // Remove any existing context menu
    document
        .querySelectorAll(".mz-image-context-menu")
        .forEach((el) => el.remove());

    const menu = document.createElement("div");
    menu.className = "mz-image-context-menu";
    Object.assign(menu.style, {
        position: "fixed",
        zIndex: Z_SCREENSHOT_CONTEXT,
        background: "var(--mz-bg-secondary, #2b2b2b)",
        border: "1px solid var(--mz-border-strong, #555)",
        borderRadius: "6px",
        padding: "4px 0",
        minWidth: "180px",
        maxWidth: "320px",
        boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
        fontSize: "13px",
        color: "var(--mz-text-primary, #ccc)",
        fontFamily: "var(--mz-font-sans, system-ui)",
        userSelect: "none",
    });

    function addMenuItem(
        label: string,
        onClick: () => void,
        opts?: { danger?: boolean },
    ) {
        const item = document.createElement("div");
        Object.assign(item.style, {
            padding: "6px 16px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            transition: "background 80ms",
            color: opts?.danger ? "var(--mz-error, #e06c75)" : "inherit",
        });
        item.textContent = label;
        item.addEventListener("mouseenter", () => {
            item.style.background = "var(--mz-bg-hover, #333)";
        });
        item.addEventListener("mouseleave", () => {
            item.style.background = "transparent";
        });
        item.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            closeMenu();
            onClick();
        });
        menu.appendChild(item);
    }

    function addSeparator() {
        const sep = document.createElement("div");
        Object.assign(sep.style, {
            height: "1px",
            background: "var(--mz-border, #3e3e3e)",
            margin: "4px 8px",
        });
        menu.appendChild(sep);
    }

    // Resolve the image path relative to the vault
    function resolveImagePath(): string {
        let imgPath = imageSrc;
        // Handle relative paths
        if (imgPath.startsWith("./") || imgPath.startsWith("../")) {
            const dir = currentFilePath.includes("/")
                ? currentFilePath.split("/").slice(0, -1).join("/")
                : "";
            const parts = (dir ? dir + "/" + imgPath : imgPath).split("/");
            const resolved: string[] = [];
            for (const p of parts) {
                if (p === "..") resolved.pop();
                else if (p !== ".") resolved.push(p);
            }
            imgPath = resolved.join("/");
        }
        // Strip leading "/" so Rust Path::join treats it as relative to vault root
        // (on Windows, a leading "/" would make it an absolute drive-root path)
        if (imgPath.startsWith("/")) {
            imgPath = imgPath.slice(1);
        }
        return imgPath;
    }

    // -- Copy image path --
    addMenuItem(t("livePreview.copyImagePath"), () => {
        copyToClipboard(imageSrc);
    });

    // -- Open in default app --
    addMenuItem(t("livePreview.openInDefaultApp"), () => {
        invoke("open_in_default_app", {
            relativePath: resolveImagePath(),
        }).catch((err) => {
            console.warn(
                "[ImageContextMenu] Failed to open in default app:",
                err,
            );
        });
    });

    // -- Show in file manager --
    addMenuItem(t("context.showInExplorer"), () => {
        invoke("reveal_in_file_manager", {
            relativePath: resolveImagePath(),
        }).catch((err) => {
            console.warn(
                "[ImageContextMenu] Failed to reveal in file manager:",
                err,
            );
        });
    });

    // -- Resize presets --
    if (imgElement) {
        const presets = getResizePresets();
        if (presets.length > 0) {
            addSeparator();
            for (const preset of presets) {
                addMenuItem(t("livePreview.resizeTo", { preset }), () => {
                    applyResizePreset(imgElement, preset, onResize);
                });
            }
        }
    }

    addSeparator();

    // -- Delete image --
    addMenuItem(
        t("livePreview.deleteImage"),
        async () => {
            const imgPath = resolveImagePath();
            // Check if there's an active editor (live-preview/source mode)
            const hasEditor = !!(window as any).__mindzj_plugin_editor_api;
            if (hasEditor) {
                // Dispatch to Editor.tsx handler which modifies the CM6 document
                document.dispatchEvent(
                    new CustomEvent("mindzj:delete-image", {
                        detail: {
                            imageSrc,
                            imagePath: imgPath,
                            currentFilePath,
                        },
                    }),
                );
            } else {
                // Reading mode: read the file, remove the reference, write back
                try {
                    const result = await invoke<{ content: string }>(
                        "read_file",
                        { relativePath: currentFilePath },
                    );
                    const escapedSrc = imageSrc.replace(
                        /[.*+?^${}()|[\]\\]/g,
                        "\\$&",
                    );
                    const patterns = [
                        new RegExp(`!\\[[^\\]]*\\]\\(${escapedSrc}\\)\\n?`),
                        new RegExp(`!\\[\\[${escapedSrc}\\]\\]\\n?`),
                    ];
                    let newContent = result.content;
                    for (const re of patterns) {
                        const replaced = newContent.replace(re, "");
                        if (replaced !== newContent) {
                            newContent = replaced;
                            break;
                        }
                    }
                    if (newContent !== result.content) {
                        await invoke("write_file", {
                            relativePath: currentFilePath,
                            content: newContent,
                        });
                    }
                } catch (err) {
                    console.warn(
                        "[ImageContextMenu] Failed to update file:",
                        err,
                    );
                }
            }
            // Delete the image file from the vault
            invoke("delete_file", { relativePath: imgPath }).catch((err) => {
                console.warn("[ImageContextMenu] Failed to delete image:", err);
            });
        },
        { danger: true },
    );

    // Position menu at mouse cursor, clamped within viewport
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const x = Math.min(e.clientX, window.innerWidth - rect.width - 8);
    const y = Math.min(e.clientY, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(0, x) + "px";
    menu.style.top = Math.max(0, y) + "px";

    // Backdrop to close menu on outside click
    const backdrop = document.createElement("div");
    Object.assign(backdrop.style, {
        position: "fixed",
        inset: "0",
        zIndex: Z_PLUGIN_DRAW,
        background: "transparent",
    });

    function closeMenu() {
        menu.remove();
        backdrop.remove();
    }

    backdrop.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        closeMenu();
    });
    backdrop.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        closeMenu();
    });
    document.body.appendChild(backdrop);
}

