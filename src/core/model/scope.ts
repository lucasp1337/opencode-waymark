import { err, ok, type Result } from "./result";

export const SCOPE_LEVELS = ["user", "org", "product", "repo"] as const;

export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

export type ScopeRef =
  | { readonly level: "user" }
  | { readonly level: "org"; readonly id: string }
  | { readonly level: "product"; readonly id: string }
  | { readonly level: "repo"; readonly id: string };

// Broadest first: user, then org, product and repo when the session has them.
export type ScopeChain = readonly ScopeRef[];

export function isScopeLevel(value: unknown): value is ScopeLevel {
  return SCOPE_LEVELS.some((level) => level === value);
}

const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

// Scope ids become directory paths under the data root, so every segment must be a plain name.
export function isSafeScopeId(id: string): boolean {
  return id
    .split("/")
    .every((segment) => SAFE_SEGMENT.test(segment) && segment !== "." && segment !== "..");
}

// Stable text form, used in frontmatter, the cache and messages: "user" or "<level>:<id>".
export function scopeKey(scope: ScopeRef): string {
  return scope.level === "user" ? "user" : `${scope.level}:${scope.id}`;
}

export function parseScopeKey(key: string): Result<ScopeRef, string> {
  if (key === "user") {
    return ok({ level: "user" });
  }
  const separator = key.indexOf(":");
  const level = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (separator < 0 || level === "user" || !isScopeLevel(level) || !isSafeScopeId(id)) {
    return err(`invalid scope "${key}"`);
  }
  return ok({ level, id });
}

export function scopeAt(chain: ScopeChain, level: ScopeLevel): ScopeRef | undefined {
  return chain.find((scope) => scope.level === level);
}

// The id of the repo a chain ends in, when its session runs in one.
export function repoIdIn(chain: ScopeChain): string | undefined {
  for (const scope of chain) {
    if (scope.level === "repo") {
      return scope.id;
    }
  }
  return undefined;
}
