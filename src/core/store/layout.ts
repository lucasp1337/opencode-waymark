import { isAbsolute, join } from "node:path";
import type { Memory } from "../model/memory";
import { isSafeScopeId, type ScopeLevel, type ScopeRef } from "../model/scope";

const LEVEL_DIRS: { readonly [L in ScopeLevel]: string } = {
  user: "user",
  org: "orgs",
  product: "products",
  repo: "repos",
};

export class UnsafeScopeIdError extends Error {
  constructor(readonly scopeId: string) {
    super(`unsafe scope id "${scopeId}"`);
    this.name = "UnsafeScopeIdError";
  }
}

// The XDG spec says relative values must be ignored.
export function dataRoot(env: Record<string, string | undefined>, home: string): string {
  const xdgDataHome = env.XDG_DATA_HOME;
  const base =
    xdgDataHome !== undefined && isAbsolute(xdgDataHome)
      ? xdgDataHome
      : join(home, ".local", "share");
  return join(base, "waymark");
}

// Scope ids may contain "/" (host/owner/name) and become nested directories. They are validated
// when parsed, but a path built from one is never allowed to leave the data root.
export function scopeDir(root: string, scope: ScopeRef): string {
  if (scope.level === "user") {
    return join(root, LEVEL_DIRS.user);
  }
  if (!isSafeScopeId(scope.id)) {
    throw new UnsafeScopeIdError(scope.id);
  }
  return join(root, LEVEL_DIRS[scope.level], scope.id);
}

export function memoryPath(root: string, memory: Pick<Memory, "scope" | "kind" | "id">): string {
  return join(scopeDir(root, memory.scope), memory.kind, `${memory.id}.md`);
}

// Everything else under the root (cache, registry, config) is not a memory file.
export function scopeRoots(root: string): string[] {
  return Object.values(LEVEL_DIRS).map((dir) => join(root, dir));
}
