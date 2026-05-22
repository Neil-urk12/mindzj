import { describe, expect, it } from "vitest";
import {
  TOOL_DEFINITIONS,
  NOTE_TOOL_PARAMETERS,
  OPTIONAL_MINDMAP_PATH_PROPERTY,
  MINDMAP_TEXT_PATH_PROPERTY,
} from "../definitions";

describe("TOOL_DEFINITIONS", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(TOOL_DEFINITIONS)).toBe(true);
    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("has unique tool names", () => {
    const names = TOOL_DEFINITIONS.map((def) => def.function.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("each definition has valid structure", () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.type).toBe("function");
      expect(typeof def.function.name).toBe("string");
      expect(def.function.name.length).toBeGreaterThan(0);
      expect(typeof def.function.description).toBe("string");
      expect(def.function.description.length).toBeGreaterThan(0);
      expect(def.function.parameters).toBeDefined();
      expect(typeof def.function.parameters).toBe("object");
    }
  });
});

describe("shared schemas", () => {
  it("NOTE_TOOL_PARAMETERS has valid structure", () => {
    expect(NOTE_TOOL_PARAMETERS.type).toBe("object");
    expect(NOTE_TOOL_PARAMETERS.properties).toBeDefined();
    expect(NOTE_TOOL_PARAMETERS.required).toContain("path");
  });

  it("OPTIONAL_MINDMAP_PATH_PROPERTY has type string", () => {
    expect(OPTIONAL_MINDMAP_PATH_PROPERTY.type).toBe("string");
  });

  it("MINDMAP_TEXT_PATH_PROPERTY has type array", () => {
    expect(MINDMAP_TEXT_PATH_PROPERTY.type).toBe("array");
    expect(MINDMAP_TEXT_PATH_PROPERTY.items).toEqual({ type: "string" });
  });
});
