import { isMemoryId, type MemoryId } from "../../model/id";
import { err, ok, type Result } from "../../model/result";

export type Relation =
  | { readonly type: "new" }
  | { readonly type: "updates" | "supersedes"; readonly id: MemoryId };

const LINKED = /^(updates|supersedes):(\S+)$/;

// Absent means the agent has not looked at related memories yet.
export function parseRelation(value: unknown): Result<Relation | undefined, string> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (value === "new") {
    return ok({ type: "new" });
  }
  const [, type, id] = (typeof value === "string" ? LINKED.exec(value.trim()) : null) ?? [];
  if ((type === "updates" || type === "supersedes") && isMemoryId(id)) {
    return ok({ type, id });
  }
  return err(
    `relation must be "new", "updates:<id>" or "supersedes:<id>", got ${JSON.stringify(value)}`,
  );
}
