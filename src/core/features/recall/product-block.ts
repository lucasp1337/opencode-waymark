import { repoIdIn, type ScopeChain, scopeAt } from "../../model/scope";
import type { HostPort } from "../../port";
import { createWorkTreeCheck } from "../../scope/checkout-view";
import { readCheckouts } from "../../scope/checkouts";
import { productRepos } from "../../scope/products";
import { catchRegistryIo } from "../../scope/registry-file";
import type { FileSystem } from "../../store/fs";
import { productMapLine } from "./product-map";
import type { ProductBlock } from "./session-block";

export interface ProductBlockDeps {
  readonly fs: FileSystem;
  readonly registryFile: string;
  readonly home: string;
  readonly log: HostPort["log"];
}

// The registry is the only source. When it cannot give the map the block falls back to the plain
// member list, and when it cannot give that either, to no members.
export async function productBlock(
  deps: ProductBlockDeps,
  chain: ScopeChain,
): Promise<ProductBlock> {
  const product = scopeAt(chain, "product");
  if (product?.level !== "product") {
    return { members: [] };
  }
  const members = catchRegistryIo(() => productRepos(deps.fs, deps.registryFile, product.id));
  if (!members.ok) {
    deps.log("warn", "product repos not listed in session block", { error: members.error });
    return { members: [] };
  }
  const own = repoIdIn(chain);
  const checkouts = catchRegistryIo(() => readCheckouts(deps.fs, deps.registryFile));
  if (!checkouts.ok) {
    deps.log("warn", "checkouts not mapped in session block", { error: checkouts.error });
  }
  if (own === undefined || !checkouts.ok || members.value.length === 0) {
    return { members: members.value };
  }
  return {
    map: await productMapLine({
      product: product.id,
      own,
      members: members.value,
      checkouts: checkouts.value,
      home: deps.home,
      exists: createWorkTreeCheck(deps),
    }),
  };
}
