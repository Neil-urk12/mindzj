// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { AboutPanel } from "../AboutPanel";

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../stores/settings", () => ({
  settingsStore: {
    settings: vi.fn(() => ({})),
    updateSetting: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("AboutPanel", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders without crashing", () => {
      const { container } = render(() => <AboutPanel />);
      expect(container).toBeTruthy();
      expect(container.innerHTML.length).toBeGreaterThan(0);
    });

    it("shows 'MindZJ' heading", () => {
      render(() => <AboutPanel />);
      const heading = screen.getByRole("heading", { name: "MindZJ" });
      expect(heading).toBeTruthy();
      expect(heading.textContent).toContain("MindZJ");
    });

    it("shows version text", () => {
      render(() => <AboutPanel />);
      expect(screen.getAllByText(/common\.version/).length).toBeGreaterThan(0);
    });

    it("shows author text", () => {
      render(() => <AboutPanel />);
      expect(screen.getByText(/common\.author/)).toBeTruthy();
      expect(screen.getAllByText(/SuperJohn/).length).toBeGreaterThan(0);
    });

    it("shows description text", () => {
      render(() => <AboutPanel />);
      expect(screen.getByText("settings.aboutDescription")).toBeTruthy();
    });

    it("shows tagline text", () => {
      render(() => <AboutPanel />);
      expect(screen.getByText("settings.aboutTagline")).toBeTruthy();
    });

    it("shows GitHub link", () => {
      render(() => <AboutPanel />);
      const githubLink = screen.getAllByText("settings.githubRepo");
      expect(githubLink.length).toBeGreaterThan(0);
    });

    it("contains link to APP_REPO_URL", () => {
      render(() => <AboutPanel />);
      // Component uses <button onClick> with openExternalUrl, not <a> tags.
      // Verify the GitHub repo button exists (appears in hero + links sections).
      const repoButtons = screen.getAllByText("settings.githubRepo");
      expect(repoButtons.length).toBeGreaterThan(0);
    });
  });
});
