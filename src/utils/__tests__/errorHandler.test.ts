import { describe, it, expect, vi } from "vitest";
import { handleStoreError } from "../errorHandler";

describe("handleStoreError", () => {
  it("extracts .message from Error objects", () => {
    const setError = vi.fn();
    const error = new Error("disk full");

    const result = handleStoreError(error, "Failed to save file", setError);

    expect(result).toBe("disk full");
    expect(setError).toHaveBeenCalledWith("disk full");
  });

  it("falls back to default message when error has no .message", () => {
    const setError = vi.fn();
    const error = { code: 500 };

    const result = handleStoreError(error, "Failed to open vault", setError);

    expect(result).toBe("Failed to open vault");
    expect(setError).toHaveBeenCalledWith("Failed to open vault");
  });

  it("handles string errors", () => {
    const setError = vi.fn();

    const result = handleStoreError(
      "connection refused",
      "Failed to load data",
      setError,
    );

    expect(result).toBe("connection refused");
    expect(setError).toHaveBeenCalledWith("connection refused");
  });

  it("handles null errors with default message", () => {
    const setError = vi.fn();

    const result = handleStoreError(null, "Unknown error", setError);

    expect(result).toBe("Unknown error");
    expect(setError).toHaveBeenCalledWith("Unknown error");
  });

  it("handles undefined errors with default message", () => {
    const setError = vi.fn();

    const result = handleStoreError(undefined, "Unknown error", setError);

    expect(result).toBe("Unknown error");
    expect(setError).toHaveBeenCalledWith("Unknown error");
  });

  it("uses empty-string message from Error when present", () => {
    const setError = vi.fn();
    const error = new Error("");

    const result = handleStoreError(error, "Fallback", setError);

    // empty string is falsy → should fall back
    expect(result).toBe("Fallback");
    expect(setError).toHaveBeenCalledWith("Fallback");
  });

  it("returns the error message string", () => {
    const setError = vi.fn();
    const error = new Error("boom");

    const result = handleStoreError(error, "Default", setError);

    expect(typeof result).toBe("string");
    expect(result).toBe("boom");
  });
});
