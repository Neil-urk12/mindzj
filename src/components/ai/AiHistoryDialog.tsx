import { Component, Show, For, onMount } from "solid-js";
import type { AiQuestionHistoryEntry, Point } from "../../types/app";
import { formatAiHistoryDate, formatAiHistoryTimestamp } from "../../utils/aiHistory";
import { t } from "../../i18n";
import { Copy, Trash2, X } from "lucide-solid";

function hoverAiActionButton(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    target.style.background = "var(--mz-bg-hover)";
    target.style.borderColor = "var(--mz-accent)";
    target.style.color = "var(--mz-accent)";
}

function pressAiActionButton(event: MouseEvent) {
    const target = event.currentTarget as HTMLElement;
    target.style.background = "var(--mz-accent-subtle)";
    target.style.borderColor = "var(--mz-accent)";
    target.style.color = "var(--mz-accent)";
}

function resetAiActionButton(event: MouseEvent, active = false) {
    const target = event.currentTarget as HTMLElement;
    target.style.background = active
        ? "var(--mz-accent-subtle)"
        : "transparent";
    target.style.borderColor = active ? "var(--mz-accent)" : "var(--mz-border)";
    target.style.color = active ? "var(--mz-accent)" : "var(--mz-text-muted)";
}

export const AiHistoryDialog: Component<{
    position: Point;
    dates: string[];
    selectedDate: string;
    entries: AiQuestionHistoryEntry[];
    onMove: (position: Point) => void;
    onClose: () => void;
    onSelectDate: (value: string) => void;
    onDeleteEntry: (id: string) => void;
    onClearDate: () => void;
    onClearAll: () => void;
    onCopyEntry: (text: string) => void;
}> = (props) => {
    let dialogRef: HTMLDivElement | undefined;

    const clampPosition = (position: Point): Point => {
        const width = dialogRef?.offsetWidth ?? 520;
        const height = dialogRef?.offsetHeight ?? 420;
        return {
            x: Math.max(8, Math.min(window.innerWidth - width - 8, position.x)),
            y: Math.max(
                8,
                Math.min(window.innerHeight - height - 8, position.y),
            ),
        };
    };

    onMount(() => {
        queueMicrotask(() => props.onMove(clampPosition(props.position)));
    });

    function startDrag(event: MouseEvent) {
        event.preventDefault();
        const startX = event.clientX;
        const startY = event.clientY;
        const startPosition = props.position;
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = "move";
        document.body.style.userSelect = "none";

        const onMove = (moveEvent: MouseEvent) => {
            props.onMove(
                clampPosition({
                    x: startPosition.x + moveEvent.clientX - startX,
                    y: startPosition.y + moveEvent.clientY - startY,
                }),
            );
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
        <div
            ref={dialogRef}
            style={{
                position: "fixed",
                left: `${props.position.x}px`,
                top: `${props.position.y}px`,
                width: "min(520px, calc(100vw - 32px))",
                height: "min(420px, calc(100vh - 48px))",
                display: "flex",
                "flex-direction": "column",
                background: "var(--mz-bg-secondary)",
                border: "1px solid var(--mz-border)",
                "border-radius": "var(--mz-radius-sm)",
                "box-shadow": "0 14px 40px rgba(0,0,0,0.42)",
                "z-index": "100000",
                color: "var(--mz-text-primary)",
                overflow: "hidden",
                "font-family": "var(--mz-font-sans)",
            }}>
            <div
                onMouseDown={startDrag}
                style={{
                    height: "38px",
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    gap: "8px",
                    padding: "0 10px",
                    border: "0 solid var(--mz-border)",
                    "border-bottom-width": "1px",
                    cursor: "move",
                    "user-select": "none",
                }}>
                <strong style={{ "font-size": "var(--mz-font-size-sm)" }}>
                    {t("aiPanel.history")}
                </strong>
                <button
                    type="button"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={props.onClose}
                    title={t("common.close")}
                    aria-label={t("common.close")}
                    style={{
                        width: "28px",
                        height: "28px",
                        display: "inline-flex",
                        "align-items": "center",
                        "justify-content": "center",
                        border: "none",
                        "border-radius": "var(--mz-radius-sm)",
                        background: "transparent",
                        color: "var(--mz-text-muted)",
                        cursor: "pointer",
                        padding: "0",
                    }}>
                    <X
                        size={16}
                        strokeWidth={1.8}
                    />
                </button>
            </div>
            <div
                style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    padding: "10px",
                    border: "0 solid var(--mz-border)",
                    "border-bottom-width": "1px",
                }}>
                <select
                    aria-label={t("aiPanel.historyDate")}
                    value={props.selectedDate}
                    disabled={props.dates.length === 0}
                    onChange={(event) =>
                        props.onSelectDate(event.currentTarget.value)
                    }
                    style={{
                        flex: "1",
                        "min-width": "0",
                        height: "28px",
                        border: "1px solid var(--mz-border)",
                        "border-radius": "var(--mz-radius-sm)",
                        background: "var(--mz-bg-primary)",
                        color: "var(--mz-text-primary)",
                        "font-size": "var(--mz-font-size-xs)",
                    }}>
                    <Show
                        when={props.dates.length > 0}
                        fallback={
                            <option value="">
                                {t("aiPanel.historyNoDate")}
                            </option>
                        }>
                        <For each={props.dates}>
                            {(date) => (
                                <option value={date}>
                                    {formatAiHistoryDate(date)}
                                </option>
                            )}
                        </For>
                    </Show>
                </select>
                <button
                    type="button"
                    onClick={props.onClearDate}
                    disabled={!props.selectedDate}
                    title={t("aiPanel.historyClearDate")}
                    onMouseEnter={hoverAiActionButton}
                    onMouseDown={pressAiActionButton}
                    onMouseUp={hoverAiActionButton}
                    onMouseLeave={resetAiActionButton}
                    style={{
                        border: "1px solid var(--mz-border)",
                        "border-radius": "var(--mz-radius-sm)",
                        background: "transparent",
                        color: "var(--mz-text-muted)",
                        cursor: props.selectedDate ? "pointer" : "default",
                        opacity: props.selectedDate ? "1" : "0.5",
                        padding: "5px 10px",
                        "font-size": "var(--mz-font-size-xs)",
                        "white-space": "nowrap",
                    }}>
                    {t("aiPanel.historyClearDate")}
                </button>
                <button
                    type="button"
                    onClick={props.onClearAll}
                    disabled={props.dates.length === 0}
                    title={t("aiPanel.historyClearAll")}
                    onMouseEnter={hoverAiActionButton}
                    onMouseDown={pressAiActionButton}
                    onMouseUp={hoverAiActionButton}
                    onMouseLeave={resetAiActionButton}
                    style={{
                        border: "1px solid var(--mz-border)",
                        "border-radius": "var(--mz-radius-sm)",
                        background: "transparent",
                        color: "var(--mz-text-muted)",
                        cursor: props.dates.length ? "pointer" : "default",
                        opacity: props.dates.length ? "1" : "0.5",
                        padding: "5px 10px",
                        "font-size": "var(--mz-font-size-xs)",
                        "white-space": "nowrap",
                    }}>
                    {t("aiPanel.historyClearAll")}
                </button>
            </div>
            <Show
                when={props.entries.length > 0}
                fallback={
                    <div
                        style={{
                            color: "var(--mz-text-muted)",
                            "font-size": "var(--mz-font-size-sm)",
                            padding: "18px",
                        }}>
                        {t("aiPanel.historyEmpty")}
                    </div>
                }>
                <div
                    style={{
                        flex: "1",
                        overflow: "auto",
                        padding: "10px",
                        display: "flex",
                        "flex-direction": "column",
                        gap: "8px",
                        "min-height": "0",
                    }}>
                    <For each={props.entries}>
                        {(entry) => (
                            <div
                                style={{
                                    display: "grid",
                                    "grid-template-columns": "1fr auto auto",
                                    gap: "8px",
                                    "align-items": "center",
                                    padding: "9px",
                                    border: "1px solid var(--mz-border)",
                                    "border-radius": "var(--mz-radius-sm)",
                                    background: "var(--mz-bg-primary)",
                                }}>
                                <div style={{ "min-width": "0" }}>
                                    <div
                                        style={{
                                            color: "var(--mz-text-muted)",
                                            "font-size": "11px",
                                            "margin-bottom": "5px",
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
                                            "line-height": "1.5",
                                            "white-space": "pre-wrap",
                                            "word-break": "break-word",
                                            "user-select": "text",
                                            "-webkit-user-select": "text",
                                            cursor: "text",
                                        }}>
                                        {entry.text}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        props.onCopyEntry(entry.text)
                                    }
                                    title={t("common.copy")}
                                    aria-label={t("common.copy")}
                                    onMouseEnter={hoverAiActionButton}
                                    onMouseDown={pressAiActionButton}
                                    onMouseUp={hoverAiActionButton}
                                    onMouseLeave={resetAiActionButton}
                                    style={{
                                        width: "28px",
                                        height: "28px",
                                        display: "inline-flex",
                                        "align-items": "center",
                                        "justify-content": "center",
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: "transparent",
                                        color: "var(--mz-text-muted)",
                                        cursor: "pointer",
                                        padding: "0",
                                    }}>
                                    <Copy
                                        size={14}
                                        strokeWidth={1.8}
                                    />
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        props.onDeleteEntry(entry.id)
                                    }
                                    title={t("common.delete")}
                                    aria-label={t("common.delete")}
                                    onMouseEnter={hoverAiActionButton}
                                    onMouseDown={pressAiActionButton}
                                    onMouseUp={hoverAiActionButton}
                                    onMouseLeave={resetAiActionButton}
                                    style={{
                                        width: "28px",
                                        height: "28px",
                                        display: "inline-flex",
                                        "align-items": "center",
                                        "justify-content": "center",
                                        border: "1px solid var(--mz-border)",
                                        "border-radius": "var(--mz-radius-sm)",
                                        background: "transparent",
                                        color: "var(--mz-text-muted)",
                                        cursor: "pointer",
                                        padding: "0",
                                    }}>
                                    <Trash2
                                        size={14}
                                        strokeWidth={1.8}
                                    />
                                </button>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
};
