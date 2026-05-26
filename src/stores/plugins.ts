import { createSignal, createRoot } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { vaultStore } from "./vault";
import {
    installObsidianDomExtensions,
    createObsidianShim,
    createAppObject,
} from "../plugin-shim";
import {
    type PluginCommand,
    type CommandEntry,
    getBuiltinCommands,
    installPluginHotkeys,
    uninstallPluginHotkeys,
    pluginCommandRegistry,
    getCurrentEditorCompat,
    getCurrentMarkdownViewCompat,
    getAllCommands,
    getCommandMap,
    executeCommandById,
} from "../plugin-shim/commands";

function getScopedPluginLocalStorageKey(pluginId: string, key: string) {
    const vaultScope = encodeURIComponent(
        (vaultStore.vaultInfo()?.path ?? "__no_vault__").replace(/\\/g, "/"),
    );
    return `mindzj-vault-${vaultScope}-plugin-${pluginId}-${key}`;
}
export { getScopedPluginLocalStorageKey };

// Plugin data directory map — re-exported from standalone module
import {
    getPluginDataDir,
    setPluginDataDir,
    deletePluginDataDir,
    getAllPluginDataDirs,
} from "../plugin-shim/plugin-data-dir";
export { getPluginDataDir, setPluginDataDir, deletePluginDataDir, getAllPluginDataDirs };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
}
export type { PluginManifest };

interface PluginInfo {
    manifest: PluginManifest;
    enabled: boolean;
    has_styles: boolean;
    dir_path: string;
}

export interface LoadedPlugin {
    id: string;
    manifest: PluginManifest;
    styleEl: HTMLStyleElement | null;
    instance: any;
}


// Module-level getter wired by createPluginStore, used by mountPluginView
let _getLoadedPlugins: () => LoadedPlugin[] = () => [];

// Re-export command-related items from commands.ts for backward compatibility
export { pluginCommandRegistry };
export { getCurrentEditorCompat };
export { getCurrentMarkdownViewCompat };
export { getAllCommands };
export { getCommandMap };
export { executeCommandById };

export function listPluginCommands(): Array<{
    id: string;
    name: string;
    hotkeys?: Array<{ modifiers?: string[]; key?: string }>;
}> {
    return getAllCommands().map((cmd) => ({
        id: cmd.id,
        name: cmd.name,
        hotkeys: cmd.hotkeys,
    }));
}

export async function runPluginCommand(commandId: string): Promise<boolean> {
    return executeCommandById(commandId);
}


// ---------------------------------------------------------------------------
// Global Plugin View Registry
// ---------------------------------------------------------------------------

/** Maps viewType -> view creator function */
const pluginViewRegistry = new Map<string, (leaf: any) => any>();
export { pluginViewRegistry };

/** Maps file extension (without dot) -> viewType */
const pluginExtensionMap = new Map<string, string>();
export { pluginExtensionMap };

/**
 * Currently active plugin views keyed by a unique MOUNT HANDLE (not by
 * file path).
 *
 * Keying by file path made it impossible to mount the same file in two
 * panes of the same window — the second mount would overwrite the first
 * entry and orphan the first view's DOM. With a per-mount handle, each
 * `PluginViewHost` instance owns its own entry, so a user can split a
 * `.mindzj` tab left/right/up/down and see the same file in both panes
 * side-by-side.
 *
 * The handle is purely opaque: callers get it back from `mountPluginView`
 * and pass it to `destroyPluginView` on unmount. Anything that needs
 * "the view for this file path" (e.g. Outline) iterates values and
 * matches by `view.file?.path`.
 */
const activePluginViews = new Map<string, any>();
let activePluginViewHandle: string | null = null;
export { activePluginViews };
export function getActivePluginViewHandle(): string | null {
    return activePluginViewHandle;
}

/** Monotonic counter for generating unique mount handles. */
let _pluginMountCounter = 0;

/** Paths currently being saved by a plugin — used to suppress file-watcher reloads */
const _pluginSavingPaths = new Set<string>();
export { _pluginSavingPaths };

/** Normalize path separators for reliable comparison on Windows */
function _normPath(p: string): string {
    return p.replace(/\\/g, "/");
}
export { _normPath };

function leafForPluginView(view: any): any {
    return view?.leaf ?? { view, app: view?.app };
}
export { leafForPluginView };

function setActivePluginView(handle: string, notify: boolean): any | null {
    const view = activePluginViews.get(handle);
    if (!view) return null;

    activePluginViewHandle = handle;
    const leaf = leafForPluginView(view);

    if (view.app?.workspace) {
        view.app.workspace.activeLeaf = leaf;
    }
    if (view.plugin?.app?.workspace) {
        view.plugin.app.workspace.activeLeaf = leaf;
    }
    if (typeof view.markActive === "function") {
        try {
            view.markActive();
        } catch {}
    }

    if (notify) {
        const detail = {
            event: "active-leaf-change",
            leaf,
            filePath: view.file?.path,
            viewType: view.getViewType?.(),
        };
        document.dispatchEvent(
            new CustomEvent("mindzj:workspace-trigger", { detail }),
        );
        document.dispatchEvent(new CustomEvent("mindzj:outline-refresh"));
    }

    return view;
}

export function activatePluginView(handle: string): any | null {
    return setActivePluginView(handle, true);
}

/**
 * Check if a file is currently being saved by a plugin.
 * When true, the file-watcher should NOT reload the file because that would
 * reset in-memory plugin state (e.g., node selection after Tab key).
 */
export function isPluginSaving(path: string): boolean {
    return _pluginSavingPaths.has(_normPath(path));
}

export async function updatePluginViewsForFile(
    filePath: string,
    content: string,
    clear = true,
): Promise<void> {
    const normalized = _normPath(filePath);
    const updates: Promise<void>[] = [];
    for (const view of activePluginViews.values()) {
        if (_normPath(String(view?.file?.path ?? "")) !== normalized) continue;
        if (typeof view?.setViewData !== "function") continue;
        updates.push(
            Promise.resolve(view.setViewData(content, clear)).then(
                () => undefined,
            ),
        );
    }
    await Promise.all(updates);
}

/** Plugin setting tabs keyed by plugin id */
const pluginSettingTabs = new Map<string, any>();
export { pluginSettingTabs };

/**
 * Get the setting tab for a plugin by its id.
 */
export function getPluginSettingTab(pluginId: string): any | null {
    return pluginSettingTabs.get(pluginId) ?? null;
}

/**
 * Reactive counter — bumped every time plugins finish loading.
 * Any UI that depends on plugin registrations should read this signal
 * to re-evaluate when new plugins become available.
 */
const [pluginsVersion, setPluginsVersion] = createSignal(0);
export { pluginsVersion };

/**
 * Check if a file extension has a registered plugin view.
 */
export function hasPluginViewForExtension(ext: string): boolean {
    // Reading pluginsVersion makes this reactive — callers will
    // re-evaluate when plugins finish loading.
    pluginsVersion();
    return pluginExtensionMap.has(ext);
}

/**
 * Create and mount a plugin view for a file.
 *
 * Returns an object with the view instance and an opaque `handle` that
 * the caller MUST pass back to `destroyPluginView` on unmount. Each
 * call creates a brand-new handle so the same file can be mounted in
 * multiple panes of the same window without the views clobbering each
 * other.
 *
 * The caller is responsible for cleanup — this function does NOT
 * destroy any existing view for the same file path. That's a
 * deliberate change from the previous behaviour: when you split a
 * plugin-backed tab into two panes, the original pane's view must
 * survive the second mount.
 *
 * Returns `null` if no plugin is registered for this extension.
 */
export async function mountPluginView(
    ext: string,
    filePath: string,
    content: string,
    mountEl: HTMLElement,
): Promise<{ view: any; handle: string } | null> {
    const viewType = pluginExtensionMap.get(ext);
    if (!viewType) return null;

    const viewCreator = pluginViewRegistry.get(viewType);
    if (!viewCreator) return null;

    // Create app object for the view
    const app = createAppObject("plugin-view", undefined, executeCommandById, _getLoadedPlugins);

    // Create a leaf-like object that the plugin view receives.
    // The view's constructor (super(leaf)) will set this.leaf = leaf, this.app = leaf.app
    const leaf: any = {
        app,
        view: null as any,
        containerEl: null as any, // Will be set after view creation
        getViewState: () => ({ type: viewType, state: { file: filePath } }),
        setViewState: async () => {},
        detach: () => {},
        getDisplayText: () => filePath.split("/").pop() ?? filePath,
        getEphemeralState: () => ({}),
        setEphemeralState: () => {},
        togglePinned: () => {},
        setPinned: () => {},
        setGroup: () => {},
        setGroupMember: () => {},
        openFile: async (file: any) => {
            const path = typeof file === "string" ? file : file?.path;
            if (path) await vaultStore.openFile(path);
        },
    };

    try {
        // The view creator calls `new MindMapView(leaf, pluginInstance)`.
        // MindMapView's constructor calls `super(leaf)` which is TextFileView(leaf) -> ItemView(leaf).
        // Our ItemView constructor creates containerEl with [headerEl, contentEl] structure.
        const view = viewCreator(leaf);
        leaf.view = view;
        leaf.containerEl = view.containerEl;

        // Set the file reference (TFile-like)
        const fileName = filePath.split("/").pop() ?? filePath;
        const baseName = fileName.replace(/\.[^.]+$/, "");
        view.file = {
            path: filePath,
            name: fileName,
            basename: baseName,
            extension: ext,
            stat: {
                mtime: Date.now(),
                ctime: Date.now(),
                size: content.length,
            },
            vault: { getName: () => vaultStore.vaultInfo()?.name ?? "vault" },
            parent: {
                path: filePath.split("/").slice(0, -1).join("/") || "/",
                name: filePath.split("/").slice(-2, -1)[0] || "/",
            },
        };

        // Ensure app is available on the view
        if (!view.app) view.app = app;

        // Wire up requestSave to actually persist changes.
        // Use _pluginSaving flag to prevent the file watcher from re-loading the file
        // and resetting plugin state (e.g., node selection after Tab key).
        // Track save-in-progress count to handle rapid consecutive saves
        let _saveCounter = 0;
        const _normFilePath = _normPath(filePath);
        view.requestSave = async () => {
            try {
                const data = view.getViewData();
                if (data !== undefined && data !== null) {
                    _pluginSavingPaths.add(_normFilePath);
                    _saveCounter++;
                    const myCount = _saveCounter;
                    await vaultStore.saveFile(filePath, data);
                    // Only clear the flag if no newer save has started
                    setTimeout(() => {
                        if (_saveCounter === myCount) {
                            _pluginSavingPaths.delete(_normFilePath);
                        }
                    }, 1500);
                }
                // Notify the Outline component to refresh its tree view
                document.dispatchEvent(
                    new CustomEvent("mindzj:outline-refresh"),
                );
            } catch (e) {
                console.error("[Plugin View] requestSave error:", e);
            }
        };

        // Mount the view's containerEl into the mountEl.
        // Don't overwrite containerEl — the view's onOpen() uses containerEl.children[1] (contentEl).
        // Use flex:1 so it fills the parent flex container properly.
        Object.assign(view.containerEl.style, {
            width: "100%",
            flex: "1",
            minHeight: "0",
            position: "relative",
        });
        mountEl.appendChild(view.containerEl);

        // Register the view BEFORE lifecycle calls so that isAct() / getActiveViewOfType
        // work during onOpen() and setViewData() — the plugin's keyboard handler and
        // other guards check isAct() which queries activePluginViews.
        const handle = `${filePath}::${++_pluginMountCounter}`;
        activePluginViews.set(handle, view);
        setActivePluginView(handle, false);

        const activateMountedView = () => {
            if (activePluginViewHandle === handle) return;
            activatePluginView(handle);
        };
        mountEl.addEventListener("mousedown", activateMountedView, true);
        mountEl.addEventListener("focusin", activateMountedView, true);
        view.__mindzjActivatePluginView = activateMountedView;
        view.__mindzjActivatePluginViewMountEl = mountEl;

        // Set this leaf as the active leaf so workspace.activeLeaf is correct
        if (app.workspace) {
            app.workspace.activeLeaf = leaf;
        }

        // Lifecycle: onOpen then setViewData
        if (typeof view.onOpen === "function") {
            await view.onOpen();
        }
        if (typeof view.setViewData === "function") {
            await view.setViewData(content, true);
        }

        activatePluginView(handle);

        return { view, handle };
    } catch (e) {
        console.error("[Plugin View] Failed to create view:", e);
        return null;
    }
}

/**
 * Destroy the plugin view for the given mount HANDLE (the opaque
 * string returned by `mountPluginView`). Each `PluginViewHost` stores
 * its own handle and calls this on unmount, which keeps sibling panes
 * showing the same file untouched.
 */
export function destroyPluginView(handle: string) {
    const view = activePluginViews.get(handle);
    if (view) {
        try {
            if (typeof view.onClose === "function") view.onClose();
        } catch (e) {
            console.warn("[Plugin View] onClose error:", e);
        }
        // Remove DOM
        try {
            if (view.containerEl?.parentElement) {
                view.containerEl.remove();
            }
        } catch {}
        try {
            const activateMountedView = view.__mindzjActivatePluginView;
            const mountEl = view.__mindzjActivatePluginViewMountEl;
            if (activateMountedView && mountEl) {
                mountEl.removeEventListener(
                    "mousedown",
                    activateMountedView,
                    true,
                );
                mountEl.removeEventListener(
                    "focusin",
                    activateMountedView,
                    true,
                );
            }
        } catch {}
        activePluginViews.delete(handle);
        if (activePluginViewHandle === handle) {
            activePluginViewHandle = null;
        }
    }
}

/**
 * Get the active plugin view for a file path. If the same file is
 * mounted in multiple panes, returns the first one found. Used by
 * Outline etc. that just need "some view for this file".
 */
export function getActivePluginView(filePath: string): any | null {
    if (activePluginViewHandle) {
        const activeView = activePluginViews.get(activePluginViewHandle);
        if (activeView?.file?.path === filePath) return activeView;
    }
    for (const view of activePluginViews.values()) {
        if (view?.file?.path === filePath) return view;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Workspace Event Bridges
// ---------------------------------------------------------------------------

let _workspaceBridgesInstalled = false;
let _workspaceTriggerHandler: ((event: Event) => void) | null = null;
let _windowResizeHandler: (() => void) | null = null;
function installWorkspaceBridges() {
    if (_workspaceBridgesInstalled) return;
    _workspaceBridgesInstalled = true;

    _workspaceTriggerHandler = (event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.event !== "active-leaf-change" || detail.leaf) return;

        const activeFile = vaultStore.activeFile();
        const extension =
            activeFile?.path.split(".").pop()?.toLowerCase() ?? "";
        if (!activeFile || !pluginExtensionMap.has(extension)) {
            activePluginViewHandle = null;
            for (const view of activePluginViews.values()) {
                if (view.app?.workspace) {
                    view.app.workspace.activeLeaf = null;
                }
                if (view.plugin?.app?.workspace) {
                    view.plugin.app.workspace.activeLeaf = null;
                }
            }
        }
    };
    document.addEventListener("mindzj:workspace-trigger", _workspaceTriggerHandler);

    // Bridge window resize to workspace "resize" event
    _windowResizeHandler = () => {
        document.dispatchEvent(
            new CustomEvent("mindzj:workspace-trigger", {
                detail: { event: "resize" },
            }),
        );
    };
    window.addEventListener("resize", _windowResizeHandler);
}

export function uninstallWorkspaceBridges() {
    if (!_workspaceBridgesInstalled) return;
    if (_workspaceTriggerHandler) {
        document.removeEventListener("mindzj:workspace-trigger", _workspaceTriggerHandler);
        _workspaceTriggerHandler = null;
    }
    if (_windowResizeHandler) {
        window.removeEventListener("resize", _windowResizeHandler);
        _windowResizeHandler = null;
    }
    _workspaceBridgesInstalled = false;
}

// ---------------------------------------------------------------------------
// Plugin Store
// ---------------------------------------------------------------------------

function createPluginStore() {
    const [loadedPlugins, setLoadedPlugins] = createSignal<LoadedPlugin[]>([]);
    _getLoadedPlugins = () => loadedPlugins();
    const [loading, setLoading] = createSignal(false);

    async function loadAllPlugins(): Promise<void> {
        // Install Obsidian DOM extensions before any plugin code runs
        installObsidianDomExtensions();
        installWorkspaceBridges();
        await unloadAllPlugins();
        installPluginHotkeys();
        setLoading(true);
        try {
            const plugins = await invoke<PluginInfo[]>("list_plugins");
            const enabled = plugins.filter((p) => p.enabled);
            for (const plugin of enabled) {
                try {
                    await loadPlugin(plugin);
                } catch (e) {
                    console.error(
                        `[Plugin] Failed to load "${plugin.manifest.name}":`,
                        e,
                    );
                }
            }
        } catch (e) {
            console.error("[Plugin] Failed to list plugins:", e);
        } finally {
            setLoading(false);
            // Bump reactive version so UI re-evaluates hasPluginViewForExtension
            setPluginsVersion((v) => v + 1);
            // Notify plugins that loading is complete — fire layout-change,
            // layout-ready, and active-leaf-change so plugins can initialize
            // their UI (e.g. pixel-perfect-image attaches to images).
            setTimeout(() => {
                for (const evt of [
                    "layout-ready",
                    "layout-change",
                    "active-leaf-change",
                    "file-open",
                ]) {
                    document.dispatchEvent(
                        new CustomEvent("mindzj:workspace-trigger", {
                            detail: { event: evt },
                        }),
                    );
                }
            }, 200);
        }
    }

    async function loadPlugin(plugin: PluginInfo): Promise<void> {
        const id = plugin.manifest.id;
        let styleEl: HTMLStyleElement | null = null;
        let instance: any = null;
        const dirName =
            plugin.dir_path
                .replace(/[\\/]+$/, "")
                .split(/[\\/]/)
                .pop() ?? id;
        if (!setPluginDataDir(id, dirName)) {
            console.error(`[Plugin] Refusing to load plugin with unsafe id: ${JSON.stringify(id)}`);
            return;
        }

        // 1. Inject CSS
        if (plugin.has_styles) {
            try {
                const css = await invoke<string>("read_plugin_styles", {
                    pluginId: id,
                });
                if (css) {
                    styleEl = document.createElement("style");
                    styleEl.setAttribute("data-plugin-id", id);
                    styleEl.textContent = css;
                    document.head.appendChild(styleEl);
                }
            } catch (e) {
                console.warn(`[Plugin] CSS load failed for "${id}":`, e);
            }
        }

        // 2. Execute main.js
        try {
            const jsCode = await invoke<string>("read_plugin_main", {
                pluginId: id,
            });
            if (jsCode) {
                instance = await executePluginCode(id, jsCode, plugin.manifest);
            }
        } catch (e) {
            console.warn(`[Plugin] JS load failed for "${id}":`, e);
        }

        setLoadedPlugins((prev) => {
            const next = [
                ...prev,
                { id, manifest: plugin.manifest, styleEl, instance },
            ];
            // Expose for Outline component to find plugins with outline creators
            window.__mindzj_loadedPlugins = next;
            return next;
        });
    }

    async function executePluginCode(
        pluginId: string,
        code: string,
        manifest: PluginManifest,
    ): Promise<any> {
        // Build the Obsidian compatibility shim
        const obsidianModule = createObsidianShim(pluginId);

        const minimalRequire = (name: string) => {
            if (name === "obsidian") return obsidianModule;
            // Provide minimal Node.js module shims used by some plugins
            if (name === "path") {
                return {
                    join: (...parts: string[]) =>
                        parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
                    basename: (p: string) => p.split(/[\\/]/).pop() ?? p,
                    dirname: (p: string) => {
                        const parts = p.split(/[\\/]/);
                        parts.pop();
                        return parts.join("/") || ".";
                    },
                    extname: (p: string) => {
                        const m = p.match(/\.[^.]+$/);
                        return m ? m[0] : "";
                    },
                    resolve: (...parts: string[]) =>
                        parts.filter(Boolean).join("/").replace(/\/+/g, "/"),
                    sep: "/",
                };
            }
            if (name === "child_process") {
                return {
                    spawn: () => {
                        const noop = () => {};
                        return {
                            on: noop,
                            unref: noop,
                            stdout: null,
                            stderr: null,
                            pid: 0,
                        };
                    },
                    exec: (_cmd: string, cb?: Function) => {
                        if (cb) cb(new Error("child_process not available"));
                    },
                };
            }
            console.warn(
                `[Plugin:${pluginId}] require("${name}") — not available`,
            );
            return {};
        };

        try {
            const moduleObj = { exports: {} as any };
            const factory = new Function("module", "exports", "require", code);
            factory(moduleObj, moduleObj.exports, minimalRequire);

            const exported = moduleObj.exports;
            const PluginClass = exported?.default || exported;

            if (typeof PluginClass === "function") {
                // Create the app object the plugin receives
                const app = createAppObject(pluginId, obsidianModule, executeCommandById, () => loadedPlugins());

                // Instantiate — Obsidian plugins receive (app, manifest) in constructor
                const instance = new PluginClass(app, manifest);
                instance.app = app;
                instance.manifest = manifest;

                if (typeof instance.onload === "function") {
                    try {
                        await instance.onload();
                    } catch (loadErr) {
                        console.error(
                            `[Plugin:${pluginId}] onload() threw:`,
                            loadErr,
                        );
                        // Still return the instance — the settings tab may
                        // have been registered before the error occurred.
                    }
                }
                return instance;
            }
        } catch (e) {
            console.error(`[Plugin:${pluginId}] Execution error:`, e);
        }
        return null;
    }

    async function unloadAllPlugins(): Promise<void> {
        for (const p of loadedPlugins()) {
            try {
                if (p.instance?.onunload) await p.instance.onunload();
            } catch (e) {
                console.warn(`[Plugin] Unload error "${p.id}":`, e);
            }
            if (p.styleEl) p.styleEl.remove();
            deletePluginDataDir(p.id);
            pluginCommandRegistry.forEach((command, id) => {
                if (command.pluginId === p.id) pluginCommandRegistry.delete(id);
            });
        }
        setLoadedPlugins([]);
        // Clean up registries
        pluginViewRegistry.clear();
        pluginExtensionMap.clear();
        pluginSettingTabs.clear();
        // Entries are keyed by mount handle now, not file path, but the
        // destroy-all loop body is identical — we just need to close and
        // drop every entry regardless of what the key is.
        for (const [handle, view] of activePluginViews.entries()) {
            try {
                if (view.onClose) view.onClose();
            } catch {}
            activePluginViews.delete(handle);
        }
        uninstallPluginHotkeys();
    }

    async function unloadPlugin(pluginId: string): Promise<void> {
        const plugin = loadedPlugins().find((p) => p.id === pluginId);
        if (!plugin) return;
        try {
            if (plugin.instance?.onunload) await plugin.instance.onunload();
        } catch {}
        if (plugin.styleEl) plugin.styleEl.remove();
        deletePluginDataDir(pluginId);
        pluginSettingTabs.delete(pluginId);
        pluginCommandRegistry.forEach((command, id) => {
            if (command.pluginId === pluginId) pluginCommandRegistry.delete(id);
        });
        setLoadedPlugins((prev) => prev.filter((p) => p.id !== pluginId));
    }

    async function reloadPlugin(pluginId: string): Promise<void> {
        await unloadPlugin(pluginId);
        try {
            const plugins = await invoke<PluginInfo[]>("list_plugins");
            const plugin = plugins.find(
                (p) => p.manifest.id === pluginId && p.enabled,
            );
            if (plugin) await loadPlugin(plugin);
        } catch (e) {
            console.error(`[Plugin] Reload failed "${pluginId}":`, e);
        }
        // Bump reactive version so settings UI re-evaluates
        setPluginsVersion((v) => v + 1);
    }

    return {
        loadedPlugins,
        loading,
        loadAllPlugins,
        unloadAllPlugins,
        unloadPlugin,
        reloadPlugin,
        // Exposed so App.tsx's hotkey handler can run plugin-registered
        // commands directly (see `handleGlobalKeydown` for Alt+F /
        // Alt+A). Calling `executeCommandById` here bypasses the per-
        // plugin `mindzj:plugin-command` DOM event the timestamp
        // plugin used to listen for — that route was firing the
        // command multiple times when the plugin's instance landed
        // on the document with more than one listener attached,
        // yielding the "4 timestamps per Alt+F" bug.
        executeCommandById,
    };
}

export const pluginStore = createRoot(createPluginStore);
