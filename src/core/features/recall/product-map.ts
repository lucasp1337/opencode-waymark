import { shortRepoName } from "../../model/scope";
import { type CheckoutView, shownCheckout } from "../../scope/checkout-view";

// The map is one line of the session block, so it is held to a length of its own.
const MAX_LENGTH = 200;
const SEPARATOR = " · ";

export interface ProductMapInput extends CheckoutView {
  readonly product: string;
  readonly own: string;
  // Repo ids in the registry's order.
  readonly members: readonly string[];
  // Work tree root last seen per repo id.
  readonly checkouts: ReadonlyMap<string, string>;
}

async function entry(repo: string, input: ProductMapInput): Promise<string> {
  const name = shortRepoName(repo);
  if (repo === input.own) {
    return `${name} (here)`;
  }
  const path = await shownCheckout(input.checkouts.get(repo), input);
  return path === undefined ? `${name} (no checkout seen)` : `${name} ${path}`;
}

function line(product: string, shown: readonly string[], hidden: number): string {
  const more = hidden > 0 ? [`+${hidden} more, see /memory triggers repos`] : [];
  return `Product ${product}: ${[...shown, ...more].join(SEPARATOR)}`;
}

// The product's repos on one line, the session's own first, as many as fit the length cap; at
// least the own repo is always shown.
export async function productMapLine(input: ProductMapInput): Promise<string> {
  const ordered = [input.own, ...input.members.filter((repo) => repo !== input.own)];
  const entries = await Promise.all(ordered.map((repo) => entry(repo, input)));
  for (let shown = entries.length; shown > 1; shown -= 1) {
    const candidate = line(input.product, entries.slice(0, shown), entries.length - shown);
    if (candidate.length <= MAX_LENGTH) {
      return candidate;
    }
  }
  return line(input.product, entries.slice(0, 1), entries.length - 1);
}
