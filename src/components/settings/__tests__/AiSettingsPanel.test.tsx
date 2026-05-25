// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { AiSettingsPanel } from "../AiSettingsPanel";

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../stores/settings", () => ({
  settingsStore: {
    settings: vi.fn(() => ({
      ai_provider: {
        provider_type: "Ollama",
        model: "",
        endpoint: null,
        id: null,
        display_name: null,
        api_key: null,
        has_api_key: false,
      },
      ai_custom_providers: [],
      ai_model_prompts: {},
      ai_skills: [],
      ai_model_skill_ids: {},
      ai_voice_provider: null,
      ai_stt_model: null,
      ai_tts_voice: null,
      ai_tts_language: null,
      ai_voice_export_folder: null,
    })),
    updateSetting: vi.fn(),
  },
  aiModelSettingsKey: vi.fn(() => "test-key"),
}));

vi.mock("../../../stores/aiService", () => ({
  aiService: {
    loadApiKey: vi.fn().mockResolvedValue(null),
    testConnection: vi.fn().mockResolvedValue({ model: "test-model", content: "OK" }),
  },
  BUILT_IN_ONLINE_PROVIDER_TYPES: ["OpenAI", "Claude"],
  GROK_STT_MODEL: "grok-stt",
  GROK_TTS_VOICES: [{ value: "voice1", label: "Voice 1" }],
  GROK_TTS_LANGUAGE_OPTIONS: [{ value: "en", label: "English" }],
  builtInModelOptions: vi.fn(() => []),
  defaultAiProviderConfig: vi.fn((type) => ({
    provider_type: type,
    model: "",
    endpoint: null,
    id: null,
    display_name: null,
    api_key: null,
    has_api_key: false,
  })),
  isBuiltInOnlineProviderType: vi.fn(() => false),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("lucide-solid", () => ({
  Eye: () => null,
  EyeOff: () => null,
}));

vi.mock("../common/ConfirmDialog", () => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
}));

describe("AiSettingsPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders without crashing", () => {
      const { container } = render(() => <AiSettingsPanel />);
      expect(container).toBeTruthy();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });

    it("renders the AI settings title", () => {
      render(() => <AiSettingsPanel />);
      expect(screen.getByText("settings.ai")).toBeTruthy();
    });
  });

  describe("Provider section", () => {
    it("shows provider-related selects", () => {
      render(() => <AiSettingsPanel />);
      const selects = document.querySelectorAll("select");
      expect(selects.length).toBeGreaterThan(0);
    });

    it("shows test button", () => {
      render(() => <AiSettingsPanel />);
      expect(screen.getByText("settings.aiTest")).toBeTruthy();
    });

    it("shows 'Add New Model' button", () => {
      render(() => <AiSettingsPanel />);
      expect(screen.getByText("settings.aiAddNewModel")).toBeTruthy();
    });
  });

  describe("Model input", () => {
    it("shows model label in DOM", () => {
      render(() => <AiSettingsPanel />);
      const labels = document.querySelectorAll("div");
      const modelLabel = Array.from(labels).some((el) =>
        el.textContent?.includes("settings.aiModel"),
      );
      expect(modelLabel).toBe(true);
    });
  });

  describe("Add model flow", () => {
    it("clicking 'Add New Model' shows add form section", () => {
      render(() => <AiSettingsPanel />);
      const addBtn = screen.getByText("settings.aiAddNewModel");
      addBtn.click();
      expect(screen.getByText("settings.aiAddModelSection")).toBeTruthy();
    });
  });

  describe("Skills section", () => {
    it("shows skills section content", () => {
      render(() => <AiSettingsPanel />);
      const skillTexts = screen.getAllByText(/settings\.aiSkill/);
      expect(skillTexts.length).toBeGreaterThan(0);
    });

    it("shows empty state when no skills", () => {
      render(() => <AiSettingsPanel />);
      expect(screen.getByText("settings.aiSkillsEmpty")).toBeTruthy();
    });

    it("shows skill add button", () => {
      render(() => <AiSettingsPanel />);
      expect(screen.getByText("settings.aiSkillAdd")).toBeTruthy();
    });
  });

  describe("Prompt section", () => {
    it("shows prompt-related content", () => {
      render(() => <AiSettingsPanel />);
      const promptTexts = screen.getAllByText(/settings\.aiModelPrompt/);
      expect(promptTexts.length).toBeGreaterThan(0);
    });
  });

  describe("Settings integration", () => {
    it("calls aiService.testConnection when test button clicked", async () => {
      const { aiService } = await import("../../../stores/aiService");
      const testConnectionSpy = vi.mocked(aiService.testConnection);
      testConnectionSpy.mockClear();
      render(() => <AiSettingsPanel />);
      const testBtn = screen.getByText("settings.aiTest");
      testBtn.click();
      await vi.waitFor(() => {
        expect(testConnectionSpy).toHaveBeenCalled();
      });
    });
  });
});
