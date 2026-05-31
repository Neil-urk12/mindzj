import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
    extractHeadings,
    findRenamedHeadings,
    findRenamedAnchors,
    updateBacklinksOnFileRename,
    updateBacklinksOnHeadingRename,
} from "./linkUpdater";

vi.mock("@tauri-apps/api/core");

describe("linkUpdater", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Pure logic: extractHeadings ──

    describe("extractHeadings", () => {
        it("parses multi-level markdown headers", () => {
            const content = "# H1\n## H2\n### H3\n";
            expect(extractHeadings(content)).toEqual(["H1", "H2", "H3"]);
        });

        it("trims whitespace from headings", () => {
            const content = "## Heading  \n### Another  ";
            expect(extractHeadings(content)).toEqual(["Heading", "Another"]);
        });

        it("returns empty array for no headers", () => {
            expect(extractHeadings("Just text\nNo headers")).toEqual([]);
        });

        it("ignores inline # that are not headers", () => {
            const content = "text # not a header\n# Real Header";
            expect(extractHeadings(content)).toEqual(["Real Header"]);
        });

        it("handles level 6 headers", () => {
            const content = "###### Deep";
            expect(extractHeadings(content)).toEqual(["Deep"]);
        });

        it("handles empty content", () => {
            expect(extractHeadings("")).toEqual([]);
        });
    });

    // ── Pure logic: findRenamedHeadings ──

    describe("findRenamedHeadings", () => {
        it("detects position-based rename", () => {
            const result = findRenamedHeadings(
                ["Old Heading", "Another"],
                ["New Heading", "Another"],
            );
            expect(result).toEqual([["Old Heading", "New Heading"]]);
        });

        it("returns empty when heading moved (not renamed)", () => {
            const result = findRenamedHeadings(["A"], ["B", "A"]);
            expect(result).toEqual([]);
        });

        it("detects multiple renames", () => {
            const result = findRenamedHeadings(
                ["A", "B"],
                ["X", "Y"],
            );
            expect(result).toEqual([
                ["A", "X"],
                ["B", "Y"],
            ]);
        });

        it("returns empty when new list is longer (additions, not renames)", () => {
            const result = findRenamedHeadings(["A"], ["A", "B"]);
            expect(result).toEqual([]);
        });

        it("returns empty when new list is shorter (deletions, not renames)", () => {
            const result = findRenamedHeadings(["A", "B"], ["A"]);
            expect(result).toEqual([]);
        });

        it("returns empty for empty inputs", () => {
            expect(findRenamedHeadings([], [])).toEqual([]);
        });
    });

    // ── Pure logic: findRenamedAnchors ──

    describe("findRenamedAnchors", () => {
        it("matches anchor text at same line position", () => {
            const result = findRenamedAnchors(
                ["foo"],
                "line1\nfoo\nline3",
                "line1\nbar\nline3",
            );
            expect(result).toEqual([["foo", "bar"]]);
        });

        it("detects heading rename at same position", () => {
            const result = findRenamedAnchors(
                ["## Old"],
                "## Old\ntext",
                "## New\ntext",
            );
            expect(result).toEqual([["## Old", "New"]]);
        });

        it("returns empty when anchor still exists in new content", () => {
            const result = findRenamedAnchors(
                ["exists"],
                "exists\nline2",
                "exists\nline2",
            );
            expect(result).toEqual([]);
        });

        it("returns empty when anchor still exists (case-insensitive)", () => {
            const result = findRenamedAnchors(
                ["Foo"],
                "foo\nline2",
                "foo\nline2",
            );
            expect(result).toEqual([]);
        });

        it("handles old line index out of bounds gracefully", () => {
            const result = findRenamedAnchors(
                ["x"],
                "line1\nline2\nline3",
                "short",
            );
            expect(result).toEqual([]);
        });

        it("returns empty for empty anchor list", () => {
            expect(findRenamedAnchors([], "content", "content")).toEqual([]);
        });

        it("handles heading extraction in new content", () => {
            const result = findRenamedAnchors(
                ["heading"],
                "heading\nmore",
                "## New Heading\nmore",
            );
            expect(result).toEqual([["heading", "New Heading"]]);
        });
    });

    // ── Async: updateBacklinksOnFileRename ──

    describe("updateBacklinksOnFileRename", () => {
        it("replaces wiki links in backlinked files", async () => {
            const mockInvoke = vi.mocked(invoke);
            mockInvoke.mockResolvedValueOnce({
                content: "Check [[oldName]] and [[oldName#section]]",
            });

            const backlinks = [
                {
                    source: "file.md",
                    target: "oldName",
                    display_text: null,
                    link_type: "wiki",
                    line: 1,
                },
            ];

            await updateBacklinksOnFileRename(
                "oldName.md",
                "newName.md",
                backlinks,
            );

            expect(mockInvoke).toHaveBeenCalledWith(
                "write_file",
                expect.objectContaining({
                    content: expect.stringContaining("[[newName]]"),
                }),
            );
        });

        it("preserves display text during rename", async () => {
            const mockInvoke = vi.mocked(invoke);
            mockInvoke.mockResolvedValueOnce({
                content: "Link [[oldName|custom text]]",
            });

            const backlinks = [
                {
                    source: "file.md",
                    target: "oldName",
                    display_text: "custom text",
                    link_type: "wiki",
                    line: 1,
                },
            ];

            await updateBacklinksOnFileRename(
                "oldName.md",
                "newName.md",
                backlinks,
            );

            expect(mockInvoke).toHaveBeenCalledWith(
                "write_file",
                expect.objectContaining({
                    content: expect.stringContaining("[[newName|custom text]]"),
                }),
            );
        });

        it("preserves anchor links during rename", async () => {
            const mockInvoke = vi.mocked(invoke);
            mockInvoke.mockResolvedValueOnce({
                content: "Link [[oldName#section]]",
            });

            const backlinks = [
                {
                    source: "file.md",
                    target: "oldName",
                    display_text: null,
                    link_type: "wiki",
                    line: 1,
                },
            ];

            await updateBacklinksOnFileRename(
                "oldName.md",
                "newName.md",
                backlinks,
            );

            expect(mockInvoke).toHaveBeenCalledWith(
                "write_file",
                expect.objectContaining({
                    content: expect.stringContaining("[[newName#section]]"),
                }),
            );
        });

        it("skips when old path equals new path", async () => {
            const mockInvoke = vi.mocked(invoke);

            await updateBacklinksOnFileRename("same.md", "same.md", []);

            expect(mockInvoke).not.toHaveBeenCalled();
        });

        it("handles read_file errors gracefully (file deleted)", async () => {
            const mockInvoke = vi.mocked(invoke);
            mockInvoke.mockRejectedValueOnce(new Error("File not found"));

            const backlinks = [
                {
                    source: "deleted.md",
                    target: "note",
                    display_text: null,
                    link_type: "wiki",
                    line: 1,
                },
            ];

            // Should not throw
            await expect(
                updateBacklinksOnFileRename("note.md", "new.md", backlinks),
            ).resolves.toBeUndefined();
        });

        it("does not write when content unchanged", async () => {
            const mockInvoke = vi.mocked(invoke);
            mockInvoke.mockResolvedValueOnce({
                content: "No links here",
            });

            const backlinks = [
                {
                    source: "file.md",
                    target: "note",
                    display_text: null,
                    link_type: "wiki",
                    line: 1,
                },
            ];

            await updateBacklinksOnFileRename("note.md", "new.md", backlinks);

            // Should not call write_file since content didn't change
            expect(mockInvoke).not.toHaveBeenCalledWith(
                "write_file",
                expect.anything(),
            );
        });
    });

    // ── Async: updateBacklinksOnHeadingRename ──

    describe("updateBacklinksOnHeadingRename", () => {
        it("updates heading links across files", async () => {
            const mockInvoke = vi.mocked(invoke);

            // First call: get_backlinks
            mockInvoke.mockResolvedValueOnce([
                {
                    source: "ref.md",
                    target: "note",
                    display_text: null,
                    link_type: "wiki",
                    line: 1,
                },
            ]);

            // Second call: read_file for ref.md
            mockInvoke.mockResolvedValueOnce({
                content: "See [[note#Old Heading]]",
            });

            await updateBacklinksOnHeadingRename("note.md", "Old Heading", "New Heading");

            expect(mockInvoke).toHaveBeenCalledWith(
                "write_file",
                expect.objectContaining({
                    content: expect.stringContaining("[[note#New Heading]]"),
                }),
            );
        });

        it("skips when old heading equals new heading", async () => {
            const mockInvoke = vi.mocked(invoke);

            await updateBacklinksOnHeadingRename("note.md", "Same", "Same");

            expect(mockInvoke).not.toHaveBeenCalled();
        });

        it("handles same-file heading links", async () => {
            const mockInvoke = vi.mocked(invoke);

            // get_backlinks returns self-reference
            mockInvoke.mockResolvedValueOnce([
                {
                    source: "note.md",
                    target: "note",
                    display_text: null,
                    link_type: "wiki",
                    line: 1,
                },
            ]);

            // read_file for note.md
            mockInvoke.mockResolvedValueOnce({
                content: "Self ref [[#Old]]",
            });

            await updateBacklinksOnHeadingRename("note.md", "Old", "New");

            expect(mockInvoke).toHaveBeenCalledWith(
                "write_file",
                expect.objectContaining({
                    content: expect.stringContaining("[[#New]]"),
                }),
            );
        });
    });
});
