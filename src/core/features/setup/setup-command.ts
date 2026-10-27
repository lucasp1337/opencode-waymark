import { DEFAULT_PRESET, PRESET_NAMES } from "../../config/preset-name";
import { presetSummary } from "../../config/settings-text";
import { SCOPE_LEVELS } from "../../model/scope";

const PRESET_LINES = PRESET_NAMES.map(
  (name) => `- ${presetSummary(name)}${name === DEFAULT_PRESET ? " (default)" : ""}`,
).join("\n");

// What the `setup` subcommand of /memory tells the agent to do. Preset figures and names come from
// the presets themselves, so the offer cannot drift from what memory_config applies. opencode
// expands `$1`, `!` followed by a backtick, and `@` in command templates, so none of them may
// appear here.
export const SETUP_INSTRUCTIONS = `Set up Waymark with the user. Change nothing until they have answered.

Ask whether they want Quick or Advanced.

Quick: let the user pick one preset:
${PRESET_LINES}
Then call memory_config with preset set to their choice (${PRESET_NAMES.join(", ")}).

Advanced: ask about each of these in turn; the user may keep the current value:
- token cap per scope for rules and preferences: ${SCOPE_LEVELS.join(", ")} (caps)
- how many index lines the session block shows for facts and decisions (indexLines)
- when a fact or decision leaves the index: in-scope sessions (indexExitSessions) and days (indexExitDays) without a read, both must pass
- agent names whose subagent sessions should get memory (subagents)
- whether to ask the agent to save memories before context is compacted (compactionSave)
- whether Waymark shows toasts (toasts)

Then call memory_config once with only the settings the user changed, and show them its reply.`;
