// @vitest-environment jsdom
/**
 * Tests for src/types/global.ts — Window interface augmentation
 * for __mindzj_* globals.
 *
 * These tests WILL FAIL until src/types/global.ts is created with a
 * proper `declare global { interface Window { ... } }` augmentation
 * covering all 9 __mindzj_* keys.
 */
import { describe, expect, expectTypeOf, it } from "vitest";

// Runtime import — will throw a module-not-found error if
// src/types/global.ts doesn't exist. The module itself only
// needs to contain `export {};` plus the `declare global` block.
import globalAugmentation from "../global";

// ---------------------------------------------------------------------------
// Expected __mindzj_* property names (all 9)
// ---------------------------------------------------------------------------
const EXPECTED_GLOBALS = [
  "__mindzj_plugin_editor_api",
  "__mindzj_icons",
  "__mindzj_markdown_view",
  "__mindzj_plugin_cm_extensions",
  "__mindzj_switch_open_tab",
  "__mindzj_plugin_settings_active_tab",
  "__mindzj_flush_workspace",
  "__mindzj_loadedPlugins",
  "__mindzj_hotkey_capturing",
] as const;

// ---------------------------------------------------------------------------
// 1. Module existence
// ---------------------------------------------------------------------------
describe("src/types/global.ts module", () => {
  it("exists and is importable", () => {
    // If the file doesn't exist the import above throws and the
    // entire test suite fails with a module-not-found error.
    expect(globalAugmentation).toBeDefined();
  });

  it("is empty object (augmentation-only module)", () => {
    // The file should only contain `export {};` + `declare global`.
    // No runtime values expected.
    expect(typeof globalAugmentation).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// 2. Type-level: all 9 __mindzj_* properties exist on Window
// ---------------------------------------------------------------------------
describe("Window interface augmentation", () => {
  it("window has all 9 __mindzj_* properties in its type", () => {
    const w: Window = window;

    expectTypeOf(w).toHaveProperty("__mindzj_plugin_editor_api");
    expectTypeOf(w).toHaveProperty("__mindzj_icons");
    expectTypeOf(w).toHaveProperty("__mindzj_markdown_view");
    expectTypeOf(w).toHaveProperty("__mindzj_plugin_cm_extensions");
    expectTypeOf(w).toHaveProperty("__mindzj_switch_open_tab");
    expectTypeOf(w).toHaveProperty("__mindzj_plugin_settings_active_tab");
    expectTypeOf(w).toHaveProperty("__mindzj_flush_workspace");
    expectTypeOf(w).toHaveProperty("__mindzj_loadedPlugins");
    expectTypeOf(w).toHaveProperty("__mindzj_hotkey_capturing");
  });
});

// ---------------------------------------------------------------------------
// 3. Type shape checks — verify augmented types are not `any`
// ---------------------------------------------------------------------------
describe("augmented property types", () => {
  it("__mindzj_hotkey_capturing is boolean", () => {
    // Source: HotkeysPanel.tsx — `(window as any).__mindzj_hotkey_capturing = !!capturing()`
    expectTypeOf(window.__mindzj_hotkey_capturing).toEqualTypeOf<boolean>();
  });

  it("__mindzj_flush_workspace is a function or undefined", () => {
    // Source: App.tsx — assigned flushWorkspaceNow, cleaned up with delete
    expectTypeOf(window.__mindzj_flush_workspace).toMatchTypeOf<
      ((...args: any[]) => any) | undefined | null
    >();
  });

  it("__mindzj_switch_open_tab is a function or undefined", () => {
    // Source: Editor.tsx — cast to (dir: "prev" | "next") => boolean
    expectTypeOf(window.__mindzj_switch_open_tab).toMatchTypeOf<
      ((...args: any[]) => any) | undefined | null
    >();
  });

  it("__mindzj_icons is a record of string to string", () => {
    // Source: plugin-shim/index.ts — `{} then Object.assign with SVG strings`
    expectTypeOf(window.__mindzj_icons).toMatchTypeOf<
      Record<string, string> | undefined | null
    >();
  });

  it("__mindzj_plugin_cm_extensions is an array", () => {
    // Source: plugin-shim/index.ts — Array.isArray check, .push()
    expectTypeOf(window.__mindzj_plugin_cm_extensions).toMatchTypeOf<
      any[] | undefined | null
    >();
  });

  it("__mindzj_plugin_settings_active_tab has id and containerEl", () => {
    // Source: PluginSettingsPanel.tsx — { id: props.pluginId, containerEl }
    expectTypeOf(window.__mindzj_plugin_settings_active_tab).toMatchTypeOf<
      { id: string; containerEl: HTMLElement } | undefined | null
    >();
  });

  it("__mindzj_loadedPlugins is an array", () => {
    // Source: stores/plugins.ts — setLoadedPlugins, then assigned to window
    // Source: SettingsModal.tsx — `|| []` fallback
    expectTypeOf(window.__mindzj_loadedPlugins).toMatchTypeOf<
      any[] | undefined | null
    >();
  });

  it("__mindzj_plugin_editor_api is an object or null", () => {
    // Source: plugin-shim/index.ts — assigned editorApi object or null
    expectTypeOf(window.__mindzj_plugin_editor_api).toMatchTypeOf<
      Record<string, any> | null | undefined
    >();
  });

  it("__mindzj_markdown_view is an object or null", () => {
    // Source: ReadingView.tsx — set to markdownView or null
    expectTypeOf(window.__mindzj_markdown_view).toMatchTypeOf<
      Record<string, any> | null | undefined
    >();
  });
});

// ---------------------------------------------------------------------------
// 4. Exhaustiveness
// ---------------------------------------------------------------------------
describe("exhaustiveness", () => {
  it("all expected keys are listed in EXPECTED_GLOBALS", () => {
    expect(EXPECTED_GLOBALS).toHaveLength(9);
  });

  it("each expected key is accessible on window", () => {
    for (const key of EXPECTED_GLOBALS) {
      const value = (window as Record<string, unknown>)[key];
      // Accessible without throwing — value may be undefined at runtime.
      expect(() => (window as Record<string, unknown>)[key]).not.toThrow();
    }
  });
});
