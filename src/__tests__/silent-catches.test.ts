import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Check if a catch block near a given line has logging (console.warn/console.error).
 * Returns false for empty catch blocks or catch blocks that only swallow errors.
 */
function hasCatchWithLogging(content: string, nearLine: number): boolean {
    const lines = content.split("\n");
    const start = Math.max(0, nearLine - 5);
    const end = Math.min(lines.length, nearLine + 10);
    const window = lines.slice(start, end).join("\n");

    // Pattern 1: catch () {} empty block
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(window)) {
        return false;
    }

    // Pattern 2: .catch(() => undefined) or .catch(() => null)
    if (/\.catch\(\s*\([^)]*\)\s*=>\s*(undefined|null)\s*\)/.test(window)) {
        return false;
    }

    // Pattern 3: catch with body — check for logging
    const catchMatch = window.match(/catch\s*(?:\([^)]*\))?\s*\{([^}]*)\}/s);
    if (catchMatch) {
        const catchBody = catchMatch[1];
        return (
            catchBody.includes("console.warn") ||
            catchBody.includes("console.error")
        );
    }

    // No catch block found in window
    return false;
}
/**
 * Scan entire file content and return line numbers of all empty catch blocks.
 * Matches: catch {} / catch (e) {} / .catch(() => {}) / .catch(() => undefined)
 */
function findAllEmptyCatches(content: string): number[] {
    const lines = content.split("\n");
    const emptyCatchLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Pattern 1: catch () {} or catch (e) {} on same line
        if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
            emptyCatchLines.push(i + 1);
            continue;
        }

        // Pattern 2: .catch(() => undefined) or .catch(() => null)
        if (/\.catch\(\s*\([^)]*\)\s*=>\s*(undefined|null)\s*\)/.test(line)) {
            emptyCatchLines.push(i + 1);
            continue;
        }

        // Pattern 3: catch (e) { on this line, } on next (empty multiline)
        if (/catch\s*(\([^)]*\))?\s*\{\s*$/.test(line.trim())) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine === "}") {
                emptyCatchLines.push(i + 1);
            }
        }
    }

    return emptyCatchLines;
}

const srcDir = resolve(__dirname, "..");

function readSrc(relativePath: string): string {
    return readFileSync(resolve(srcDir, relativePath), "utf-8");
}

describe("high-risk catch blocks should have logging", () => {
    it("stores/plugins.ts markActive catch should log (line 165)", () => {
        const content = readSrc("stores/plugins.ts");
        expect(hasCatchWithLogging(content, 165)).toBe(true);
    });

    it("PluginSettingsPanel.tsx list_plugins catch should log (line 90)", () => {
        const content = readSrc("components/settings/PluginSettingsPanel.tsx");
        expect(hasCatchWithLogging(content, 90)).toBe(true);
    });

    it("pdfExport.ts fonts.ready catch should log (line 23)", () => {
        const content = readSrc("utils/pdfExport.ts");
        expect(hasCatchWithLogging(content, 23)).toBe(true);
    });

    it("VaultSwitcher.tsx localStorage catch should log (line 30)", () => {
        const content = readSrc("components/sidebar/VaultSwitcher.tsx");
        expect(hasCatchWithLogging(content, 30)).toBe(true);
    });

    it("stores/plugins.ts DOM removal catch should log (line 428)", () => {
        const content = readSrc("stores/plugins.ts");
        expect(hasCatchWithLogging(content, 428)).toBe(true);
    });

    it("stores/plugins.ts event listener removal catch should log (line 444)", () => {
        const content = readSrc("stores/plugins.ts");
        expect(hasCatchWithLogging(content, 444)).toBe(true);
    });

    it("stores/plugins.ts plugin onClose lifecycle catch should log (line 747)", () => {
        const content = readSrc("stores/plugins.ts");
        expect(hasCatchWithLogging(content, 747)).toBe(true);
    });

    it("stores/plugins.ts plugin onunload lifecycle catch should log (line 758)", () => {
        const content = readSrc("stores/plugins.ts");
        expect(hasCatchWithLogging(content, 758)).toBe(true);
    });

    it("PluginSettingsPanel.tsx settingTab.hide catch should log (line 118)", () => {
        const content = readSrc("components/settings/PluginSettingsPanel.tsx");
        expect(hasCatchWithLogging(content, 118)).toBe(true);
    });
});

describe("no file should have empty catch blocks", () => {
    const filesToCheck = [
        "stores/plugins.ts",
        "components/settings/PluginSettingsPanel.tsx",
        "components/sidebar/VaultSwitcher.tsx",
        "utils/pdfExport.ts",
        "plugin-shim/index.ts",
    ];

    // Intentionally excluded (documented intentional empty/promise catches):
    // - utils/linkUpdater.ts: bare catch { } for file-deleted-since-index / graceful degradation
    // - utils/markdownRenderer.ts: bare catch { } for KaTeX and Shiki fallback rendering
    // - stores/aiService.ts: .catch(() => null) for key migration fallback + bare catch { } for progress/model-listing safety

    for (const file of filesToCheck) {
        it(`${file} should have no empty catches`, () => {
            const content = readSrc(file);
            const emptyCatches = findAllEmptyCatches(content);
            expect(emptyCatches).toEqual([]);
        });
    }
});
