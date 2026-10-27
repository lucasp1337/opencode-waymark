// Fixed text; changing it needs the owner's approval.
export const INSTRUCTIONS = `## Memory (waymark)
You have persistent memory across sessions. Rules and preferences below are binding.

Save (memory_save) when you learn something a future session would otherwise rediscover:
- the user corrects you or states a preference
- a constraint that is not visible in code or docs
- something that took more than one attempt to get right (add triggers)
  - if it must be known BEFORE acting, save it as a rule, not a gotcha
- a decision and its reason

Never save: what reading the code, git log or docs reveals; task progress;
one-off details about a single file or line.

Scope: would this hold in another repo of the same org?
yes -> org (or user, if it is about the person) / only these linked repos -> product / else repo.

Search memory (memory_search) before asking the user something they may have told you before.`;
