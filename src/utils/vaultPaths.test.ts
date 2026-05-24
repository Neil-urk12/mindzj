import { describe, expect, it, vi } from "vitest";
import {
  normalizeSlashes,
  normalizeVaultRelativePath,
  getParentPath,
  joinVaultPath,
  isExternalPath,
  resolveNoteRelativePath,
  toVaultAssetUrl,
  resolveImageAssetUrl,
  DEFAULT_ATTACHMENT_FOLDER,
} from "./vaultPaths";

// Mock @tauri-apps/api/core so toVaultAssetUrl / resolveImageAssetUrl
// can run outside the Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path.replace(/^\/+/, "")}`,
}));

// ---------------------------------------------------------------------------
// normalizeSlashes
// ---------------------------------------------------------------------------
describe("normalizeSlashes", () => {
  it("replaces backslashes with forward slashes", () => {
    expect(normalizeSlashes("foo\\bar\\baz")).toBe("foo/bar/baz");
  });

  it("leaves forward slashes unchanged", () => {
    expect(normalizeSlashes("foo/bar/baz")).toBe("foo/bar/baz");
  });

  it("handles mixed slashes", () => {
    expect(normalizeSlashes("foo\\bar/baz\\qux")).toBe("foo/bar/baz/qux");
  });

  it("returns empty string unchanged", () => {
    expect(normalizeSlashes("")).toBe("");
  });

  it("handles string with only backslashes", () => {
    expect(normalizeSlashes("\\\\\\")).toBe("///");
  });

  it("handles single backslash", () => {
    expect(normalizeSlashes("\\")).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// normalizeVaultRelativePath
// ---------------------------------------------------------------------------
describe("normalizeVaultRelativePath", () => {
  it("normalizes backslashes", () => {
    expect(normalizeVaultRelativePath("foo\\bar")).toBe("foo/bar");
  });

  it("collapses consecutive slashes", () => {
    expect(normalizeVaultRelativePath("foo///bar")).toBe("foo/bar");
  });

  it("strips leading slashes", () => {
    expect(normalizeVaultRelativePath("/foo/bar")).toBe("foo/bar");
  });

  it("strips trailing slashes", () => {
    expect(normalizeVaultRelativePath("foo/bar/")).toBe("foo/bar");
  });

  it("strips both leading and trailing slashes", () => {
    expect(normalizeVaultRelativePath("/foo/bar/")).toBe("foo/bar");
  });

  it("collapses and strips slashes simultaneously", () => {
    expect(normalizeVaultRelativePath("///foo///bar///")).toBe("foo/bar");
  });

  it("trims whitespace", () => {
    expect(normalizeVaultRelativePath("  foo/bar  ")).toBe("foo/bar");
  });

  it("returns default fallback for empty string", () => {
    expect(normalizeVaultRelativePath("")).toBe(DEFAULT_ATTACHMENT_FOLDER);
  });

  it("returns default fallback for whitespace-only input", () => {
    expect(normalizeVaultRelativePath("   ")).toBe(DEFAULT_ATTACHMENT_FOLDER);
  });

  it("returns default fallback for slashes-only input", () => {
    expect(normalizeVaultRelativePath("///")).toBe(DEFAULT_ATTACHMENT_FOLDER);
  });

  it("uses custom fallback when provided", () => {
    expect(normalizeVaultRelativePath("", "custom/fallback")).toBe("custom/fallback");
  });

  it("returns custom fallback for empty input", () => {
    expect(normalizeVaultRelativePath("/", "default")).toBe("default");
  });

  it("handles single segment", () => {
    expect(normalizeVaultRelativePath("images")).toBe("images");
  });

  it("handles deeply nested paths", () => {
    expect(normalizeVaultRelativePath("a/b/c/d/e/f")).toBe("a/b/c/d/e/f");
  });

  it("handles path with spaces", () => {
    expect(normalizeVaultRelativePath("my folder/my file")).toBe("my folder/my file");
  });

  it("handles path with dots", () => {
    expect(normalizeVaultRelativePath("./foo/../bar")).toBe("./foo/../bar");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_ATTACHMENT_FOLDER re-export
// ---------------------------------------------------------------------------
describe("DEFAULT_ATTACHMENT_FOLDER", () => {
  it("is .mindzj/images", () => {
    expect(DEFAULT_ATTACHMENT_FOLDER).toBe(".mindzj/images");
  });
});

// ---------------------------------------------------------------------------
// getParentPath
// ---------------------------------------------------------------------------
describe("getParentPath", () => {
  it("returns parent for nested path", () => {
    expect(getParentPath("foo/bar/baz")).toBe("foo/bar");
  });

  it("returns parent for two-segment path", () => {
    expect(getParentPath("foo/bar")).toBe("foo");
  });

  it("returns empty string for single segment", () => {
    expect(getParentPath("foo")).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(getParentPath("")).toBe("");
  });

  it("strips trailing slashes before computing parent", () => {
    expect(getParentPath("foo/bar/")).toBe("foo");
  });

  it("normalizes backslashes", () => {
    expect(getParentPath("foo\\bar\\baz")).toBe("foo/bar");
  });

  it("handles root-like path", () => {
    expect(getParentPath("/foo")).toBe("");
  });

  it("returns empty string for single backslash", () => {
    expect(getParentPath("\\")).toBe("");
  });

  it("handles deeply nested path", () => {
    expect(getParentPath("a/b/c/d/e")).toBe("a/b/c/d");
  });

  it("handles trailing multiple slashes", () => {
    expect(getParentPath("foo/bar///")).toBe("foo");
  });
});

// ---------------------------------------------------------------------------
// joinVaultPath
// ---------------------------------------------------------------------------
describe("joinVaultPath", () => {
  it("joins simple segments", () => {
    expect(joinVaultPath("foo", "bar", "baz")).toBe("foo/bar/baz");
  });

  it("joins with trailing slashes", () => {
    expect(joinVaultPath("foo/", "bar/")).toBe("foo/bar");
  });

  it("joins with leading slashes", () => {
    expect(joinVaultPath("/foo", "/bar")).toBe("foo/bar");
  });

  it("normalizes backslashes in parts", () => {
    expect(joinVaultPath("foo\\bar", "baz")).toBe("foo/bar/baz");
  });

  it("collapses consecutive slashes within parts", () => {
    expect(joinVaultPath("foo///bar", "baz")).toBe("foo/bar/baz");
  });

  it("skips empty segments", () => {
    expect(joinVaultPath("foo", "", "bar")).toBe("foo/bar");
  });

  it("resolves single dot", () => {
    expect(joinVaultPath("foo", ".", "bar")).toBe("foo/bar");
  });

  it("resolves double dot", () => {
    expect(joinVaultPath("foo", "bar", "..", "baz")).toBe("foo/baz");
  });

  it("resolves multiple double dots", () => {
    expect(joinVaultPath("a", "b", "c", "..", "..", "d")).toBe("a/d");
  });

  it("does not go above root with double dot", () => {
    expect(joinVaultPath("foo", "..", "..", "bar")).toBe("bar");
  });

  it("returns empty string for no arguments", () => {
    expect(joinVaultPath()).toBe("");
  });

  it("returns single segment unchanged", () => {
    expect(joinVaultPath("foo")).toBe("foo");
  });

  it("handles single dot only", () => {
    expect(joinVaultPath(".")).toBe("");
  });

  it("handles double dot only", () => {
    expect(joinVaultPath("..")).toBe("");
  });

  it("joins paths with spaces", () => {
    expect(joinVaultPath("my folder", "my file")).toBe("my folder/my file");
  });

  it("handles deeply nested resolution", () => {
    expect(joinVaultPath("a/b", "c/d", "e/f")).toBe("a/b/c/d/e/f");
  });

  it("complex dot resolution", () => {
    expect(joinVaultPath("a", "b", "c", "..", "d", "..")).toBe("a/b");
  });

  it("part with mixed dots and normal segments", () => {
    expect(joinVaultPath("foo/./bar/../baz")).toBe("foo/baz");
  });
});

// ---------------------------------------------------------------------------
// isExternalPath
// ---------------------------------------------------------------------------
describe("isExternalPath", () => {
  it("detects http URLs", () => {
    expect(isExternalPath("http://example.com")).toBe(true);
  });

  it("detects https URLs", () => {
    expect(isExternalPath("https://example.com/path")).toBe(true);
  });

  it("detects ftp URLs", () => {
    expect(isExternalPath("ftp://files.example.com")).toBe(true);
  });

  it("detects mailto URLs", () => {
    expect(isExternalPath("mailto:user@example.com")).toBe(true);
  });

  it("detects data URIs", () => {
    expect(isExternalPath("data:image/png;base64,abc123")).toBe(true);
  });

  it("rejects relative paths", () => {
    expect(isExternalPath("images/photo.png")).toBe(false);
  });

  it("rejects absolute Unix paths", () => {
    expect(isExternalPath("/home/user/file")).toBe(false);
  });

  it("rejects Windows drive letters", () => {
    expect(isExternalPath("C:\\Users\\file")).toBe(false);
  });

  it("rejects single-letter scheme (drive letter edge case)", () => {
    expect(isExternalPath("C:/file")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isExternalPath("")).toBe(false);
  });

  it("rejects plain filename", () => {
    expect(isExternalPath("photo.png")).toBe(false);
  });

  it("detects custom schemes with multi-char prefix", () => {
    expect(isExternalPath("myapp://resource")).toBe(true);
  });

  it("detects obsidian:// URLs", () => {
    expect(isExternalPath("obsidian://open?vault=myVault")).toBe(true);
  });

  it("accepts path with colon as external (matches scheme regex)", () => {
    expect(isExternalPath("foo:bar/baz")).toBe(true); // "foo:" matches scheme regex (initial letter + 1+ alphanumeric chars before colon)
  });

  it("rejects dot-relative paths", () => {
    expect(isExternalPath("./images/photo.png")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveNoteRelativePath
// ---------------------------------------------------------------------------
describe("resolveNoteRelativePath", () => {
  it("resolves relative path against current file parent", () => {
    expect(resolveNoteRelativePath("image.png", "notes/daily.md")).toBe("notes/image.png");
  });

  it("resolves deeply nested relative path", () => {
    expect(resolveNoteRelativePath("../assets/img.png", "notes/daily/test.md")).toBe(
      "notes/assets/img.png",
    );
  });

  it("resolves absolute vault path (leading slash)", () => {
    expect(resolveNoteRelativePath("/images/photo.png")).toBe("images/photo.png");
  });

  it("resolves absolute path with current file context ignored", () => {
    expect(resolveNoteRelativePath("/root/file.png", "notes/deep/nested.md")).toBe(
      "root/file.png",
    );
  });

  it("returns empty string for empty path", () => {
    expect(resolveNoteRelativePath("", "notes/file.md")).toBe("");
  });

  it("returns empty string for whitespace-only path", () => {
    expect(resolveNoteRelativePath("   ", "notes/file.md")).toBe("");
  });

  it("resolves .mindzj/ paths directly", () => {
    expect(resolveNoteRelativePath(".mindzj/images/photo.png")).toBe(
      ".mindzj/images/photo.png",
    );
  });

  it("resolves .mindzj/ path regardless of current file", () => {
    expect(resolveNoteRelativePath(".mindzj/themes/dark.css", "notes/deep.md")).toBe(
      ".mindzj/themes/dark.css",
    );
  });

  it("uses empty parent when currentFilePath is undefined", () => {
    expect(resolveNoteRelativePath("image.png")).toBe("image.png");
  });

  it("normalizes backslashes in path", () => {
    expect(resolveNoteRelativePath("foo\\bar.png", "notes/test.md")).toBe("notes/foo/bar.png");
  });

  it("normalizes backslashes in currentFilePath", () => {
    expect(resolveNoteRelativePath("image.png", "notes\\daily.md")).toBe("notes/image.png");
  });

  it("resolves relative path with dots", () => {
    expect(resolveNoteRelativePath("./image.png", "notes/folder/file.md")).toBe(
      "notes/folder/image.png",
    );
  });

  it("resolves double-dot traversal", () => {
    expect(resolveNoteRelativePath("../../image.png", "a/b/c/file.md")).toBe("a/image.png");
  });
});

// ---------------------------------------------------------------------------
// toVaultAssetUrl
// ---------------------------------------------------------------------------
describe("toVaultAssetUrl", () => {
  it("constructs asset URL from vault root and relative path", () => {
    expect(toVaultAssetUrl("/home/user/vault", "images/photo.png")).toBe(
      "asset://localhost/home/user/vault/images/photo.png",
    );
  });

  it("strips trailing slashes from vault root", () => {
    expect(toVaultAssetUrl("/home/user/vault/", "images/photo.png")).toBe(
      "asset://localhost/home/user/vault/images/photo.png",
    );
  });

  it("strips Windows extended-length prefix", () => {
    expect(toVaultAssetUrl("\\\\?\\C:\\Users\\vault", "images/photo.png")).toBe(
      "asset://localhost/C:/Users/vault/images/photo.png",
    );
  });

  it("normalizes backslashes in vault root", () => {
    expect(toVaultAssetUrl("C:\\Users\\vault", "images/photo.png")).toBe(
      "asset://localhost/C:/Users/vault/images/photo.png",
    );
  });

  it("normalizes backslashes in relative path", () => {
    expect(toVaultAssetUrl("/vault", "images\\photo.png")).toBe(
      "asset://localhost/vault/images/photo.png",
    );
  });

  it("returns vault root as asset URL when relative path is empty", () => {
    expect(toVaultAssetUrl("/vault", "")).toBe("asset://localhost/vault");
  });

  it("falls back to vault root when relative path is slashes-only", () => {
    expect(toVaultAssetUrl("/vault", "///")).toBe("asset://localhost/vault");
  });

  it("handles vault root with multiple trailing slashes", () => {
    expect(toVaultAssetUrl("/vault///", "file.md")).toBe("asset://localhost/vault/file.md");
  });

  it("handles deeply nested relative path", () => {
    expect(toVaultAssetUrl("/vault", "a/b/c/d/file.png")).toBe(
      "asset://localhost/vault/a/b/c/d/file.png",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveImageAssetUrl
// ---------------------------------------------------------------------------
describe("resolveImageAssetUrl", () => {
  it("returns external URLs unchanged", () => {
    expect(resolveImageAssetUrl("https://example.com/img.png", "/vault")).toBe(
      "https://example.com/img.png",
    );
  });

  it("returns data URIs unchanged", () => {
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveImageAssetUrl(dataUri, "/vault")).toBe(dataUri);
  });

  it("resolves relative image path against current file", () => {
    expect(resolveImageAssetUrl("photo.png", "/vault", "notes/daily.md")).toBe(
      "asset://localhost/vault/notes/photo.png",
    );
  });

  it("resolves absolute vault image path", () => {
    expect(resolveImageAssetUrl("/assets/photo.png", "/vault", "notes/file.md")).toBe(
      "asset://localhost/vault/assets/photo.png",
    );
  });

  it("resolves .mindzj/ prefixed path", () => {
    expect(
      resolveImageAssetUrl(".mindzj/images/clip.png", "/vault", "notes/file.md"),
    ).toBe("asset://localhost/vault/.mindzj/images/clip.png");
  });

  it("resolves image without current file context", () => {
    expect(resolveImageAssetUrl("photo.png", "/vault")).toBe(
      "asset://localhost/vault/photo.png",
    );
  });

  it("normalizes backslashes in src", () => {
    expect(resolveImageAssetUrl("folder\\photo.png", "/vault", "notes/file.md")).toBe(
      "asset://localhost/vault/notes/folder/photo.png",
    );
  });

  it("handles obsidian:// as external", () => {
    expect(resolveImageAssetUrl("obsidian://open?vault=x", "/vault")).toBe(
      "obsidian://open?vault=x",
    );
  });
});
