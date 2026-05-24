import {
    createSignal,
    createMemo,
    createEffect,
    on,
    onCleanup,
    type Accessor,
} from "solid-js";
import {
    settingsStore,
    type AiProviderConfig,
} from "../stores/settings";
import {
    BUILT_IN_ONLINE_PROVIDER_TYPES,
    aiService,
    defaultAiProviderConfig,
} from "../stores/aiService";
import {
    AiQuestionHistoryEntry,
    AiPanelModelOption,
    AiHistoryDirection,
    AI_QUESTION_HISTORY_LIMIT,
    AI_PANEL_MIN_HEIGHT,
    AI_PANEL_DEFAULT_HEIGHT,
    Point,
} from "../types/app";
import {
    aiQuestionHistoryStorageKey,
    aiHistoryDateKey,
    parseAiQuestionHistory,
    aiPanelModelOptionValue,
    aiPanelModelOptionLabel,
    aiAudioFileTimestamp,
} from "../utils/aiHistory";
import { encodeWav, arrayBufferToBase64 } from "../utils/audio";
import { t } from "../i18n";

export function useAiPanel(deps: { vaultPath: Accessor<string | undefined> }) {
    // ── Signals ──────────────────────────────────────────────────

    const [aiPanelInput, setAiPanelInput] = createSignal("");
    const [aiPanelOutput, setAiPanelOutput] = createSignal("");
    const [aiPanelBusy, setAiPanelBusy] = createSignal(false);
    const [aiVoiceRecording, setAiVoiceRecording] = createSignal(false);
    const [aiVoiceBusy, setAiVoiceBusy] = createSignal(false);
    const [showAiHistory, setShowAiHistory] = createSignal(false);
    const [aiQuestionHistory, setAiQuestionHistory] = createSignal<
        AiQuestionHistoryEntry[]
    >([]);
    const [aiHistoryDate, setAiHistoryDate] = createSignal("");
    const [aiHistoryCursor, setAiHistoryCursor] = createSignal<number | null>(
        null,
    );
    const [aiPanelHeight, setAiPanelHeight] = createSignal(
        AI_PANEL_DEFAULT_HEIGHT,
    );
    const [showAiPanel, setShowAiPanel] = createSignal(false);
    const [aiHistoryPosition, setAiHistoryPosition] = createSignal<Point>({
        x: 0,
        y: 0,
    });
    const [aiHistoryPositionReady, setAiHistoryPositionReady] =
        createSignal(false);

    // ── Memos ────────────────────────────────────────────────────

    const aiQuestionHistoryKey = createMemo(() =>
        aiQuestionHistoryStorageKey(deps.vaultPath()),
    );

    const currentAiModelLabel = createMemo(() => aiService.currentModelLabel());

    const aiPanelModelOptions = createMemo<AiPanelModelOption[]>(() => {
        const settings = settingsStore.settings();
        const options: AiPanelModelOption[] = [];
        const seen = new Set<string>();
        const addOption = (config: AiProviderConfig | null | undefined) => {
            if (!config?.model?.trim()) return;
            const value = aiPanelModelOptionValue(config);
            if (seen.has(value)) return;
            seen.add(value);
            options.push({
                value,
                label: aiPanelModelOptionLabel(config),
                config,
            });
        };

        addOption(settings.ai_provider);
        addOption(defaultAiProviderConfig("LMStudio"));
        addOption(defaultAiProviderConfig("Ollama"));
        for (const provider of BUILT_IN_ONLINE_PROVIDER_TYPES) {
            addOption(defaultAiProviderConfig(provider));
        }
        for (const config of settings.ai_custom_providers ?? []) {
            addOption(config);
        }

        return options;
    });

    const currentAiModelOptionValue = createMemo(() => {
        const config =
            settingsStore.settings().ai_provider ??
            defaultAiProviderConfig("Ollama");
        return aiPanelModelOptionValue(config);
    });

    const aiHistoryDates = createMemo(() => {
        const dates = new Set<string>();
        for (const entry of aiQuestionHistory()) {
            const key = aiHistoryDateKey(entry.createdAt);
            if (key) dates.add(key);
        }
        return Array.from(dates).sort().reverse();
    });

    const selectedAiHistoryEntries = createMemo(() => {
        const date = aiHistoryDate();
        return aiQuestionHistory()
            .filter((entry) => aiHistoryDateKey(entry.createdAt) === date)
            .slice()
            .sort(
                (a, b) =>
                    new Date(b.createdAt).getTime() -
                    new Date(a.createdAt).getTime(),
            );
    });

    // ── Effects ──────────────────────────────────────────────────

    // Load question history from localStorage when vault changes.
    createEffect(
        on(aiQuestionHistoryKey, (key) => {
            let entries: AiQuestionHistoryEntry[] = [];
            try {
                entries = parseAiQuestionHistory(localStorage.getItem(key));
            } catch {
                entries = [];
            }
            setAiQuestionHistory(entries);
            setAiHistoryCursor(null);
            const dates = Array.from(
                new Set(
                    entries
                        .map((entry) => aiHistoryDateKey(entry.createdAt))
                        .filter(Boolean),
                ),
            )
                .sort()
                .reverse();
            setAiHistoryDate(dates[0] ?? "");
        }),
    );

    // Keep selected history date valid when available dates change.
    createEffect(() => {
        const dates = aiHistoryDates();
        const current = aiHistoryDate();
        if (!dates.length) {
            if (current) setAiHistoryDate("");
            return;
        }
        if (!current || !dates.includes(current)) {
            setAiHistoryDate(dates[0]);
        }
    });

    // ── Voice recording state (module-local to hook closure) ────

    let aiVoiceStream: MediaStream | null = null;
    let aiVoiceAudioContext: AudioContext | null = null;
    let aiVoiceSource: MediaStreamAudioSourceNode | null = null;
    let aiVoiceProcessor: ScriptProcessorNode | null = null;
    let aiVoiceSamples: Float32Array[] = [];
    let aiVoiceSampleRate = 48000;

    // ── Internal helpers ─────────────────────────────────────────

    function pushAiPanelStatus(message: string) {
        const stamp = new Date().toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        setAiPanelOutput((current) => {
            const line = `[${stamp}] ${message}`;
            return current ? `${current}\n${line}` : line;
        });
    }

    function saveAiQuestionHistory(next: AiQuestionHistoryEntry[]) {
        const trimmed = next.slice(-AI_QUESTION_HISTORY_LIMIT);
        setAiQuestionHistory(trimmed);
        setAiHistoryCursor(null);
        try {
            localStorage.setItem(
                aiQuestionHistoryKey(),
                JSON.stringify(trimmed),
            );
        } catch {
            // History is a convenience feature; storage failures should not block AI runs.
        }
    }

    function recordAiQuestion(text: string) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const createdAt = new Date().toISOString();
        const entry: AiQuestionHistoryEntry = {
            id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
            text: trimmed,
            createdAt,
        };
        saveAiQuestionHistory([...aiQuestionHistory(), entry]);
        setAiHistoryDate(aiHistoryDateKey(createdAt));
    }

    function deleteAiHistoryEntry(id: string) {
        saveAiQuestionHistory(
            aiQuestionHistory().filter((entry) => entry.id !== id),
        );
    }

    function clearAiHistoryForSelectedDate() {
        const date = aiHistoryDate();
        if (!date) return;
        saveAiQuestionHistory(
            aiQuestionHistory().filter(
                (entry) => aiHistoryDateKey(entry.createdAt) !== date,
            ),
        );
    }

    function clearAllAiHistory() {
        saveAiQuestionHistory([]);
    }

    function disposeAiVoiceCapture() {
        aiVoiceProcessor?.disconnect();
        aiVoiceSource?.disconnect();
        aiVoiceStream?.getTracks().forEach((track) => track.stop());
        void aiVoiceAudioContext?.close().catch(() => {});
        aiVoiceProcessor = null;
        aiVoiceSource = null;
        aiVoiceStream = null;
        aiVoiceAudioContext = null;
    }

    onCleanup(() => disposeAiVoiceCapture());

    // ── Returned actions ─────────────────────────────────────────

    function handleAiPanelInput(value: string) {
        setAiHistoryCursor(null);
        setAiPanelInput(value);
    }

    function navigateAiQuestionHistory(direction: AiHistoryDirection) {
        const history = aiQuestionHistory();
        if (!history.length || aiPanelBusy()) return;
        const current = aiHistoryCursor();
        if (direction === "prev") {
            const nextIndex =
                current === null
                    ? history.length - 1
                    : Math.max(0, current - 1);
            setAiHistoryCursor(nextIndex);
            setAiPanelInput(history[nextIndex].text);
            return;
        }

        if (current === null) return;
        if (current >= history.length - 1) {
            setAiHistoryCursor(null);
            setAiPanelInput("");
            return;
        }
        const nextIndex = current + 1;
        setAiHistoryCursor(nextIndex);
        setAiPanelInput(history[nextIndex].text);
    }

    async function startAiVoiceRecording() {
        if (aiVoiceBusy() || aiVoiceRecording()) return;
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices?.getUserMedia) {
            pushAiPanelStatus(t("aiPanel.voiceUnsupported"));
            return;
        }
        try {
            const stream = await mediaDevices.getUserMedia({ audio: true });
            aiVoiceStream = stream;
            const AudioContextCtor =
                window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextCtor)
                throw new Error(t("aiPanel.voiceUnsupported"));
            const audioContext = new AudioContextCtor({ sampleRate: 48000 });
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            aiVoiceSamples = [];
            aiVoiceSampleRate = audioContext.sampleRate || 48000;
            processor.onaudioprocess = (event) => {
                if (!aiVoiceRecording()) return;
                const input = event.inputBuffer.getChannelData(0);
                aiVoiceSamples.push(new Float32Array(input));
            };
            source.connect(processor);
            processor.connect(audioContext.destination);
            aiVoiceAudioContext = audioContext;
            aiVoiceSource = source;
            aiVoiceProcessor = processor;
            setAiVoiceRecording(true);
            pushAiPanelStatus(t("aiPanel.voiceRecording"));
        } catch (err: unknown) {
            disposeAiVoiceCapture();
            setAiVoiceRecording(false);
            pushAiPanelStatus(err instanceof Error ? err.message : String(err));
        }
    }

    async function stopAiVoiceRecording() {
        if (!aiVoiceRecording()) return;
        const chunks = aiVoiceSamples.slice();
        const sampleRate = aiVoiceSampleRate;
        setAiVoiceRecording(false);
        disposeAiVoiceCapture();
        if (!chunks.length) {
            pushAiPanelStatus(t("aiPanel.voiceEmpty"));
            return;
        }
        setAiVoiceBusy(true);
        pushAiPanelStatus(t("aiPanel.voiceTranscribing"));
        try {
            const wavBuffer = encodeWav(chunks, sampleRate);
            const text = await aiService.transcribeGrokAudio(
                arrayBufferToBase64(wavBuffer),
                `mindzj_recording_${aiAudioFileTimestamp()}.wav`,
                "audio/wav",
            );
            if (!text) {
                pushAiPanelStatus(t("aiPanel.voiceEmpty"));
                return;
            }
            setAiHistoryCursor(null);
            setAiPanelInput((current) => {
                const prefix = current.trim()
                    ? `${current}${current.endsWith("\n") ? "" : "\n"}`
                    : "";
                return `${prefix}${text}`;
            });
            pushAiPanelStatus(t("aiPanel.voiceInserted"));
        } catch (err: unknown) {
            pushAiPanelStatus(err instanceof Error ? err.message : String(err));
        } finally {
            setAiVoiceBusy(false);
        }
    }

    async function runAiPanelInstruction() {
        const instruction = aiPanelInput().trim();
        if (!instruction || aiPanelBusy()) return;
        recordAiQuestion(instruction);
        setAiPanelBusy(true);
        const progressLines: string[] = [];
        let lastProgressMessage = "";
        const pushProgress = (phase: string, message: string) => {
            lastProgressMessage = message;
            const stamp = new Date().toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            });
            const labels: Record<string, string> = {
                request: "请求",
                "tool-call": "工具",
                "tool-result": "结果",
                message: "消息",
                done: "完成",
                error: "错误",
            };
            progressLines.push(
                `[${stamp}] ${labels[phase] ?? phase}: ${message}`,
            );
            setAiPanelOutput(progressLines.join("\n"));
        };
        pushProgress("message", t("aiPanel.working"));
        try {
            const result = await aiService.runInstruction(instruction, {
                restrictToActiveFile: true,
                onProgress: (event) => pushProgress(event.phase, event.message),
            });
            const finalText = result || t("aiPanel.done");
            if (finalText && finalText !== lastProgressMessage) {
                setAiPanelOutput([...progressLines, "", finalText].join("\n"));
            }
            setAiPanelInput("");
            setAiHistoryCursor(null);
        } catch (err: unknown) {
            pushProgress("error", err instanceof Error ? err.message : String(err));
        } finally {
            setAiPanelBusy(false);
        }
    }

    function toggleAiVoiceRecording() {
        if (aiVoiceRecording()) {
            void stopAiVoiceRecording();
            return;
        }
        void startAiVoiceRecording();
    }

    async function synthesizeAiPanelInput() {
        const text = aiPanelInput().trim();
        if (!text || aiPanelBusy() || aiVoiceBusy() || aiVoiceRecording())
            return;
        setAiVoiceBusy(true);
        pushAiPanelStatus(t("aiPanel.ttsWorking"));
        try {
            const result = await aiService.synthesizeGrokSpeech(text);
            pushAiPanelStatus(t("aiPanel.ttsExported", { path: result.path }));
        } catch (err: unknown) {
            pushAiPanelStatus(err instanceof Error ? err.message : String(err));
        } finally {
            setAiVoiceBusy(false);
        }
    }

    function clampAiPanelHeight(value: number): number {
        const max = Math.max(
            AI_PANEL_MIN_HEIGHT,
            Math.min(
                Math.floor(window.innerHeight * 0.72),
                window.innerHeight - 96,
            ),
        );
        return Math.max(AI_PANEL_MIN_HEIGHT, Math.min(max, Math.round(value)));
    }

    function centerAiHistoryDialog(): Point {
        const width = Math.min(520, Math.max(320, window.innerWidth - 32));
        const height = Math.min(420, Math.max(280, window.innerHeight - 48));
        return {
            x: Math.max(12, Math.round((window.innerWidth - width) / 2)),
            y: Math.max(12, Math.round((window.innerHeight - height) / 2)),
        };
    }

    function toggleAiHistoryDialog() {
        const next = !showAiHistory();
        if (next && !aiHistoryPositionReady()) {
            setAiHistoryPosition(centerAiHistoryDialog());
            setAiHistoryPositionReady(true);
        }
        setShowAiHistory(next);
    }

    function closeAiHistoryDialog() {
        setShowAiHistory(false);
    }

    function closeAiPanel() {
        setShowAiPanel(false);
        setShowAiHistory(false);
    }

    function selectAiPanelModel(value: string) {
        const option = aiPanelModelOptions().find(
            (item) => item.value === value,
        );
        if (!option) return;
        void settingsStore.updateSetting("ai_provider", { ...option.config });
    }

    function copyAiHistoryQuestion(text: string) {
        void navigator.clipboard?.writeText(text).catch(() => {});
    }

    // ── Return ───────────────────────────────────────────────────

    return {
        // Signals
        aiPanelInput,
        setAiPanelInput,
        aiPanelOutput,
        setAiPanelOutput,
        aiPanelBusy,
        setAiPanelBusy,
        aiVoiceRecording,
        aiVoiceBusy,
        showAiHistory,
        setShowAiHistory,
        aiQuestionHistory,
        aiHistoryDate,
        setAiHistoryDate,
        aiHistoryCursor,
        setAiHistoryCursor,
        aiPanelHeight,
        setAiPanelHeight,
        showAiPanel,
        setShowAiPanel,
        aiHistoryPosition,
        setAiHistoryPosition,
        aiHistoryPositionReady,
        setAiHistoryPositionReady,
        // Memos
        currentAiModelLabel,
        aiPanelModelOptions,
        currentAiModelOptionValue,
        aiQuestionHistoryKey,
        aiHistoryDates,
        selectedAiHistoryEntries,
        // Actions
        handleAiPanelInput,
        navigateAiQuestionHistory,
        runAiPanelInstruction,
        startAiVoiceRecording,
        stopAiVoiceRecording,
        saveAiQuestionHistory,
        recordAiQuestion,
        pushAiPanelStatus,
        deleteAiHistoryEntry,
        clearAiHistoryForSelectedDate,
        clearAllAiHistory,
        toggleAiVoiceRecording,
        synthesizeAiPanelInput,
        clampAiPanelHeight,
        centerAiHistoryDialog,
        toggleAiHistoryDialog,
        closeAiHistoryDialog,
        closeAiPanel,
        selectAiPanelModel,
        copyAiHistoryQuestion,
    };
}

export type UseAiPanelReturn = ReturnType<typeof useAiPanel>;
