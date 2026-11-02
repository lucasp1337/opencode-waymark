import { productReposUnreadable } from "../../model/delivery";
import type { Triggers } from "../../model/memory";
import { err, ok, type Result } from "../../model/result";
import type { ScopeRef } from "../../model/scope";
import type { ToolDeps } from "../tool-deps";

const WRONG_SCOPE =
  "triggers.repos only works at product scope; a repo-scope memory already reaches only its repo";

// A memory aimed at repos must sit in a product and name only that product's repos. Read at save
// time, since the product's repos can change later (the memory then stays, unfired).
export function checkRepoTargets(
  deps: Pick<ToolDeps, "productRepos">,
  scope: ScopeRef,
  triggers: Triggers | undefined,
): Result<void, string> {
  const targets = triggers?.repos;
  if (targets === undefined) {
    return ok(undefined);
  }
  if (scope.level !== "product") {
    return err(WRONG_SCOPE);
  }
  const members = deps.productRepos(scope.id);
  if (!members.ok) {
    return err(productReposUnreadable(scope.id, members.error));
  }
  const unknown = targets.filter((target) => !members.value.includes(target));
  return unknown.length === 0
    ? ok(undefined)
    : err(
        `triggers.repos has ${unknown.join(", ")}, not in product ${scope.id}; its repos are: ${members.value.join(", ") || "none"}`,
      );
}
