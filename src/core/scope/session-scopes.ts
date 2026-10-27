import type { Result } from "../model/result";
import { repoIdIn, type ScopeChain, type ScopeRef } from "../model/scope";
import { notify } from "../notify";
import type { HostPort } from "../port";
import type { FileSystem } from "../store/fs";
import { type ResolvedScopes, resolveScopes } from "./chain";
import type { Git } from "./git";
import { productOf } from "./products";
import { type OrgEntry, type OrgRef, resolveOrg } from "./registry";
import { catchRegistryIo } from "./registry-file";

export interface SessionScopes {
  chainFor(sessionID: string): Promise<ScopeChain>;
}

interface SessionScopeDeps {
  readonly host: Pick<HostPort, "capabilities" | "sessionMeta" | "toast" | "log">;
  readonly git: Git;
  readonly fs: FileSystem;
  readonly registryFile: string;
}

interface Resolution {
  readonly resolved: ResolvedScopes;
  readonly cacheable: boolean;
}

function resolveFor(deps: SessionScopeDeps, directory: string): Resolution {
  const resolved = resolveScopes(directory, deps.git);
  if (resolved.failure !== undefined) {
    deps.host.log("warn", "scope resolution degraded to user", {
      directory,
      failure: resolved.failure,
    });
    // Not cached: a later session may succeed once git answers again.
    return { resolved, cacheable: false };
  }
  if (resolved.fallback !== undefined) {
    deps.host.log("info", "repo identified by its root path", {
      directory,
      reason: resolved.fallback,
    });
  }
  return { resolved, cacheable: true };
}

function enterOrg(deps: SessionScopeDeps, org: OrgRef): Result<OrgEntry, string> {
  return catchRegistryIo(() => resolveOrg(deps.fs, deps.registryFile, org));
}

// The registry is read on every call, not cached with the chain, so a merge or a product link
// applies to later calls of sessions already running in the affected repos. Recall pins a
// session's chain when it starts, so those sessions get the change through tool calls only.
async function withOrg(
  deps: SessionScopeDeps,
  { chain, org }: ResolvedScopes,
): Promise<ScopeChain> {
  if (org === undefined) {
    return chain;
  }
  const entry = enterOrg(deps, org);
  if (!entry.ok) {
    deps.host.log("warn", "org registry not applied", { org: org.id, error: entry.error });
    return chain;
  }
  if (entry.value.added) {
    await notify(deps.host, `waymark · new org: ${org.owner}`);
  }
  return chain.map(
    (scope): ScopeRef => (scope.level === "org" ? { level: "org", id: entry.value.id } : scope),
  );
}

// A linked repo's product sits between its org and the repo itself.
function withProduct(deps: SessionScopeDeps, chain: ScopeChain): ScopeChain {
  const repo = repoIdIn(chain);
  if (repo === undefined) {
    return chain;
  }
  const product = catchRegistryIo(() => productOf(deps.fs, deps.registryFile, repo));
  if (!product.ok) {
    deps.host.log("warn", "product links not applied", { repo, error: product.error });
    return chain;
  }
  const id = product.value;
  return id === undefined
    ? chain
    : chain.flatMap((scope): ScopeRef[] =>
        scope.level === "repo" ? [{ level: "product", id }, scope] : [scope],
      );
}

async function withRegistry(deps: SessionScopeDeps, resolved: ResolvedScopes): Promise<ScopeChain> {
  return withProduct(deps, await withOrg(deps, resolved));
}

// Git is asked once per directory: the repo a directory belongs to does not change while the
// plugin is active.
export function createSessionScopes(deps: SessionScopeDeps): SessionScopes {
  const resolutions = new Map<string, ResolvedScopes>();
  return {
    async chainFor(sessionID) {
      const { directory } = await deps.host.sessionMeta(sessionID);
      const known = resolutions.get(directory);
      if (known !== undefined) {
        return await withRegistry(deps, known);
      }
      const { resolved, cacheable } = resolveFor(deps, directory);
      if (cacheable) {
        resolutions.set(directory, resolved);
      }
      return await withRegistry(deps, resolved);
    },
  };
}
