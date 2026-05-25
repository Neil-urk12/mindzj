import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(),
}));

// ── Tests ────────────────────────────────────────────────────────

describe("vault", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
    });

    // ── openVault ────────────────────────────────────────────────

    describe("openVault", () => {
        it("sets vault info and refreshes file tree", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockInfo = { name: "My Vault", path: "/vault" };
            const mockTree = [{ name: "note.md", path: "note.md", entry_type: "file" }];

            vi.mocked(invoke)
                .mockResolvedValueOnce(mockInfo)
                .mockResolvedValueOnce(mockTree);

            const { vaultStore } = await import("./vault");
            await vaultStore.openVault("/vault", "My Vault");

            expect(invoke).toHaveBeenCalledWith("open_vault", { path: "/vault", name: "My Vault" });
            expect(invoke).toHaveBeenCalledWith("get_file_tree", { maxDepth: 10 });
            expect(vaultStore.vaultInfo()).toEqual(mockInfo);
            expect(vaultStore.fileTree()).toEqual(mockTree);
            expect(vaultStore.isLoading()).toBe(false);
        });

        it("sets error and rethrows on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("disk error"));

            const { vaultStore } = await import("./vault");
            await expect(vaultStore.openVault("/vault", "test")).rejects.toThrow("disk error");

            expect(vaultStore.error()).toBe("disk error");
            expect(vaultStore.isLoading()).toBe(false);
        });
    });

    // ── refreshFileTree ──────────────────────────────────────────

    describe("refreshFileTree", () => {
        it("fetches and sets file tree", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockTree = [
                { name: "a.md", path: "a.md", entry_type: "file" },
                { name: "folder", path: "folder", entry_type: "directory", children: [] },
            ];
            vi.mocked(invoke).mockResolvedValueOnce(mockTree);

            const { vaultStore } = await import("./vault");
            await vaultStore.refreshFileTree();

            expect(invoke).toHaveBeenCalledWith("get_file_tree", { maxDepth: 10 });
            expect(vaultStore.fileTree()).toEqual(mockTree);
        });

        it("sets error on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("tree error"));

            const { vaultStore } = await import("./vault");
            await vaultStore.refreshFileTree();

            expect(vaultStore.error()).toBe("tree error");
        });
    });

    // ── openFile ─────────────────────────────────────────────────

    describe("openFile", () => {
        it("reads file and sets as active", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockRaw = { path: "note.md", content: "# Hello", modified: "2024-01-01", hash: "abc" };
            vi.mocked(invoke).mockResolvedValueOnce(mockRaw);

            const { vaultStore } = await import("./vault");
            const result = await vaultStore.openFile("note.md");

            expect(invoke).toHaveBeenCalledWith("read_file", { relativePath: "note.md" });
            expect(result).toEqual({ ...mockRaw, kind: "text" });
            expect(vaultStore.activeFile()).toEqual({ ...mockRaw, kind: "text" });
            expect(vaultStore.openFiles()).toHaveLength(1);
            expect(vaultStore.isLoading()).toBe(false);
        });

        it("upserts into open files if already open", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const first = { path: "note.md", content: "# Old", modified: "t1", hash: "h1" };
            const second = { path: "note.md", content: "# New", modified: "t2", hash: "h2" };
            vi.mocked(invoke).mockResolvedValueOnce(first);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("note.md");

            vi.mocked(invoke).mockResolvedValueOnce(second);
            await vaultStore.openFile("note.md");

            expect(vaultStore.openFiles()).toHaveLength(1);
            expect(vaultStore.openFiles()[0].content).toBe("# New");
        });

        it("sets error and rethrows on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("read error"));

            const { vaultStore } = await import("./vault");
            await expect(vaultStore.openFile("note.md")).rejects.toThrow("read error");

            expect(vaultStore.error()).toBe("read error");
            expect(vaultStore.isLoading()).toBe(false);
        });
    });

    // ── saveFile ─────────────────────────────────────────────────

    describe("saveFile", () => {
        it("writes file and updates state for active file", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const raw = { path: "note.md", content: "# Hello", modified: "t1", hash: "h1" };
            vi.mocked(invoke).mockResolvedValueOnce(raw);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("note.md");

            const saved = { path: "note.md", content: "# Updated", modified: "t2", hash: "h2" };
            vi.mocked(invoke).mockResolvedValueOnce(saved);

            const result = await vaultStore.saveFile("note.md", "# Updated");

            expect(invoke).toHaveBeenCalledWith("write_file", { relativePath: "note.md", content: "# Updated" });
            expect(result).toEqual({ ...saved, kind: "text" });
            expect(vaultStore.activeFile()?.content).toBe("# Updated");
        });

        it("does not update activeFile when saving non-active file", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const fileA = { path: "a.md", content: "A", modified: "", hash: "a" };
            const fileB = { path: "b.md", content: "B", modified: "", hash: "b" };
            const savedA = { path: "a.md", content: "A2", modified: "", hash: "a2" };

            vi.mocked(invoke)
                .mockResolvedValueOnce(fileA)
                .mockResolvedValueOnce(fileB)
                .mockResolvedValueOnce(savedA);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");
            await vaultStore.openFile("b.md"); // b is now active

            await vaultStore.saveFile("a.md", "A2");

            expect(vaultStore.activeFile()?.path).toBe("b.md");
            // But a's content in openFiles should be updated
            expect(vaultStore.openFiles().find((f) => f.path === "a.md")?.content).toBe("A2");
        });

        it("sets error and rethrows on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("write error"));

            const { vaultStore } = await import("./vault");
            await expect(vaultStore.saveFile("note.md", "content")).rejects.toThrow("write error");

            expect(vaultStore.error()).toBe("write error");
        });
    });

    // ── createFile ───────────────────────────────────────────────

    describe("createFile", () => {
        it("creates file and refreshes tree", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const created = { path: "new.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke)
                .mockResolvedValueOnce(created)
                .mockResolvedValueOnce([]);

            const { vaultStore } = await import("./vault");
            const result = await vaultStore.createFile("new.md");

            expect(invoke).toHaveBeenCalledWith("create_file", { relativePath: "new.md", content: "" });
            expect(invoke).toHaveBeenCalledWith("get_file_tree", { maxDepth: 10 });
            expect(result).toEqual({ ...created, kind: "text" });
        });

        it("passes custom content", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke)
                .mockResolvedValueOnce({ path: "new.md", content: "# Title", modified: "", hash: "" })
                .mockResolvedValueOnce([]);

            const { vaultStore } = await import("./vault");
            await vaultStore.createFile("new.md", "# Title");

            expect(invoke).toHaveBeenCalledWith("create_file", { relativePath: "new.md", content: "# Title" });
        });

        it("sets error and rethrows on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("create error"));

            const { vaultStore } = await import("./vault");
            await expect(vaultStore.createFile("new.md")).rejects.toThrow("create error");

            expect(vaultStore.error()).toBe("create error");
        });
    });

    // ── deleteFile ───────────────────────────────────────────────

    describe("deleteFile", () => {
        it("deletes file and refreshes tree", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce([]);

            const { vaultStore } = await import("./vault");
            await vaultStore.deleteFile("note.md");

            expect(invoke).toHaveBeenCalledWith("delete_file", { relativePath: "note.md" });
            expect(invoke).toHaveBeenCalledWith("get_file_tree", { maxDepth: 10 });
        });

        it("removes deleted file from open files and adjusts active", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const fileA = { path: "a.md", content: "", modified: "", hash: "" };
            const fileB = { path: "b.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke)
                .mockResolvedValueOnce(fileA)
                .mockResolvedValueOnce(fileB)
                .mockResolvedValueOnce(undefined)   // delete_file
                .mockResolvedValueOnce([]);           // get_file_tree

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");
            await vaultStore.openFile("b.md");

            await vaultStore.deleteFile("b.md");

            expect(vaultStore.openFiles()).toHaveLength(1);
            expect(vaultStore.openFiles()[0].path).toBe("a.md");
            expect(vaultStore.activeFile()?.path).toBe("a.md");
        });

        it("sets error and rethrows on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("delete error"));

            const { vaultStore } = await import("./vault");
            await expect(vaultStore.deleteFile("note.md")).rejects.toThrow("delete error");

            expect(vaultStore.error()).toBe("delete error");
        });
    });

    // ── deleteDir ────────────────────────────────────────────────

    describe("deleteDir", () => {
        it("deletes directory recursively and refreshes tree", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce([]);

            const { vaultStore } = await import("./vault");
            await vaultStore.deleteDir("folder");

            expect(invoke).toHaveBeenCalledWith("delete_dir", { relativePath: "folder", recursive: true });
        });

        it("removes files inside deleted directory from open files", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const inside = { path: "folder/note.md", content: "", modified: "", hash: "" };
            const outside = { path: "other.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke)
                .mockResolvedValueOnce(inside)
                .mockResolvedValueOnce(outside)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce([]);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("folder/note.md");
            await vaultStore.openFile("other.md");

            await vaultStore.deleteDir("folder");

            expect(vaultStore.openFiles()).toHaveLength(1);
            expect(vaultStore.openFiles()[0].path).toBe("other.md");
        });
    });

    // ── createDir ────────────────────────────────────────────────

    describe("createDir", () => {
        it("creates directory and refreshes tree", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce([]);

            const { vaultStore } = await import("./vault");
            await vaultStore.createDir("new-folder");

            expect(invoke).toHaveBeenCalledWith("create_dir", { relativePath: "new-folder" });
        });

        it("sets error and rethrows on failure", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockRejectedValueOnce(new Error("mkdir error"));

            const { vaultStore } = await import("./vault");
            await expect(vaultStore.createDir("new-folder")).rejects.toThrow("mkdir error");

            expect(vaultStore.error()).toBe("mkdir error");
        });
    });

    // ── closeFile ────────────────────────────────────────────────

    describe("closeFile", () => {
        it("removes file from open files", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockFile = { path: "note.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke).mockResolvedValueOnce(mockFile);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("note.md");
            expect(vaultStore.openFiles()).toHaveLength(1);

            vaultStore.closeFile("note.md");
            expect(vaultStore.openFiles()).toHaveLength(0);
        });

        it("sets active to last remaining file when closing active", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const fileA = { path: "a.md", content: "", modified: "", hash: "" };
            const fileB = { path: "b.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke)
                .mockResolvedValueOnce(fileA)
                .mockResolvedValueOnce(fileB);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");
            await vaultStore.openFile("b.md");
            expect(vaultStore.activeFile()?.path).toBe("b.md");

            vaultStore.closeFile("b.md");
            expect(vaultStore.activeFile()?.path).toBe("a.md");
        });

        it("sets active to null when no files remain", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockFile = { path: "note.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke).mockResolvedValueOnce(mockFile);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("note.md");
            vaultStore.closeFile("note.md");

            expect(vaultStore.activeFile()).toBeNull();
        });
    });

    // ── closeVault ───────────────────────────────────────────────

    describe("closeVault", () => {
        it("resets all state to defaults", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockInfo = { name: "V", path: "/v" };
            const mockFile = { path: "a.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke)
                .mockResolvedValueOnce(mockInfo)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce(mockFile);

            const { vaultStore } = await import("./vault");
            await vaultStore.openVault("/v", "V");
            await vaultStore.openFile("a.md");

            vaultStore.closeVault();

            expect(vaultStore.vaultInfo()).toBeNull();
            expect(vaultStore.fileTree()).toEqual([]);
            expect(vaultStore.activeFile()).toBeNull();
            expect(vaultStore.openFiles()).toEqual([]);
            expect(vaultStore.error()).toBeNull();
            expect(vaultStore.isLoading()).toBe(false);
        });
    });

    // ── switchToFile ─────────────────────────────────────────────

    describe("switchToFile", () => {
        it("sets active to existing open file", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const fileA = { path: "a.md", content: "", modified: "", hash: "" };
            const fileB = { path: "b.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke)
                .mockResolvedValueOnce(fileA)
                .mockResolvedValueOnce(fileB);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");
            await vaultStore.openFile("b.md");

            vaultStore.switchToFile("a.md");
            expect(vaultStore.activeFile()?.path).toBe("a.md");
        });

        it("does nothing if file is not open", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockFile = { path: "a.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke).mockResolvedValueOnce(mockFile);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");

            vaultStore.switchToFile("nonexistent.md");
            expect(vaultStore.activeFile()?.path).toBe("a.md");
        });
    });

    // ── openPreviewFile ──────────────────────────────────────────

    describe("openPreviewFile", () => {
        it("creates preview entry and sets as active", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { vaultStore } = await import("./vault");
            const result = vaultStore.openPreviewFile("image.png", "image");

            expect(result).toEqual({
                path: "image.png",
                content: "",
                modified: "",
                hash: "",
                kind: "image",
            });
            expect(vaultStore.activeFile()?.path).toBe("image.png");
            expect(vaultStore.openFiles()).toHaveLength(1);
        });

        it("upserts if preview already open", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            vi.mocked(invoke).mockResolvedValue(undefined);

            const { vaultStore } = await import("./vault");
            vaultStore.openPreviewFile("image.png", "image");
            vaultStore.openPreviewFile("image.png", "document");

            expect(vaultStore.openFiles()).toHaveLength(1);
            expect(vaultStore.openFiles()[0].kind).toBe("document");
        });
    });

    // ── reloadFile ───────────────────────────────────────────────

    describe("reloadFile", () => {
        it("reloads content without changing active tab", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const fileA = { path: "a.md", content: "A", modified: "", hash: "ha" };
            const fileB = { path: "b.md", content: "B", modified: "", hash: "hb" };
            const updatedA = { path: "a.md", content: "A2", modified: "", hash: "ha2" };

            vi.mocked(invoke)
                .mockResolvedValueOnce(fileA)
                .mockResolvedValueOnce(fileB)
                .mockResolvedValueOnce(updatedA);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");
            await vaultStore.openFile("b.md"); // b is active

            await vaultStore.reloadFile("a.md");

            // active is still b
            expect(vaultStore.activeFile()?.path).toBe("b.md");
            // but a's content updated in openFiles
            expect(vaultStore.openFiles().find((f) => f.path === "a.md")?.content).toBe("A2");
        });

        it("updates active file signal when reloading active file", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const file = { path: "a.md", content: "old", modified: "", hash: "h1" };
            const updated = { path: "a.md", content: "new", modified: "", hash: "h2" };

            vi.mocked(invoke)
                .mockResolvedValueOnce(file)
                .mockResolvedValueOnce(updated);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");
            await vaultStore.reloadFile("a.md");

            expect(vaultStore.activeFile()?.content).toBe("new");
            expect(vaultStore.activeFile()?.hash).toBe("h2");
        });
    });

    // ── renameFilePath ───────────────────────────────────────────

    describe("renameFilePath", () => {
        it("updates paths in open files and active file", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const mockFile = { path: "old.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke).mockResolvedValueOnce(mockFile);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("old.md");

            vaultStore.renameFilePath("old.md", "new.md");

            expect(vaultStore.activeFile()?.path).toBe("new.md");
            expect(vaultStore.openFiles()[0].path).toBe("new.md");
        });
    });

    // ── reorderOpenFiles ─────────────────────────────────────────

    describe("reorderOpenFiles", () => {
        it("moves file from one index to another", async () => {
            const { invoke } = await import("@tauri-apps/api/core");
            const fileA = { path: "a.md", content: "", modified: "", hash: "" };
            const fileB = { path: "b.md", content: "", modified: "", hash: "" };
            const fileC = { path: "c.md", content: "", modified: "", hash: "" };
            vi.mocked(invoke)
                .mockResolvedValueOnce(fileA)
                .mockResolvedValueOnce(fileB)
                .mockResolvedValueOnce(fileC);

            const { vaultStore } = await import("./vault");
            await vaultStore.openFile("a.md");
            await vaultStore.openFile("b.md");
            await vaultStore.openFile("c.md");

            vaultStore.reorderOpenFiles(0, 2); // move a past c

            expect(vaultStore.openFiles().map((f) => f.path)).toEqual(["b.md", "c.md", "a.md"]);
        });
    });
});
