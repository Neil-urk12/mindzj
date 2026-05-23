import type { AiProviderConfig } from "../stores/settings";
import type { AiQuestionHistoryEntry } from "../types/app";
import { AI_QUESTION_HISTORY_LIMIT } from "../types/app";
import { aiProviderModelLabel } from "../stores/aiService";
import { getClientPlatform } from "./platform";

const CLIENT_PLATFORM = getClientPlatform();

export function normalizeVaultPath(path: string | null | undefined): string {
    if (!path) return "";
    const normalized = path
        .replace(/^\\\\\?\\/, "")
        .replace(/\\/g, "/");
    return CLIENT_PLATFORM === "windows" ? normalized.toLowerCase() : normalized;
}

export function aiQuestionHistoryStorageKey(
    vaultPath: string | null | undefined,
): string {
    return `mindzj-ai-question-history:${normalizeVaultPath(vaultPath) || "no-vault"}`;
}

export function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

export function aiHistoryDateKey(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.slice(0, 10);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatAiHistoryDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}

export function formatAiHistoryTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function aiAudioFileTimestamp(): string {
    const now = new Date();
    return [
        now.getFullYear(),
        pad2(now.getMonth() + 1),
        pad2(now.getDate()),
        "_",
        pad2(now.getHours()),
        pad2(now.getMinutes()),
        pad2(now.getSeconds()),
    ].join("");
}

export function parseAiQuestionHistory(raw: string | null): AiQuestionHistoryEntry[] {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((entry, index): AiQuestionHistoryEntry | null => {
                const text = String(entry?.text ?? "").trim();
                const createdAt = String(entry?.createdAt ?? "");
                if (!text || !createdAt) return null;
                return {
                    id: String(entry?.id ?? `${createdAt}-${index}`),
                    text,
                    createdAt,
                };
            })
            .filter((entry): entry is AiQuestionHistoryEntry => !!entry)
            .sort(
                (a, b) =>
                    new Date(a.createdAt).getTime() -
                    new Date(b.createdAt).getTime(),
            )
            .slice(-AI_QUESTION_HISTORY_LIMIT);
    } catch {
        return [];
    }
}

export function aiPanelModelOptionValue(config: AiProviderConfig): string {
    if (config.id) return `custom:${config.id}`;
    return config.provider_type;
}

export function aiPanelModelOptionLabel(config: AiProviderConfig): string {
    return aiProviderModelLabel(config);
}
