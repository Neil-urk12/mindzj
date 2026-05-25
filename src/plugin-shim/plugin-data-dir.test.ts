import { describe, expect, it, beforeEach } from "vitest";
import {
    getPluginDataDir,
    setPluginDataDir,
    deletePluginDataDir,
    getAllPluginDataDirs,
} from "./plugin-data-dir";

// Helper to clear all entries between tests
function clearAll() {
    for (const key of getAllPluginDataDirs().keys()) {
        deletePluginDataDir(key);
    }
}

describe("setPluginDataDir", () => {
    beforeEach(clearAll);

    it("returns true and stores mapping for valid inputs", () => {
        expect(setPluginDataDir("p1", "dir1")).toBe(true);
        expect(getPluginDataDir("p1")).toBe("dir1");
    });

    it("overwrites an existing mapping", () => {
        setPluginDataDir("p1", "dir1");
        setPluginDataDir("p1", "dir2");
        expect(getPluginDataDir("p1")).toBe("dir2");
    });

    it("returns false and rejects unsafe pluginId", () => {
        expect(setPluginDataDir("bad/plugin", "dir1")).toBe(false);
        expect(setPluginDataDir("bad\\plugin", "dir1")).toBe(false);
        expect(setPluginDataDir("../escape", "dir1")).toBe(false);
        expect(setPluginDataDir("", "dir1")).toBe(false);
        expect(setPluginDataDir(".", "dir1")).toBe(false);
        expect(setPluginDataDir("p\0evil", "dir1")).toBe(false);
    });

    it("falls back to pluginId for unsafe dirName", () => {
        setPluginDataDir("p1", "..");
        expect(getPluginDataDir("p1")).toBe("p1");

        setPluginDataDir("p2", "../../etc/passwd");
        expect(getPluginDataDir("p2")).toBe("p2");

        setPluginDataDir("p3", "foo/bar");
        expect(getPluginDataDir("p3")).toBe("p3");

        setPluginDataDir("p4", "foo\\bar");
        expect(getPluginDataDir("p4")).toBe("p4");

        setPluginDataDir("p5", "");
        expect(getPluginDataDir("p5")).toBe("p5");

        setPluginDataDir("p6", ".");
        expect(getPluginDataDir("p6")).toBe("p6");

        setPluginDataDir("p7", "dir\0name");
        expect(getPluginDataDir("p7")).toBe("p7");

        setPluginDataDir("p8", "dir name");
        expect(getPluginDataDir("p8")).toBe("p8");
    });

    it("allows valid pluginId patterns", () => {
        expect(setPluginDataDir("my-plugin", "dir1")).toBe(true);
        expect(setPluginDataDir("my_plugin", "dir2")).toBe(true);
        expect(setPluginDataDir("plugin123", "dir3")).toBe(true);
        expect(setPluginDataDir("my.plugin", "dir4")).toBe(true);
    });
});

describe("getPluginDataDir", () => {
    beforeEach(clearAll);

    it("returns mapped dir when pluginId exists", () => {
        setPluginDataDir("test-plugin", "test_plugin_data");
        expect(getPluginDataDir("test-plugin")).toBe("test_plugin_data");
    });

    it("returns pluginId itself when no mapping exists", () => {
        expect(getPluginDataDir("unknown-plugin")).toBe("unknown-plugin");
    });

    it("returns empty string for unsafe pluginId that was never stored", () => {
        expect(getPluginDataDir("../evil")).toBe("");
        expect(getPluginDataDir("my plugin")).toBe("");
    });
});

describe("deletePluginDataDir", () => {
    beforeEach(clearAll);

    it("removes a mapping from the map", () => {
        setPluginDataDir("p1", "dir1");
        deletePluginDataDir("p1");
        expect(getPluginDataDir("p1")).toBe("p1"); // falls back to pluginId
    });

    it("is a no-op when pluginId does not exist", () => {
        deletePluginDataDir("nonexistent");
        expect(getPluginDataDir("nonexistent")).toBe("nonexistent");
    });
});

describe("getAllPluginDataDirs", () => {
    beforeEach(clearAll);

    it("returns empty map by default", () => {
        const all = getAllPluginDataDirs();
        expect(all.size).toBe(0);
    });

    it("returns all stored mappings", () => {
        setPluginDataDir("p1", "dir1");
        setPluginDataDir("p2", "dir2");
        const all = getAllPluginDataDirs();
        expect(all.size).toBe(2);
        expect(all.get("p1")).toBe("dir1");
        expect(all.get("p2")).toBe("dir2");
    });

    it("returns a read-only view (Map methods work but mutation is separate)", () => {
        setPluginDataDir("p1", "dir1");
        const all = getAllPluginDataDirs();
        // ReadonlyMap still has .get(), .has(), .size, .entries(), etc.
        expect(all.has("p1")).toBe(true);
    });
});
