// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "solid-js";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

vi.mock("../i18n", () => ({
    t: (key: string) => key,
}));

const mockSettings = vi.fn(() => ({
    ai_provider: null,
    ai_custom_providers: [],
}));

vi.mock("../stores/settings", () => ({
    settingsStore: {
        settings: (...args: unknown[]) => mockSettings(...args),
    },
}));

const mockRunInstruction = vi.fn();
const mockTranscribeGrokAudio = vi.fn();
const mockCurrentModelLabel = vi.fn(() => "TestModel");

vi.mock("../stores/aiService", () => ({
    BUILT_IN_ONLINE_PROVIDER_TYPES: ["OpenAI", "Claude", "Grok"],
    aiProviderModelLabel: (config: Record<string, unknown>) => (config as any)?.model ?? "unknown",
    defaultAiProviderConfig: (provider: string) => ({ 
        provider_type: provider,
        model: `default-${provider}-model`,
        base_url: "",
        api_key: "",
    }),
    aiService: {
        currentModelLabel: (...args: unknown[]) => mockCurrentModelLabel(...args),
        runInstruction: (...args: unknown[]) => mockRunInstruction(...args),
        transcribeGrokAudio: (...args: unknown[]) => mockTranscribeGrokAudio(...args),
        synthesizeGrokSpeech: vi.fn().mockResolvedValue({ path: "/tmp/out.wav", fileName: "out.wav" }),
    },
}));

vi.mock("../stores/vault", () => ({
    vaultStore: {
        vaultInfo: () => ({ path: "/test/vault" }),
    },
}));

vi.mock("../utils/aiHistory", async () => {
    const actual = await vi.importActual<typeof import("../utils/aiHistory")>("../utils/aiHistory");
    return actual;
});

vi.mock("../utils/audio", async () => {
    const actual = await vi.importActual<typeof import("../utils/audio")>("../utils/audio");
    return actual;
});

// ── Imports ──────────────────────────────────────────────────────

import { useAiPanel } from "./useAiPanel";
import { aiHistoryDateKey } from "../utils/aiHistory";

// ── Helpers ──────────────────────────────────────────────────────

function createTestHook(vaultPath?: string) {
    let result: ReturnType<typeof useAiPanel>;
    const dispose = createRoot((d) => {
        result = useAiPanel({ vaultPath: () => vaultPath });
        return d;
    });
    return {
        get hook() { return result!; },
        dispose,
    };
}

// ── Tests ────────────────────────────────────────────────────────

describe("useAiPanel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockRunInstruction.mockResolvedValue("done");
        mockTranscribeGrokAudio.mockResolvedValue("transcribed text");
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Signal defaults ────────────────────────────────────────

    it("initializes signals with correct defaults", () => {
        const { hook, dispose } = createTestHook();
        expect(hook.aiPanelInput()).toBe("");
        expect(hook.aiPanelOutput()).toBe("");
        expect(hook.aiPanelBusy()).toBe(false);
        expect(hook.aiVoiceRecording()).toBe(false);
        expect(hook.aiVoiceBusy()).toBe(false);
        expect(hook.showAiHistory()).toBe(false);
        expect(hook.aiQuestionHistory()).toEqual([]);
        expect(hook.aiHistoryDate()).toBe("");
        expect(hook.aiHistoryCursor()).toBeNull();
        expect(hook.aiPanelHeight()).toBe(300);
        dispose();
    });

    // ── handleAiPanelInput ─────────────────────────────────────

    it("handleAiPanelInput updates signal and resets cursor", () => {
        const { hook, dispose } = createTestHook();
        hook.handleAiPanelInput("hello");
        expect(hook.aiPanelInput()).toBe("hello");
        expect(hook.aiHistoryCursor()).toBeNull();
        dispose();
    });

    // ── navigateAiQuestionHistory ──────────────────────────────

    describe("navigateAiQuestionHistory", () => {
        function hookWithHistory() {
            const { hook, dispose } = createTestHook("/test/vault");
            const entries = [
                { id: "1", text: "first", createdAt: "2024-01-01T10:00:00Z" },
                { id: "2", text: "second", createdAt: "2024-01-01T11:00:00Z" },
                { id: "3", text: "third", createdAt: "2024-01-01T12:00:00Z" },
            ];
            hook.saveAiQuestionHistory(entries);
            return { hook, dispose };
        }

        it("prev from null cursor goes to last entry", () => {
            const { hook, dispose } = hookWithHistory();
            expect(hook.aiQuestionHistory().length).toBe(3);
            hook.navigateAiQuestionHistory("prev");
            expect(hook.aiHistoryCursor()).toBe(2);
            expect(hook.aiPanelInput()).toBe("third");
            dispose();
        });

        it("prev decrements cursor", () => {
            const { hook, dispose } = hookWithHistory();
            hook.navigateAiQuestionHistory("prev"); // cursor -> 2
            hook.navigateAiQuestionHistory("prev"); // cursor -> 1
            expect(hook.aiHistoryCursor()).toBe(1);
            expect(hook.aiPanelInput()).toBe("second");
            dispose();
        });

        it("next from last entry clears cursor and input", () => {
            const { hook, dispose } = hookWithHistory();
            hook.navigateAiQuestionHistory("prev"); // cursor -> 2
            hook.navigateAiQuestionHistory("next"); // cursor -> null (past end)
            expect(hook.aiHistoryCursor()).toBeNull();
            expect(hook.aiPanelInput()).toBe("");
            dispose();
        });

        it("next increments cursor", () => {
            const { hook, dispose } = hookWithHistory();
            hook.navigateAiQuestionHistory("prev"); // cursor -> 2
            hook.navigateAiQuestionHistory("prev"); // cursor -> 1
            hook.navigateAiQuestionHistory("next"); // cursor -> 2
            expect(hook.aiHistoryCursor()).toBe(2);
            expect(hook.aiPanelInput()).toBe("third");
            dispose();
        });

        it("next from null cursor is no-op", () => {
            const { hook, dispose } = hookWithHistory();
            hook.navigateAiQuestionHistory("next");
            expect(hook.aiHistoryCursor()).toBeNull();
            expect(hook.aiPanelInput()).toBe("");
            dispose();
        });

        it("does nothing when busy", () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelBusy(true);
            hook.navigateAiQuestionHistory("prev");
            expect(hook.aiHistoryCursor()).toBeNull();
            dispose();
        });
    });

    // ── runAiPanelInstruction ──────────────────────────────────

    describe("runAiPanelInstruction", () => {
        it("calls aiService.runInstruction with input", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("test instruction");
            await hook.runAiPanelInstruction();
            expect(mockRunInstruction).toHaveBeenCalledWith(
                "test instruction",
                expect.objectContaining({
                    restrictToActiveFile: true,
                }),
            );
            dispose();
        });

        it("is a no-op when busy", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("test");
            hook.setAiPanelBusy(true);
            await hook.runAiPanelInstruction();
            expect(mockRunInstruction).not.toHaveBeenCalled();
            dispose();
        });

        it("is a no-op when input is empty", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("");
            await hook.runAiPanelInstruction();
            expect(mockRunInstruction).not.toHaveBeenCalled();
            dispose();
        });

        it("is a no-op when input is whitespace only", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("   ");
            await hook.runAiPanelInstruction();
            expect(mockRunInstruction).not.toHaveBeenCalled();
            dispose();
        });

        it("clears input and cursor after success", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("test");
            await hook.runAiPanelInstruction();
            expect(hook.aiPanelInput()).toBe("");
            expect(hook.aiHistoryCursor()).toBeNull();
            dispose();
        });

        it("sets and clears busy flag during execution", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("test");
            let busyDuringRun = false;
            mockRunInstruction.mockImplementation(async () => {
                busyDuringRun = hook.aiPanelBusy();
                return "result";
            });
            await hook.runAiPanelInstruction();
            expect(busyDuringRun).toBe(true);
            expect(hook.aiPanelBusy()).toBe(false);
            dispose();
        });

        it("handles errors without crashing", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("test");
            mockRunInstruction.mockRejectedValue(new Error("API error"));
            await hook.runAiPanelInstruction();
            expect(hook.aiPanelBusy()).toBe(false);
            expect(hook.aiPanelOutput()).toContain("API error");
            dispose();
        });

        it("records question to history", async () => {
            const { hook, dispose } = createTestHook();
            hook.setAiPanelInput("my question");
            await hook.runAiPanelInstruction();
            const history = hook.aiQuestionHistory();
            expect(history.some((e) => e.text === "my question")).toBe(true);
            dispose();
        });
    });

    // ── Voice recording lifecycle ──────────────────────────────

    describe("voice recording", () => {
        function setupMediaMocks() {
            const mockStream = {
                getTracks: () => [{ stop: vi.fn() }],
            };
            const mockProcessor = {
                connect: vi.fn(),
                disconnect: vi.fn(),
                onaudioprocess: null as any,
            };
            const mockSource = {
                connect: vi.fn(),
                disconnect: vi.fn(),
            };
            const mockAudioContext = {
                sampleRate: 48000,
                createMediaStreamSource: vi.fn(() => mockSource),
                createScriptProcessor: vi.fn(() => mockProcessor),
                destination: {},
                close: vi.fn(() => Promise.resolve()),
            };

            Object.defineProperty(navigator, "mediaDevices", {
                value: {
                    getUserMedia: vi.fn().mockResolvedValue(mockStream),
                },
                configurable: true,
            });

            (window as any).AudioContext = vi.fn(() => mockAudioContext);

            return { mockStream, mockProcessor, mockSource, mockAudioContext };
        }

        it("startAiVoiceRecording sets recording signal on success", async () => {
            setupMediaMocks();
            const { hook, dispose } = createTestHook();
            await hook.startAiVoiceRecording();
            expect(hook.aiVoiceRecording()).toBe(true);
            expect(hook.aiVoiceBusy()).toBe(false);
            dispose();
        });

        it("startAiVoiceRecording is no-op when already recording", async () => {
            setupMediaMocks();
            const getUserMediaSpy = navigator.mediaDevices.getUserMedia as unknown as ReturnType<typeof vi.fn>;
            const { hook, dispose } = createTestHook();
            // Start recording first
            await hook.startAiVoiceRecording();
            const callCount = getUserMediaSpy.mock.calls.length;
            // Second call should be no-op
            await hook.startAiVoiceRecording();
            expect(getUserMediaSpy.mock.calls.length).toBe(callCount);
            expect(hook.aiVoiceRecording()).toBe(true);
            dispose();
        });

        it("stopAiVoiceRecording is no-op when not recording", async () => {
            const { hook, dispose } = createTestHook();
            await hook.stopAiVoiceRecording();
            expect(hook.aiVoiceBusy()).toBe(false);
            dispose();
        });
    });

    // ── Question history loads from localStorage ───────────────

    describe("question history persistence", () => {
        it("saves and reads history via localStorage", () => {
            const { hook, dispose } = createTestHook("/test/vault");
            expect(hook.aiQuestionHistory()).toEqual([]);

            const entries = [
                { id: "1", text: "q1", createdAt: "2024-01-01T10:00:00Z" },
                { id: "2", text: "q2", createdAt: "2024-01-02T10:00:00Z" },
            ];
            hook.saveAiQuestionHistory(entries);
            expect(hook.aiQuestionHistory().length).toBe(2);

            // Verify localStorage persistence
            const key = hook.aiQuestionHistoryKey();
            const stored = JSON.parse(localStorage.getItem(key)!);
            expect(stored.length).toBe(2);
            expect(stored[0].text).toBe("q1");
            dispose();
        });

        it("aiQuestionHistoryKey derives from vault path", () => {
            const { hook, dispose } = createTestHook("/test/vault");
            expect(hook.aiQuestionHistoryKey()).toBe(
                "mindzj-ai-question-history:/test/vault",
            );
            dispose();
        });
    });

    // ── Memos ──────────────────────────────────────────────────

    describe("memos", () => {
        it("currentAiModelLabel delegates to aiService", () => {
            mockCurrentModelLabel.mockReturnValue("GPT-4");
            const { hook, dispose } = createTestHook();
            expect(hook.currentAiModelLabel()).toBe("GPT-4");
            dispose();
        });

        it("aiPanelModelOptions includes default providers", () => {
            const { hook, dispose } = createTestHook();
            const options = hook.aiPanelModelOptions();
            expect(options.length).toBeGreaterThan(0);
            // Should include at least LMStudio, Ollama, and built-in online providers
            const labels = options.map((o) => o.label);
            expect(labels.length).toBeGreaterThanOrEqual(2);
            dispose();
        });

        it("aiHistoryDates derives unique sorted dates from entries (pure utility test)", () => {
            // Memo delegates to aiHistoryDateKey; test the utility logic directly.
            const entries = [
                { id: "1", text: "q1", createdAt: "2024-01-01T10:00:00Z" },
                { id: "2", text: "q2", createdAt: "2024-01-02T10:00:00Z" },
                { id: "3", text: "q3", createdAt: "2024-01-01T12:00:00Z" },
            ];
            const dates = Array.from(
                new Set(
                    entries
                        .map((e) => aiHistoryDateKey(e.createdAt))
                        .filter(Boolean),
                ),
            )
                .sort()
                .reverse();
            expect(dates.length).toBe(2);
            expect(dates[0]).toBe("2024-01-02");
            expect(dates[1]).toBe("2024-01-01");
        });

        it("selectedAiHistoryEntries filters and sorts by date (pure utility test)", () => {
            // Memo uses date-key filtering; test the logic directly.
            const entries = [
                { id: "1", text: "q1", createdAt: "2024-01-01T10:00:00Z" },
                { id: "2", text: "q2", createdAt: "2024-01-02T10:00:00Z" },
                { id: "3", text: "q3", createdAt: "2024-01-01T12:00:00Z" },
            ];
            const date = "2024-01-01";
            const filtered = entries
                .filter((e) => aiHistoryDateKey(e.createdAt) === date)
                .slice()
                .sort((a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                );
            expect(filtered.length).toBe(2);
            expect(filtered[0].text).toBe("q3");
            expect(filtered[1].text).toBe("q1");
        });
    });
});
