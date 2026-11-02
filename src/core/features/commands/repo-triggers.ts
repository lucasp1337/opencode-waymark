import { inProduct, productReposUnreadable } from "../../model/delivery";
import type { Memory } from "../../model/memory";
import { type ScopeChain, scopeAt } from "../../model/scope";
import type { HostPort } from "../../port";
import { type CheckoutView, createWorkTreeCheck, shownCheckout } from "../../scope/checkout-view";
import { readCheckouts } from "../../scope/checkouts";
import { catchRegistryIo } from "../../scope/registry-file";
import type { FileSystem } from "../../store/fs";
import { memoryLine } from "../memory-line";
import type { ToolDeps } from "../tool-deps";

export interface RepoTriggerDeps extends Pick<ToolDeps, "productRepos"> {
  readonly fs: FileSystem;
  readonly registryFile: string;
  readonly home: string;
  readonly host: Pick<HostPort, "log">;
}

const NOT_IN_PRODUCT =
  "## repos\nThis session is not in a product, so no memory can target a repo.";

function targeting(memories: readonly Memory[], repo: string): string[] {
  return memories
    .filter((memory) => memory.triggers?.repos?.includes(repo))
    .map((memory) => `- ${memoryLine(memory)}`);
}

function unreadable(product: string, reason: string): string {
  return `## repos\n${productReposUnreadable(product, reason)}.`;
}

async function memberGroup(
  repo: string,
  memories: readonly Memory[],
  { checkouts, view }: { checkouts: ReadonlyMap<string, string>; view: CheckoutView },
): Promise<string> {
  const path = await shownCheckout(checkouts.get(repo), view);
  const lines = targeting(memories, repo);
  return [
    `### ${repo} — ${path ?? "no checkout seen"}`,
    ...(lines.length > 0 ? lines : ["(no memory targets it)"]),
  ].join("\n");
}

function departedGroups(memories: readonly Memory[], members: readonly string[]): string[] {
  const departed = new Set(
    memories
      .flatMap((memory) => memory.triggers?.repos ?? [])
      .filter((repo) => !members.includes(repo)),
  );
  return [...departed]
    .sort()
    .map((repo) =>
      [`### ${repo} — left the product, no longer fires`, ...targeting(memories, repo)].join("\n"),
    );
}

// The product's repos as a map: each member with where it is checked out and the memories aimed
// at it, then the repos memories are still aimed at although they left the product.
export async function repoTriggersSection(
  deps: RepoTriggerDeps,
  chain: ScopeChain,
  active: readonly Memory[],
): Promise<string> {
  const product = scopeAt(chain, "product");
  if (product?.level !== "product") {
    return NOT_IN_PRODUCT;
  }
  const members = deps.productRepos(product.id);
  const checkouts = catchRegistryIo(() => readCheckouts(deps.fs, deps.registryFile));
  if (!members.ok) {
    return unreadable(product.id, members.error);
  }
  if (!checkouts.ok) {
    return unreadable(product.id, checkouts.error);
  }
  const view = {
    home: deps.home,
    exists: createWorkTreeCheck({ fs: deps.fs, log: deps.host.log }),
  };
  const memories = inProduct(active, product.id);
  const groups = await Promise.all(
    members.value.map((repo) => memberGroup(repo, memories, { checkouts: checkouts.value, view })),
  );
  return [
    `## repos (product ${product.id})`,
    ...groups,
    ...departedGroups(memories, members.value),
  ].join("\n");
}
