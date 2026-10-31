import { type ScopeChain, scopeKey } from "../../model/scope";

const MEMBERS_SHOWN = 5;

function members(repos: readonly string[]): string {
  const hidden = repos.length - MEMBERS_SHOWN;
  const shown = repos.slice(0, MEMBERS_SHOWN);
  return ` (${[...shown, ...(hidden > 0 ? [`+${hidden} more`] : [])].join(", ")})`;
}

// Tells the agent where it can save, including the scopes that hold no memories yet.
export function scopesLine(chain: ScopeChain, productRepos: readonly string[]): string {
  const scopes = chain.map((scope) => {
    const key = scopeKey(scope);
    return scope.level === "product" && productRepos.length > 0
      ? `${key}${members(productRepos)}`
      : key;
  });
  return `Scopes here: ${scopes.join(" · ")}`;
}
