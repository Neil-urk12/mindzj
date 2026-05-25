import { describe, expect, it, beforeEach } from "vitest";
import {
    pluginDataDirMap,
    getPluginDataDir,
    setPluginDataDir,
    deletePluginDataDir,
} from "./plugins";

// ── Plugin data directory map ──────────────────────────────────────

describe("pluginDataDirMap", () => {
    beforeEach(() => {
        pluginDataDirMap.clear();
    });

    it("is an empty Map by default", () => {
        expect(pluginDataDirMap).toBeInstanceOf(Map);
        expect(pluginDataDirMap.size).toBe(0);
    });

    it("stores and retrieves entries", () => {
        pluginDataDirMap.set("my-plugin", "my_plugin_dir");
        expect(pluginDataDirMap.get("my-plugin")).toBe("my_plugin_dir");
    });
});

describe("getPluginDataDir", () => {
    beforeEach(() => {
        pluginDataDirMap.clear();
    });

    it("returns mapped dir when pluginId exists", () => {
        pluginDataDirMap.set("test-plugin", "test_plugin_data");
        expect(getPluginDataDir("test-plugin")).toBe("test_plugin_data");
    });

    it("returns pluginId itself when no mapping exists", () => {
        expect(getPluginDataDir("unknown-plugin")).toBe("unknown-plugin");
    });
});

describe("setPluginDataDir", () => {
    beforeEach(() => {
        pluginDataDirMap.clear();
    });

    it("adds a mapping to the map", () => {
        setPluginDataDir("p1", "dir1");
        expect(pluginDataDirMap.get("p1")).toBe("dir1");
        expect(pluginDataDirMap.size).toBe(1);
    });

    it("overwrites an existing mapping", () => {
        setPluginDataDir("p1", "dir1");
        setPluginDataDir("p1", "dir2");
        expect(pluginDataDirMap.get("p1")).toBe("dir2");
        expect(pluginDataDirMap.size).toBe(1);
    });

    it("falls back to pluginId for path traversal attempts", () => {
        setPluginDataDir("p1", "..");
        expect(pluginDataDirMap.get("p1")).toBe("p1");

        setPluginDataDir("p2", "../../etc/passwd");
        expect(pluginDataDirMap.get("p2")).toBe("p2");

        setPluginDataDir("p3", "foo/bar");
        expect(pluginDataDirMap.get("p3")).toBe("p3");

        setPluginDataDir("p4", "foo\\bar");
        expect(pluginDataDirMap.get("p4")).toBe("p4");

        setPluginDataDir("p5", "");
        expect(pluginDataDirMap.get("p5")).toBe("p5");
    });
});

describe("deletePluginDataDir", () => {
    beforeEach(() => {
        pluginDataDirMap.clear();
    });

    it("removes a mapping from the map", () => {
        pluginDataDirMap.set("p1", "dir1");
        deletePluginDataDir("p1");
        expect(pluginDataDirMap.has("p1")).toBe(false);
        expect(pluginDataDirMap.size).toBe(0);
    });

    it("is a no-op when pluginId does not exist", () => {
        deletePluginDataDir("nonexistent");
        expect(pluginDataDirMap.size).toBe(0);
    });
});
