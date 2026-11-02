import { inProduct, productReposUnreadable } from "../../model/delivery";
import type { Memory } from "../../model/memory";
import { err, ok, type Result } from "../../model/result";
import { type ScopeChain, scopeAt } from "../../model/scope";
import { memoryLine } from "../memory-line";
import type { ToolDeps } from "../tool-deps";

export interface RepoTargetFindings {
  // Aimed at a repo that is no longer in the product; they stay with the product, unfired.
  readonly departed: readonly string[];
  // Repos of the product that no memory is aimed at.
  readonly untargeted: readonly string[];
}

const NONE: RepoTargetFindings = { departed: [], untargeted: [] };

function targetsOf(memory: Memory): readonly string[] {
  return memory.triggers?.repos ?? [];
}

// Only the session's product is looked at; outside a product there is nothing to report.
export function repoTargetFindings(
  deps: Pick<ToolDeps, "productRepos">,
  chain: ScopeChain,
  active: readonly Memory[],
): Result<RepoTargetFindings, string> {
  const product = scopeAt(chain, "product");
  if (product?.level !== "product") {
    return ok(NONE);
  }
  const members = deps.productRepos(product.id);
  if (!members.ok) {
    return err(productReposUnreadable(product.id, members.error));
  }
  const aimed = inProduct(active, product.id);
  const targeted = new Set(aimed.flatMap(targetsOf));
  const departed = aimed.flatMap((memory) => {
    const gone = targetsOf(memory).filter((repo) => !members.value.includes(repo));
    return gone.length === 0 ? [] : [`- ${memoryLine(memory)} (aimed at ${gone.join(", ")})`];
  });
  return ok({
    departed,
    untargeted: members.value.filter((repo) => !targeted.has(repo)).map((repo) => `- ${repo}`),
  });
}
