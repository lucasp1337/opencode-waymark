import type { Linked, Unlinked } from "../../scope/products";

export function linkedReply({ product, repos, created }: Linked): string {
  const list = repos.join(", ");
  return [
    created ? `Created product ${product} with ${list}.` : `Product ${product} now links ${list}.`,
    "Save what holds in all of these repos with scope product. Sessions that start from now on in any of them show the product's memories.",
  ].join("\n");
}

export function declinedReply([a, b]: readonly [string, string]): string {
  return `Recorded: ${a} and ${b} are not one product. Waymark will not suggest linking them again.`;
}

export function unlinkedReply(repo: string, { product, remaining }: Unlinked): string {
  const after =
    remaining.length > 0
      ? `Waymark will not suggest linking ${repo} with ${remaining.join(", ")} again.`
      : `No repo is left in ${product}; /memory link ${product} brings its memories back to a repo.`;
  return `Unlinked ${repo} from product ${product}. Its memories stay with the product.\n${after}`;
}
