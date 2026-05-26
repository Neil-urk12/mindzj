// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { AboutLinkButton } from "../AboutPanel";

describe("AboutLinkButton", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    describe("Rendering", () => {
        it("renders without crashing", () => {
            const { container } = render(() => (
                <AboutLinkButton icon="🔗" label="Website" onClick={() => {}} />
            ));
            expect(container).toBeTruthy();
            expect(container.innerHTML.length).toBeGreaterThan(0);
        });

        it("displays the icon text", () => {
            render(() => (
                <AboutLinkButton icon="🔗" label="Website" onClick={() => {}} />
            ));
            expect(screen.getByText("🔗")).toBeTruthy();
        });

        it("displays the label text", () => {
            render(() => (
                <AboutLinkButton icon="🔗" label="Website" onClick={() => {}} />
            ));
            expect(screen.getByText("Website")).toBeTruthy();
        });
    });

    describe("Interaction", () => {
        it("calls onClick when clicked", () => {
            const onClick = vi.fn();
            render(() => (
                <AboutLinkButton icon="🔗" label="Website" onClick={onClick} />
            ));
            const button = screen.getByRole("button");
            button.click();
            expect(onClick).toHaveBeenCalledTimes(1);
        });
    });
});
