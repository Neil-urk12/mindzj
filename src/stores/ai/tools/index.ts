// Barrel export for AI tool system.
// ai.ts imports everything from here.
import { TOOL_DEFINITIONS } from "./definitions";

export {
  TOOL_DEFINITIONS,
  NOTE_TOOL_PARAMETERS,
  OPTIONAL_MINDMAP_PATH_PROPERTY,
  MINDMAP_TEXT_PATH_PROPERTY,
} from "./definitions";

export {
  executeTool,
  summarizeToolCall,
  appendNaturalResponseToActiveNote,
  runJsonFallback,
} from "./handlers";

export { buildToolContext, looksLikeToolFailureSummary } from "./mindmap";

/** Returns TOOL_DEFINITIONS. Trivial wrapper for call-site clarity. */
export function getToolDefinitions() {
  return TOOL_DEFINITIONS;
}
