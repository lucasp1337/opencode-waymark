import { err, type Result } from "../model/result";
import type { ScopeChain, ScopeRef } from "../model/scope";
import { notify } from "../notify";
import type { HostPort } from "../port";
import type { FileSystem } from "../store/fs";
import { type ResolvedScopes, resolveScopes } from "./chain";
import type { Git } from "./git";
import { type OrgEntry, type OrgRef, resolveOrg } from "./registry";

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
  try {
    return resolveOrg(deps.fs, deps.registryFile, org);
  } catch (error) {
    return err(String(error));
  }
}

// The registry is read on every call, not cached with the chain, so a merge applies to later
// calls of sessions already running in the merged org's repos. Recall pins a session's chain when
// it starts, so those sessions get the merge through tool calls only.
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

// Git is asked once per directory: the repo a directory belongs to does not change while the
// plugin is active.
export function createSessionScopes(deps: SessionScopeDeps): SessionScopes {
  const resolutions = new Map<string, ResolvedScopes>();
  return {
    async chainFor(sessionID) {
      const { directory } = await deps.host.sessionMeta(sessionID);
      const known = resolutions.get(directory);
      if (known !== undefined) {
        return await withOrg(deps, known);
      }
      const { resolved, cacheable } = resolveFor(deps, directory);
      if (cacheable) {
        resolutions.set(directory, resolved);
      }
      return await withOrg(deps, resolved);
    },
  };
}
