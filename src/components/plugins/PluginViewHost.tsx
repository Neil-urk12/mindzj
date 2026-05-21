import { Component, createEffect, on, onCleanup } from "solid-js";
import {
    mountPluginView,
    destroyPluginView,
    activatePluginView,
} from "../../stores/plugins";
import { VAULT_CONFIG_DIR } from "../../constants/vaultPaths";

// Plugin View Host — renders plugin-managed views for registered extensions
// ============================================================================

export const PluginViewHost: Component<{
    filePath: string;
    content: string;
    extension: string;
    active: boolean;
}> = (props) => {
    let containerRef: HTMLDivElement | undefined;
    // Each PluginViewHost instance owns its OWN mount handle returned
    // from mountPluginView. Destroying by handle (instead of file path)
    // means that if the same file is mounted in another pane, this
    // pane's cleanup won't clobber that other pane.
    let currentPath: string | null = null;
    let currentHandle: string | null = null;
    const isMindzjInternalFile = () =>
        props.filePath.startsWith(`${VAULT_CONFIG_DIR}/`) ||
        props.filePath.includes(`/${VAULT_CONFIG_DIR}/`);

    // Only track path changes — ignore content changes.
    // Content changes from plugin saves must NOT trigger re-mount, because
    // setViewData(data, true) resets the plugin's selection to the root node.
    createEffect(
        on(
            () => props.filePath,
            async (path) => {
                if (!containerRef || !path) return;
                if (path !== currentPath) {
                    // Destroy THIS pane's previous view (if any) — by handle,
                    // so a sibling pane showing the same file is unaffected.
                    if (currentHandle) destroyPluginView(currentHandle);
                    // Clear container
                    containerRef.innerHTML = "";
                    currentPath = path;
                    currentHandle = null;
                    // Use current content from props at mount time
                    const mounted = await mountPluginView(
                        props.extension,
                        path,
                        props.content,
                        containerRef,
                    );
                    if (mounted) currentHandle = mounted.handle;
                }
            },
        ),
    );

    createEffect(() => {
        if (props.active && currentHandle) {
            activatePluginView(currentHandle);
        }
    });

    onCleanup(() => {
        if (currentHandle) destroyPluginView(currentHandle);
    });

    return (
        <div
            ref={containerRef}
            on:contextmenu={(event: MouseEvent) => {
                if (!isMindzjInternalFile()) return;
                const target = event.target as HTMLElement | null;
                if (
                    target?.closest(
                        "button, [role='button'], [role='toolbar'], .clickable-icon, .view-header, .mod-toolbar",
                    )
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }}
            style={{
                flex: "1",
                overflow: "hidden",
                width: "100%",
                height: "100%",
                position: "relative",
                // Ensure the plugin container fills all available space and
                // doesn't interfere with the plugin's own event handling.
                display: "flex",
                "flex-direction": "column",
            }}
        />
    );
};
