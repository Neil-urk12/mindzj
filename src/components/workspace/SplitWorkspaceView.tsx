import { Component, Show, createMemo } from "solid-js";
import type { SplitDirection, PaneSlot } from "../../types/app";
import { vaultStore } from "../../stores/vault";
import { editorStore } from "../../stores/editor";
import { hasPluginViewForExtension } from "../../stores/plugins";
import { Editor } from "../editor/Editor";
import { ReadingView } from "../editor/ReadingView";
import { FilePreview } from "../common/FilePreview";
import { PluginViewHost } from "../plugins/PluginViewHost";
import { t } from "../../i18n";

export const SplitWorkspaceView: Component<{
    primaryPath: string | null;
    secondaryPath: string | null;
    activeSlot: PaneSlot;
    direction: SplitDirection;
    splitRatio: number;
    onActivatePane: (slot: PaneSlot) => void;
    onClosePane: (slot: PaneSlot) => void;
    onSplitRatioChange: (ratio: number) => void;
}> = (props) => {
    let containerRef: HTMLDivElement | undefined;
    const isSplit = createMemo(() => !!props.secondaryPath);
    const flexDirection = createMemo(() =>
        props.direction === "up" || props.direction === "down"
            ? "column"
            : "row",
    );
    const isHorizontalSplit = createMemo(() => flexDirection() === "row");
    const dividerThickness = 2;
    const dividerStyle = createMemo(() =>
        isHorizontalSplit()
            ? {
                  width: `${dividerThickness}px`,
                  height: "100%",
                  cursor: "col-resize",
              }
            : {
                  width: "100%",
                  height: `${dividerThickness}px`,
                  cursor: "row-resize",
              },
    );
    // When non-split, the primary pane absorbs the whole container so
    // the fallback layout (single pane at 100%) looks identical to the
    // previous `<Show fallback=…>` structure — except we keep the split
    // container mounted so flipping `isSplit()` never unmounts the
    // primary `<PaneFileView>`. Remounting was the source of the first-
    // time "Split right" lag: it tore down the already-warm CM6 editor
    // and rebuilt it from cold, on top of spinning up the secondary
    // editor.
    const paneStyle = (slot: PaneSlot) => {
        if (!isSplit()) {
            if (slot === "primary") {
                return {
                    flex: "1 1 0",
                    "min-width": "0",
                    "min-height": "0",
                    display: "flex",
                } as const;
            }
            return {
                flex: "0 0 0",
                "min-width": "0",
                "min-height": "0",
                display: "none",
            } as const;
        }
        return {
            flex: `${slot === "primary" ? props.splitRatio : 1 - props.splitRatio} 1 0`,
            "min-width": "0",
            "min-height": "0",
            display: "flex",
        } as const;
    };

    const startDividerDrag = (event: MouseEvent) => {
        event.preventDefault();
        if (!containerRef) return;

        const updateRatio = (clientX: number, clientY: number) => {
            const rect = containerRef!.getBoundingClientRect();
            const size = isHorizontalSplit() ? rect.width : rect.height;
            if (!size) return;
            const offset = isHorizontalSplit()
                ? clientX - rect.left
                : clientY - rect.top;
            const nextRatio = Math.max(0.2, Math.min(0.8, offset / size));
            props.onSplitRatioChange(nextRatio);
        };

        updateRatio(event.clientX, event.clientY);
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = isHorizontalSplit()
            ? "col-resize"
            : "row-resize";
        document.body.style.userSelect = "none";

        const onMove = (moveEvent: MouseEvent) => {
            updateRatio(moveEvent.clientX, moveEvent.clientY);
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = previousCursor;
            document.body.style.removeProperty("user-select");
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    };

    return (
        <Show
            when={props.primaryPath}
            fallback={
                <div
                    style={{
                        flex: "1",
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "center",
                        color: "var(--mz-text-muted)",
                        "font-size": "var(--mz-font-size-sm)",
                    }}>
                    {t("app.openFileOrSearch")}
                </div>
            }>
            {/* Always-mounted split container. The primary PaneFileView
                lives inside it regardless of whether the user is in
                split mode — toggling `isSplit()` only adds/removes the
                divider + secondary pane. This prevents the primary
                Editor from being remounted on first "Split right",
                which used to rebuild CodeMirror from cold (the source
                of the several-hundred-millisecond freeze). */}
            <div
                ref={containerRef}
                style={{
                    flex: "1",
                    display: "flex",
                    "flex-direction": flexDirection(),
                    "min-width": "0",
                    "min-height": "0",
                    overflow: "hidden",
                    background: "var(--mz-bg-primary)",
                }}>
                <div
                    class={
                        isSplit()
                            ? "mz-pane-wrap mz-pane-wrap-primary"
                            : "mz-pane-wrap mz-pane-wrap-primary mz-pane-wrap-solo"
                    }
                    style={paneStyle("primary")}>
                    <PaneFileView
                        filePath={props.primaryPath!}
                        active={!isSplit() || props.activeSlot === "primary"}
                        split={isSplit()}
                        onActivate={() => props.onActivatePane("primary")}
                        onClose={
                            isSplit()
                                ? () => props.onClosePane("primary")
                                : undefined
                        }
                    />
                </div>
                <Show when={isSplit()}>
                    <div
                        onMouseDown={startDividerDrag}
                        style={{
                            ...dividerStyle(),
                            background: "var(--mz-border)",
                            "flex-shrink": "0",
                            position: "relative",
                        }}
                    />
                    <div
                        class="mz-pane-wrap mz-pane-wrap-secondary"
                        style={paneStyle("secondary")}>
                        <PaneFileView
                            filePath={props.secondaryPath!}
                            active={props.activeSlot === "secondary"}
                            split={true}
                            onActivate={() => props.onActivatePane("secondary")}
                            onClose={() => props.onClosePane("secondary")}
                        />
                    </div>
                </Show>
            </div>
        </Show>
    );
};

const PaneFileView: Component<{
    filePath: string;
    active: boolean;
    split: boolean;
    onActivate: () => void;
    onClose?: () => void;
}> = (props) => {
    const file = createMemo(
        () =>
            vaultStore
                .openFiles()
                .find((entry) => entry.path === props.filePath) ??
            (vaultStore.activeFile()?.path === props.filePath
                ? vaultStore.activeFile()
                : null),
    );
    const fileExt = createMemo(
        () => props.filePath.split(".").pop()?.toLowerCase() ?? "",
    );
    const isPluginView = createMemo(() => hasPluginViewForExtension(fileExt()));
    const viewMode = createMemo(() =>
        editorStore.getViewModeForFile(props.filePath),
    );
    const title = createMemo(
        () => props.filePath.split("/").pop() ?? props.filePath,
    );
    const previewKind = createMemo<"image" | "document" | null>(() => {
        if (file()?.kind === "image") return "image";
        if (file()?.kind === "document") return "document";
        return null;
    });

    return (
        <div
            class="mz-split-pane"
            onMouseDown={() => props.onActivate()}
            onFocusIn={() => props.onActivate()}
            style={{
                flex: "1",
                display: "flex",
                "flex-direction": "column",
                "min-width": "0",
                "min-height": "0",
                overflow: "hidden",
                background: "var(--mz-bg-primary)",
                "box-shadow":
                    props.split && props.active
                        ? "inset 0 0 0 1px var(--mz-accent)"
                        : "none",
            }}>
            <Show when={props.split}>
                <div
                    style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "8px",
                        height: "30px",
                        padding: "0 10px",
                        background: props.active
                            ? "var(--mz-bg-tertiary)"
                            : "var(--mz-bg-secondary)",
                        "border-bottom": "1px solid var(--mz-border)",
                        "flex-shrink": "0",
                        color: props.active
                            ? "var(--mz-text-primary)"
                            : "var(--mz-text-secondary)",
                        "font-size": "var(--mz-font-size-xs)",
                    }}>
                    <span
                        style={{
                            flex: "1",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                        }}>
                        {title()}
                    </span>
                    <Show when={props.onClose}>
                        <button
                            onClick={(event) => {
                                event.stopPropagation();
                                props.onClose?.();
                            }}
                            style={{
                                width: "20px",
                                height: "20px",
                                border: "none",
                                background: "transparent",
                                color: "var(--mz-text-muted)",
                                cursor: "pointer",
                                "border-radius": "var(--mz-radius-sm)",
                                "line-height": "1",
                                padding: "0",
                                "flex-shrink": "0",
                            }}
                            onMouseEnter={(event) => {
                                event.currentTarget.style.background =
                                    "var(--mz-bg-hover)";
                                event.currentTarget.style.color =
                                    "var(--mz-text-primary)";
                            }}
                            onMouseLeave={(event) => {
                                event.currentTarget.style.background =
                                    "transparent";
                                event.currentTarget.style.color =
                                    "var(--mz-text-muted)";
                            }}>
                            ×
                        </button>
                    </Show>
                </div>
            </Show>

            <Show
                when={file()}
                fallback={
                    <div
                        style={{
                            flex: "1",
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "center",
                            color: "var(--mz-text-muted)",
                            "font-size": "var(--mz-font-size-sm)",
                        }}>
                        {t("app.openFileOrSearch")}
                    </div>
                }>
                <Show
                    when={previewKind()}
                    fallback={
                        <Show
                            when={isPluginView()}
                            fallback={
                                <Show
                                    when={viewMode() === "reading"}
                                    fallback={
                                        <Editor
                                            file={file()}
                                            viewMode={viewMode()}
                                            isActive={props.active}
                                            onActivate={props.onActivate}
                                        />
                                    }>
                                    <ReadingView
                                        file={file()}
                                        isActive={props.active}
                                        onActivate={props.onActivate}
                                    />
                                </Show>
                            }>
                            <PluginViewHost
                                filePath={props.filePath}
                                content={file()!.content}
                                extension={fileExt()}
                                active={props.active}
                            />
                        </Show>
                    }>
                    <FilePreview
                        filePath={props.filePath}
                        kind={previewKind()!}
                        active={props.active}
                    />
                </Show>
            </Show>
        </div>
    );
};
