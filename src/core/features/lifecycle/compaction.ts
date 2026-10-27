import type { Settings } from "../../config/settings";

// opencode runs the summarising call with `tools: {}` and `system: []`, so the model that reads
// this can neither call memory_save nor see the memory instructions. It lists what is unsaved in
// the summary instead, and the agent that continues from the summary does the saving.
export function compactionNote(settings: Pick<Settings, "compactionSave">): string | null {
  return settings.compactionSave
    ? [
        'End the summary with a section headed "Not yet saved to memory". List there what a future session would otherwise have to rediscover from this conversation, or write "none".',
        'Start that section with this line, addressed to the agent that continues after the compaction: "Save each item below with memory_save, judged against your memory instructions, then carry on."',
      ].join("\n")
    : null;
}
