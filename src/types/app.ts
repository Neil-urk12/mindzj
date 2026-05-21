import type { AiProviderConfig } from "../stores/settings";

export type SplitDirection = "left" | "right" | "up" | "down";
export type PaneSlot = "primary" | "secondary";
export type AiPanelModelOption = {
    value: string;
    label: string;
    config: AiProviderConfig;
};
export type AiQuestionHistoryEntry = {
    id: string;
    text: string;
    createdAt: string;
};
export type AiHistoryDirection = "prev" | "next";
export type Point = {
    x: number;
    y: number;
};

export const AI_QUESTION_HISTORY_LIMIT = 500;
export const AI_PANEL_MIN_HEIGHT = 220;
export const AI_PANEL_DEFAULT_HEIGHT = 300;
