import { Component, Show, For, createEffect, onMount } from "solid-js";
import { Copy, History, Mic, MicOff, Trash2, Volume2, X } from "lucide-solid";
import { t } from "../../i18n";
import {
    AiPanelModelOption,
    AiQuestionHistoryEntry,
    AiHistoryDirection,
    Point,
} from "../../types/app";
import { formatAiHistoryDate, formatAiHistoryTimestamp } from "../../utils/aiHistory";
import { AiHistoryDialog } from "./AiHistoryDialog";
import { Z_STATIC, Z_DROPDOWN } from "@/constants/zIndex";

export const AiBottomPanel: Component<{
    input: string;
    output: string;
    busy: boolean;
    voiceRecording: boolean;
    voiceBusy: boolean;
    height: number;
    activePath: string | null;
    modelLabel: string;
    modelOptions: AiPanelModelOption[];
    activeModelValue: string;
    historyOpen: boolean;
    historyPosition: Point;
    historyDates: string[];
    historyDate: string;
    historyEntries: AiQuestionHistoryEntry[];
    onHeightChange: (height: number) => void;
    onSelectModel: (value: string) => void;
    onInput: (value: string) => void;
    onRun: () => void;
    onToggleVoiceInput: () => void;
    onSpeakInput: () => void;
    onToggleHistory: () => void;
    onCloseHistory: () => void;
    onMoveHistory: (position: Point) => void;
    onSelectHistoryDate: (value: string) => void;
    onDeleteHistoryEntry: (id: string) => void;
    onClearHistoryDate: () => void;
    onClearAllHistory: () => void;
    onCopyHistoryEntry: (text: string) => void;
    onNavigateHistory: (direction: AiHistoryDirection) => void;
    onClose: () => void;
}> = (props) => {
    let textareaRef: HTMLTextAreaElement | undefined;
    let outputRef: HTMLPreElement | undefined;

    onMount(() => {
        queueMicrotask(() => textareaRef?.focus());
    });

    createEffect(() => {
        props.output;
        if (!props.busy) return;
        queueMicrotask(() => {
            if (outputRef) outputRef.scrollTop = outputRef.scrollHeight;
        });
    });

    function startPanelResize(event: MouseEvent) {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = props.height;
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = "ns-resize";
        document.body.style.userSelect = "none";

        const onMove = (moveEvent: MouseEvent) => {
            props.onHeightChange(startHeight + startY - moveEvent.clientY);
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
        };

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }

    return (
        <>
            <div
                style={{
                    height: `${props.height}px`,
                    "min-height": "220px",
                    width: "100%",
                    "flex-shrink": "0",
                    display: "flex",
                    "flex-direction": "column",
                    position: "relative",
                    background: "var(--mz-bg-secondary)",
                    border: "1px solid var(--mz-border)",
                    "border-left": "none",
                    "border-right": "none",
                    "box-shadow": "0 -6px 18px rgba(0,0,0,0.18)",
                    color: "var(--mz-text-primary)",
                }}>
                <div
                    onMouseDown={startPanelResize}
                    style={{
                        position: "absolute",
                        top: "-4px",
                        left: "0",
                        right: "0",
                        height: "8px",
                        cursor: "ns-resize",
                        "z-index": Z_STATIC,
                    }}
                />
                <div
                    style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "space-between",
                        height: "36px",
                        padding: "0 12px",
                        "border-bottom": "1px solid var(--mz-border)",
                        "font-size": "var(--mz-font-size-sm)",
                        "font-family": "var(--mz-font-sans)",
                    }}>
                    <div
                        style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "10px",
                            "min-width": "0",
                        }}>
                        <div
                            style={{
                                display: "flex",
                                "align-items": "center",
                                gap: "6px",
                                position: "relative",
                                "flex-shrink": "0",
                            }}>
                            <strong>{t("aiPanel.title")}</strong>
                            <button
                                type="button"
                                onClick={props.onToggleHistory}
                                title={t("aiPanel.history")}
                                aria-label={t("aiPanel.history")}
                                style={{
                                    width: "26px",
                                    height: "26px",
                                    display: "inline-flex",
                                    "align-items": "center",
                                    "justify-content": "center",
                                    border: props.historyOpen
                                        ? "1px solid var(--mz-accent)"
                                        : "1px solid var(--mz-border)",
                                    "border-radius": "var(--mz-radius-sm)",
                                    background: props.historyOpen
                                        ? "var(--mz-accent-subtle)"
                                        : "transparent",
                                    color: props.historyOpen
                                        ? "var(--mz-accent)"
                                        : "var(--mz-text-muted)",
                                    cursor: "pointer",
                                    padding: "0",
                                }}
                                onMouseEnter={hoverAiActionButton}
                                onMouseDown={pressAiActionButton}
                                onMouseUp={hoverAiActionButton}
                                onMouseLeave={(event) =>
                                    resetAiActionButton(
                                        event,
                                        props.historyOpen,
                                    )
                                }>
                                <History
                                    size={15}
                                    strokeWidth={1.8}
                                />
                            </button>
                            <Show when={false}>
                                <button
                                    type="button"
                                    onClick={props.onToggleVoiceInput}
                                    disabled={props.busy || props.voiceBusy}
                                    title={
                                        props.voiceRecording
                                            ? t("aiPanel.voiceStop")
                                            : t("aiPanel.voiceStart")
                                    }
                                    aria-label={
                                        props.voiceRecording
                                            ? t("aiPanel.voiceStop")
                                            : t("aiPanel.voiceStart")
                                    }
                                    style={{
                                        width: "26px",
                                        height: "26px",
                                        display: "inline-flex",
                                        "align-items": "center",
                                        "justify-content": "center",
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: props.voiceRecording
                                            ? "var(--mz-bg-hover)"
                                            : "transparent",
                                        color: props.voiceRecording
                                            ? "var(--mz-accent)"
                                            : "var(--mz-text-muted)",
                                        cursor:
                                            props.busy || props.voiceBusy
                                                ? "default"
                                                : "pointer",
                                        opacity:
                                            props.busy || props.voiceBusy
                                                ? "0.55"
                                                : "1",
                                        padding: "0",
                                    }}>
                                    <Show
                                        when={props.voiceRecording}
                                        fallback={
                                            <Mic
                                                size={15}
                                                strokeWidth={1.8}
                                            />
                                        }>
                                        <MicOff
                                            size={15}
                                            strokeWidth={1.8}
                                        />
                                    </Show>
                                </button>
                                <button
                                    type="button"
                                    onClick={props.onSpeakInput}
                                    disabled={
                                        props.busy ||
                                        props.voiceBusy ||
                                        props.voiceRecording ||
                                        !props.input.trim()
                                    }
                                    title={t("aiPanel.ttsInput")}
                                    aria-label={t("aiPanel.ttsInput")}
                                    style={{
                                        width: "26px",
                                        height: "26px",
                                        display: "inline-flex",
                                        "align-items": "center",
                                        "justify-content": "center",
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: "transparent",
                                        color: "var(--mz-text-muted)",
                                        cursor:
                                            props.busy ||
                                            props.voiceBusy ||
                                            props.voiceRecording ||
                                            !props.input.trim()
                                                ? "default"
                                                : "pointer",
                                        opacity:
                                            props.busy ||
                                            props.voiceBusy ||
                                            props.voiceRecording ||
                                            !props.input.trim()
                                                ? "0.55"
                                                : "1",
                                        padding: "0",
                                    }}>
                                    <Volume2
                                        size={15}
                                        strokeWidth={1.8}
                                    />
                                </button>
                            </Show>
                            <Show when={false}>
                                <div
                                    style={{
                                        position: "absolute",
                                        top: "30px",
                                        left: "0",
                                        width: "min(430px, calc(100vw - 32px))",
                                        "max-height": "250px",
                                        display: "flex",
                                        "flex-direction": "column",
                                        gap: "8px",
                                        padding: "10px",
                                        background: "var(--mz-bg-secondary)",
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-sm)",
                                        "box-shadow":
                                            "0 10px 28px rgba(0,0,0,0.32)",
                                        "z-index": Z_DROPDOWN,
                                        color: "var(--mz-text-primary)",
                                    }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            "align-items": "center",
                                            gap: "6px",
                                            "min-width": "0",
                                        }}>
                                        <select
                                            aria-label={t(
                                                "aiPanel.historyDate",
                                            )}
                                            value={props.historyDate}
                                            disabled={
                                                props.historyDates.length === 0
                                            }
                                            onChange={(event) =>
                                                props.onSelectHistoryDate(
                                                    event.currentTarget.value,
                                                )
                                            }
                                            style={{
                                                flex: "1",
                                                "min-width": "0",
                                                height: "26px",
                                                border: "1px solid var(--mz-border)",
                                                "border-radius":
                                                    "var(--mz-radius-sm)",
                                                background:
                                                    "var(--mz-bg-primary)",
                                                color: "var(--mz-text-primary)",
                                                "font-size":
                                                    "var(--mz-font-size-xs)",
                                                "font-family":
                                                    "var(--mz-font-sans)",
                                            }}>
                                            <Show
                                                when={
                                                    props.historyDates.length >
                                                    0
                                                }
                                                fallback={
                                                    <option value="">
                                                        {t(
                                                            "aiPanel.historyNoDate",
                                                        )}
                                                    </option>
                                                }>
                                                <For each={props.historyDates}>
                                                    {(date) => (
                                                        <option value={date}>
                                                            {formatAiHistoryDate(
                                                                date,
                                                            )}
                                                        </option>
                                                    )}
                                                </For>
                                            </Show>
                                        </select>
                                        <button
                                            type="button"
                                            onClick={props.onClearHistoryDate}
                                            disabled={!props.historyDate}
                                            title={t(
                                                "aiPanel.historyClearDate",
                                            )}
                                            style={{
                                                border: "1px solid var(--mz-border)",
                                                "border-radius":
                                                    "var(--mz-radius-sm)",
                                                background: "transparent",
                                                color: "var(--mz-text-muted)",
                                                cursor: props.historyDate
                                                    ? "pointer"
                                                    : "default",
                                                opacity: props.historyDate
                                                    ? "1"
                                                    : "0.5",
                                                padding: "4px 8px",
                                                "font-size":
                                                    "var(--mz-font-size-xs)",
                                                "white-space": "nowrap",
                                            }}>
                                            {t("aiPanel.historyClearDate")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={props.onClearAllHistory}
                                            disabled={
                                                props.historyDates.length === 0
                                            }
                                            title={t("aiPanel.historyClearAll")}
                                            style={{
                                                border: "1px solid var(--mz-border)",
                                                "border-radius":
                                                    "var(--mz-radius-sm)",
                                                background: "transparent",
                                                color: "var(--mz-text-muted)",
                                                cursor: props.historyDates
                                                    .length
                                                    ? "pointer"
                                                    : "default",
                                                opacity: props.historyDates
                                                    .length
                                                    ? "1"
                                                    : "0.5",
                                                padding: "4px 8px",
                                                "font-size":
                                                    "var(--mz-font-size-xs)",
                                                "white-space": "nowrap",
                                            }}>
                                            {t("aiPanel.historyClearAll")}
                                        </button>
                                    </div>
                                    <Show
                                        when={props.historyEntries.length > 0}
                                        fallback={
                                            <div
                                                style={{
                                                    color: "var(--mz-text-muted)",
                                                    "font-size":
                                                        "var(--mz-font-size-xs)",
                                                    padding: "14px 2px",
                                                }}>
                                                {t("aiPanel.historyEmpty")}
                                            </div>
                                        }>
                                        <div
                                            style={{
                                                display: "flex",
                                                "flex-direction": "column",
                                                gap: "6px",
                                                overflow: "auto",
                                                "min-height": "0",
                                                "max-height": "188px",
                                            }}>
                                            <For each={props.historyEntries}>
                                                {(entry) => (
                                                    <div
                                                        style={{
                                                            display: "grid",
                                                            "grid-template-columns":
                                                                "1fr auto auto",
                                                            gap: "6px",
                                                            "align-items":
                                                                "center",
                                                            padding: "7px",
                                                            border: "1px solid var(--mz-border)",
                                                            "border-radius":
                                                                "var(--mz-radius-sm)",
                                                            background:
                                                                "var(--mz-bg-primary)",
                                                        }}>
                                                        <div
                                                            style={{
                                                                "min-width":
                                                                    "0",
                                                            }}>
                                                            <div
                                                                style={{
                                                                    color: "var(--mz-text-muted)",
                                                                    "font-size":
                                                                        "11px",
                                                                    "margin-bottom":
                                                                        "4px",
                                                                }}>
                                                                {formatAiHistoryTimestamp(
                                                                    entry.createdAt,
                                                                )}
                                                            </div>
                                                            <div
                                                                style={{
                                                                    color: "var(--mz-text-secondary)",
                                                                    "font-size":
                                                                        "var(--mz-font-size-xs)",
                                                                    "line-height":
                                                                        "1.45",
                                                                    "white-space":
                                                                        "pre-wrap",
                                                                    "word-break":
                                                                        "break-word",
                                                                    "user-select":
                                                                        "text",
                                                                    "-webkit-user-select":
                                                                        "text",
                                                                }}>
                                                                {entry.text}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                props.onCopyHistoryEntry(
                                                                    entry.text,
                                                                )
                                                            }
                                                            title={t(
                                                                "common.copy",
                                                            )}
                                                            aria-label={t(
                                                                "common.copy",
                                                            )}
                                                            style={{
                                                                width: "26px",
                                                                height: "26px",
                                                                display:
                                                                    "inline-flex",
                                                                "align-items":
                                                                    "center",
                                                                "justify-content":
                                                                    "center",
                                                                border: "1px solid var(--mz-border)",
                                                                "border-radius":
                                                                    "var(--mz-radius-sm)",
                                                                background:
                                                                    "transparent",
                                                                color: "var(--mz-text-muted)",
                                                                cursor: "pointer",
                                                                padding: "0",
                                                            }}>
                                                            <Copy
                                                                size={14}
                                                                strokeWidth={
                                                                    1.8
                                                                }
                                                            />
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                props.onDeleteHistoryEntry(
                                                                    entry.id,
                                                                )
                                                            }
                                                            title={t(
                                                                "common.delete",
                                                            )}
                                                            aria-label={t(
                                                                "common.delete",
                                                            )}
                                                            style={{
                                                                width: "26px",
                                                                height: "26px",
                                                                display:
                                                                    "inline-flex",
                                                                "align-items":
                                                                    "center",
                                                                "justify-content":
                                                                    "center",
                                                                border: "1px solid var(--mz-border)",
                                                                "border-radius":
                                                                    "var(--mz-radius-sm)",
                                                                background:
                                                                    "transparent",
                                                                color: "var(--mz-text-muted)",
                                                                cursor: "pointer",
                                                                padding: "0",
                                                            }}>
                                                            <Trash2
                                                                size={14}
                                                                strokeWidth={
                                                                    1.8
                                                                }
                                                            />
                                                        </button>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </Show>
                                </div>
                            </Show>
                        </div>
                        <Show
                            when={props.modelOptions.length > 0}
                            fallback={
                                <span
                                    style={{
                                        color: "var(--mz-accent)",
                                        overflow: "hidden",
                                        "text-overflow": "ellipsis",
                                        "white-space": "nowrap",
                                        "min-width": "0",
                                    }}>
                                    {props.modelLabel}
                                </span>
                            }>
                            <select
                                aria-label={t("settings.aiProviderSection")}
                                value={props.activeModelValue}
                                disabled={props.busy}
                                onChange={(event) =>
                                    props.onSelectModel(
                                        event.currentTarget.value,
                                    )
                                }
                                style={{
                                    "max-width": "220px",
                                    "min-width": "60px",
                                    height: "26px",
                                    padding: "2px 16px 2px 8px",
                                    border: "1px solid var(--mz-border)",
                                    "border-radius": "var(--mz-radius-sm)",
                                    background: "var(--mz-bg-primary)",
                                    color: "var(--mz-accent)",
                                    cursor: props.busy ? "default" : "pointer",
                                    opacity: props.busy ? "0.7" : "1",
                                    overflow: "hidden",
                                    "text-overflow": "ellipsis",
                                    "white-space": "nowrap",
                                    "font-size": "var(--mz-font-size-xs)",
                                    "font-family": "var(--mz-font-sans)",
                                    "flex-shrink": "1",
                                }}>
                                <For each={props.modelOptions}>
                                    {(option) => (
                                        <option value={option.value}>
                                            {option.label}
                                        </option>
                                    )}
                                </For>
                            </select>
                        </Show>
                        <span
                            style={{
                                color: "var(--mz-text-muted)",
                                overflow: "hidden",
                                "text-overflow": "ellipsis",
                                "white-space": "nowrap",
                                "user-select": "text",
                                "-webkit-user-select": "text",
                                cursor: "text",
                            }}>
                            {props.activePath || t("aiPanel.noActiveFile")}
                        </span>
                    </div>
                    <button
                        onClick={props.onClose}
                        title={t("common.close")}
                        style={{
                            width: "28px",
                            height: "28px",
                            border: "none",
                            "border-radius": "var(--mz-radius-sm)",
                            background: "transparent",
                            color: "var(--mz-text-muted)",
                            cursor: "pointer",
                            "font-size": "18px",
                            "line-height": "1",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                                "var(--mz-bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = "transparent";
                        }}>
                        <X
                            size={16}
                            strokeWidth={1.8}
                        />
                    </button>
                </div>
                <div
                    style={{
                        flex: "1",
                        display: "grid",
                        "grid-template-columns":
                            "repeat(auto-fit, minmax(260px, 1fr))",
                        gap: "12px",
                        padding: "12px",
                        "min-height": "0",
                    }}>
                    <div
                        style={{
                            display: "flex",
                            "flex-direction": "column",
                            gap: "8px",
                            "min-width": "0",
                            "min-height": "0",
                        }}>
                        <textarea
                            ref={textareaRef}
                            data-mz-ai-input="true"
                            value={props.input}
                            placeholder={t("aiPanel.placeholder")}
                            disabled={props.busy}
                            onInput={(e) =>
                                props.onInput(e.currentTarget.value)
                            }
                            onKeyDown={(e) => {
                                if (
                                    e.altKey &&
                                    !e.ctrlKey &&
                                    !e.metaKey &&
                                    (e.key === "ArrowUp" ||
                                        e.key === "ArrowDown")
                                ) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    props.onNavigateHistory(
                                        e.key === "ArrowUp" ? "prev" : "next",
                                    );
                                    return;
                                }
                                if (
                                    (e.ctrlKey || e.metaKey) &&
                                    e.key === "Enter"
                                ) {
                                    e.preventDefault();
                                    props.onRun();
                                }
                            }}
                            style={{
                                flex: "1",
                                resize: "none",
                                border: "1px solid var(--mz-border)",
                                "border-radius": "var(--mz-radius-sm)",
                                background: "var(--mz-bg-primary)",
                                color: "var(--mz-text-primary)",
                                padding: "10px",
                                "font-family": "var(--mz-font-sans)",
                                "font-size": "var(--mz-font-size-sm)",
                                outline: "none",
                                "min-height": "0",
                            }}
                        />
                        <div
                            style={{
                                display: "flex",
                                "justify-content": "flex-end",
                                gap: "8px",
                            }}>
                            <button
                                onClick={props.onRun}
                                disabled={
                                    props.busy ||
                                    props.voiceBusy ||
                                    props.voiceRecording ||
                                    !props.input.trim()
                                }
                                style={{
                                    border: "1px solid var(--mz-accent)",
                                    background: "transparent",
                                    color: "var(--mz-accent)",
                                    "border-radius": "var(--mz-radius-sm)",
                                    padding: "6px 16px",
                                    cursor:
                                        props.busy ||
                                        props.voiceBusy ||
                                        props.voiceRecording ||
                                        !props.input.trim()
                                            ? "default"
                                            : "pointer",
                                    opacity:
                                        props.busy ||
                                        props.voiceBusy ||
                                        props.voiceRecording ||
                                        !props.input.trim()
                                            ? "0.55"
                                            : "1",
                                    "font-size": "var(--mz-font-size-sm)",
                                    "font-family": "var(--mz-font-sans)",
                                }}>
                                {props.busy || props.voiceBusy
                                    ? t("aiPanel.working")
                                    : t("aiPanel.run")}
                            </button>
                        </div>
                    </div>
                    <pre
                        ref={outputRef}
                        style={{
                            margin: "0",
                            overflow: "auto",
                            "white-space": "pre-wrap",
                            "word-break": "break-word",
                            border: "1px solid var(--mz-border)",
                            "border-radius": "var(--mz-radius-sm)",
                            background: "var(--mz-bg-primary)",
                            color: props.output
                                ? "var(--mz-text-secondary)"
                                : "var(--mz-text-muted)",
                            padding: "10px",
                            "font-family": "var(--mz-font-mono, monospace)",
                            "font-size": "var(--mz-font-size-xs)",
                            "min-height": "0",
                            "user-select": "text",
                            "-webkit-user-select": "text",
                            cursor: "text",
                        }}>
                        {props.output || t("aiPanel.empty")}
                    </pre>
                </div>
            </div>
            <Show when={props.historyOpen}>
                <AiHistoryDialog
                    position={props.historyPosition}
                    dates={props.historyDates}
                    selectedDate={props.historyDate}
                    entries={props.historyEntries}
                    onMove={props.onMoveHistory}
                    onClose={props.onCloseHistory}
                    onSelectDate={props.onSelectHistoryDate}
                    onDeleteEntry={props.onDeleteHistoryEntry}
                    onClearDate={props.onClearHistoryDate}
                    onClearAll={props.onClearAllHistory}
                    onCopyEntry={props.onCopyHistoryEntry}
                />
            </Show>
        </>
    );
};

export function hoverAiActionButton(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    target.style.background = "var(--mz-bg-hover)";
    target.style.borderColor = "var(--mz-accent)";
    target.style.color = "var(--mz-accent)";
}

export function pressAiActionButton(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    target.style.background = "var(--mz-accent-subtle)";
    target.style.borderColor = "var(--mz-accent)";
    target.style.color = "var(--mz-accent)";
}

export function resetAiActionButton(event: MouseEvent, active = false) {
    const target = event.currentTarget as HTMLElement;
    target.style.background = active
        ? "var(--mz-accent-subtle)"
        : "transparent";
    target.style.borderColor = active ? "var(--mz-accent)" : "var(--mz-border)";
    target.style.color = active ? "var(--mz-accent)" : "var(--mz-text-muted)";
}
