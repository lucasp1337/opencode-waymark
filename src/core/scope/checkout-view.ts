import { join, sep } from "node:path";
import type { HostPort } from "../port";
import type { FileSystem } from "../store/fs";

export interface CheckoutView {
  readonly home: string;
  // Whether the root is still a work tree.
  readonly exists: (root: string) => Promise<boolean>;
}

// A work tree root holds `.git`. Memoized per view, since two repos can share a root; a root that
// cannot be examined counts as gone.
export function createWorkTreeCheck(deps: {
  readonly fs: Pick<FileSystem, "exists">;
  readonly log: HostPort["log"];
}): CheckoutView["exists"] {
  const answers = new Map<string, Promise<boolean>>();
  const examine = async (root: string): Promise<boolean> => {
    try {
      return await deps.fs.exists(join(root, ".git"));
    } catch (error) {
      deps.log("warn", "checkout not examined", { root, error: String(error) });
      return false;
    }
  };
  return (root) => {
    const known = answers.get(root);
    if (known !== undefined) {
      return known;
    }
    const answer = examine(root);
    answers.set(root, answer);
    return answer;
  };
}

function withHomeAsTilde(root: string, home: string): string {
  return root === home || root.startsWith(`${home}${sep}`) ? `~${root.slice(home.length)}` : root;
}

// Where a repo is checked out, for people: the path with the home directory as ~, or undefined
// when no checkout was seen or its work tree is gone.
export async function shownCheckout(
  root: string | undefined,
  view: CheckoutView,
): Promise<string | undefined> {
  return root !== undefined && (await view.exists(root))
    ? withHomeAsTilde(root, view.home)
    : undefined;
}
