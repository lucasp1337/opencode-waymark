import { targetedRepos } from "../../model/delivery";
import { activeOnly } from "../../model/memory";
import { err, ok, type Result } from "../../model/result";
import { type ScopeChain, scopeAt, shortRepoName } from "../../model/scope";
import type { MemoryStore } from "../../store/memory-store";
import type { ToolDeps } from "../tool-deps";

interface RoleNoteDeps extends Pick<ToolDeps, "productRepos"> {
  readonly store: Pick<MemoryStore, "inScopes">;
}

function noteText(repo: string): string {
  return `waymark · Nothing says what ${shortRepoName(repo)} owns yet; if the user explains its role, save it with triggers.repos ["${repo}"].`;
}

// The line suggesting a targeted memory for a repo of the session's product that no product memory
// aims at; undefined when the repo is not a sibling in that product or something already does.
// Asked once per repo and session, so the store read is not on every tool call.
export function roleNote(
  deps: RoleNoteDeps,
  chain: ScopeChain,
  repo: string,
): Result<string | undefined, string> {
  const product = scopeAt(chain, "product");
  if (product?.level !== "product") {
    return ok(undefined);
  }
  const members = deps.productRepos(product.id);
  if (!members.ok) {
    return err(members.error);
  }
  if (!members.value.includes(repo)) {
    return ok(undefined);
  }
  const aimed = activeOnly(deps.store.inScopes([product])).some((memory) =>
    targetedRepos(memory).includes(repo),
  );
  return ok(aimed ? undefined : noteText(repo));
}
