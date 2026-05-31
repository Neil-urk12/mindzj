/**
 * Typed CustomEvent registry for MindZJ.
 *
 * Each event maps to a detail type. Use `dispatchTypedEvent` and
 * `listenTypedEvent` helpers for type-safe dispatch/subscribe.
 */

export interface MindZJEventMap {
    /** Open the settings modal, optionally navigating to a specific section */
    "mindzj:open-settings": { section?: string };

    /** Toggle the AI panel visibility */
    "mindzj:toggle-ai-panel": void;

    /** Force-save the current workspace */
    "mindzj:force-save": void;

    /** Execute an editor command (bold, italic, heading, etc.) */
    "mindzj:editor-command": { command: string };

    /** Trigger a workspace action (save, restore, etc.) */
    "mindzj:workspace-trigger": { action: string };

    /** Remember the active viewport scroll/cursor position */
    "mindzj:remember-active-viewport": void;

    /** Refresh the outline panel */
    "mindzj:outline-refresh": void;

    /** Toggle view mode with optional save */
    "mindzj:toggle-view-mode-with-save": { mode?: string };

    /** Set the reading find panel query */
    "mindzj:reading-find-set-query": { query?: string };

    /** Navigate to settings section */
    "mindzj:settings-navigate": { section: string };

    /** Plugin command execution */
    "mindzj:plugin-command": { commandId: string };

    /** File opened notification */
    "mindzj:file-opened": { path: string };

    /** File closed notification */
    "mindzj:file-closed": { path: string };

    /** Vault opened notification */
    "mindzj:vault-opened": { path: string };

    /** Vault closed notification */
    "mindzj:vault-closed": void;

    /** Editor view mode changed */
    "mindzj:view-mode-changed": { mode: string };

    /** Split pane created */
    "mindzj:split-created": { direction: string };

    /** Split pane closed */
    "mindzj:split-closed": { slot: string };
}

/**
 * Type-safe event dispatcher.
 */
export function dispatchTypedEvent<K extends keyof MindZJEventMap>(
    target: EventTarget,
    name: K,
    detail?: MindZJEventMap[K],
): void {
    target.dispatchEvent(
        new CustomEvent(name, {
            detail: detail ?? {},
        }),
    );
}

/**
 * Type-safe event listener.
 */
export function listenTypedEvent<K extends keyof MindZJEventMap>(
    target: EventTarget,
    name: K,
    handler: (event: CustomEvent<MindZJEventMap[K]>) => void,
    options?: AddEventListenerOptions,
): () => void {
    const wrappedHandler = (e: Event) => handler(e as CustomEvent<MindZJEventMap[K]>);
    target.addEventListener(name, wrappedHandler, options);
    return () => target.removeEventListener(name, wrappedHandler, options);
}
