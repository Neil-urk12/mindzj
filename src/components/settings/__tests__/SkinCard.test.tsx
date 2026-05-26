// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import type { BuiltInSkin } from "../../../styles/themes";
import { SkinCard } from "../SkinCard";

const mockSkin: BuiltInSkin = {
    id: "midnight-blue",
    label: "Midnight Blue",
    mode: "dark",
    swatch: ["#1a1b2e", "#4a6fa5"],
};

describe("SkinCard", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    describe("Rendering", () => {
        it("renders without crashing", () => {
            const { container } = render(() => (
                <SkinCard skin={mockSkin} active={false} onSelect={() => {}} />
            ));
            expect(container).toBeTruthy();
            expect(container.innerHTML.length).toBeGreaterThan(0);
        });

        it("displays the skin label", () => {
            render(() => (
                <SkinCard skin={mockSkin} active={false} onSelect={() => {}} />
            ));
            expect(screen.getByText("Midnight Blue")).toBeTruthy();
        });

        it("displays the skin mode", () => {
            render(() => (
                <SkinCard skin={mockSkin} active={false} onSelect={() => {}} />
            ));
            expect(screen.getByText("dark")).toBeTruthy();
        });

        it("renders two color swatches", () => {
            const { container } = render(() => (
                <SkinCard skin={mockSkin} active={false} onSelect={() => {}} />
            ));
            const swatches = container.querySelectorAll("span[style]");
            expect(swatches.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe("Interaction", () => {
        it("calls onSelect when clicked", () => {
            const onSelect = vi.fn();
            render(() => (
                <SkinCard skin={mockSkin} active={false} onSelect={onSelect} />
            ));
            const button = screen.getByRole("button");
            button.click();
            expect(onSelect).toHaveBeenCalledTimes(1);
        });
    });

    describe("Active state", () => {
        it("shows accent color in text when active=true", () => {
            render(() => (
                <SkinCard skin={mockSkin} active={true} onSelect={() => {}} />
            ));
            const label = screen.getByText("Midnight Blue");
            const style = label.getAttribute("style") ?? "";
            expect(style).toContain("color");
        });

        it("does not apply accent color when active=false", () => {
            render(() => (
                <SkinCard skin={mockSkin} active={false} onSelect={() => {}} />
            ));
            const label = screen.getByText("Midnight Blue");
            const style = label.getAttribute("style") ?? "";
            expect(style).not.toContain("--mz-accent");
        });
    });
});
