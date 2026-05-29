import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyToClipboard } from "../clipboard";

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls navigator.clipboard.writeText with the text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyToClipboard("hello");

    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("silently handles clipboard write failure", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("not allowed"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    // Should not throw
    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });

  it("returns true when clipboard write succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyToClipboard("hello");

    expect(result).toBe(true);
  });

  it("returns false when clipboard write fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("not allowed"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const result = await copyToClipboard("hello");

    expect(result).toBe(false);
  });
});
