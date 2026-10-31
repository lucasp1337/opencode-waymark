import type { ScopeRef } from "../../model/scope";
import { notify } from "../../notify";
import { checkMerge, type OrgMerge, recordMerge } from "../../scope/registry";
import type { FileSystem } from "../../store/fs";
import { memoryLine } from "../memory-line";
import { tokensOf } from "../save/budget";
import { budgetRefusalText } from "../save/budget-refusal";
import { type ArrivalRefusal, checkArrivals, type RelocationDeps, relocated } from "./relocation";

export interface MergeDeps extends RelocationDeps {
  readonly fs: FileSystem;
  readonly registryFile: string;
}

function refusalReply(target: ScopeRef, refusal: ArrivalRefusal): string {
  return [
    budgetRefusalText("Not merged", target, refusal),
    "Arriving:",
    ...refusal.arriving.map((memory) => `- ${memoryLine(memory)} (${tokensOf(memory)} tokens)`),
  ].join("\n");
}

// Moves first and records last: if the process dies in between, running the merge again finishes it.
export async function mergeOrgs(deps: MergeDeps, merge: OrgMerge): Promise<string> {
  const allowed = checkMerge(deps.fs, deps.registryFile, merge);
  if (!allowed.ok) {
    return `Not merged: ${allowed.error}`;
  }
  const target: ScopeRef = { level: "org", id: merge.into };
  const moving = deps.store.inScopes([{ level: "org", id: merge.from }]);
  const budget = checkArrivals(deps, target, moving);
  if (!budget.ok) {
    return refusalReply(target, budget.error);
  }
  const now = deps.now();
  for (const memory of moving) {
    deps.store.save(relocated(memory, target, now));
  }
  const recorded = await recordMerge(deps.fs, deps.registryFile, merge);
  if (!recorded.ok) {
    deps.host.log("warn", "org merge not recorded", { ...merge, error: recorded.error });
    return `Memories moved to ${merge.into} but the merge was not recorded; run /memory org merge ${merge.into} ${merge.from} again.`;
  }
  await notify(deps.host, `waymark · merged org ${merge.from} into ${merge.into}`);
  return `Merged org ${merge.from} into ${merge.into}; memories moved: ${moving.length}. Sessions in ${merge.from}'s repos now use ${merge.into}.`;
}
