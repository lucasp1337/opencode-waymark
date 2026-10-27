import type { ScopeChain } from "../model/scope";
import { notify } from "../notify";
import type { HostPort } from "../port";
import type { FileSystem } from "../store/fs";
import { resolveScopes } from "./chain";
import type { Git } from "./git";
import { type OrgRef, registerOrg } from "./registry";

export interface SessionScopes {
  chainFor(sessionID: string): Promise<ScopeChain>;
}

interface SessionScopeDeps {
  readonly host: Pick<HostPort, "capabilities" | "sessionMeta" | "toast" | "log">;
  readonly git: Git;
  readonly fs: FileSystem;
  readonly registryFile: string;
}

async function announceOrg(deps: SessionScopeDeps, org: OrgRef): Promise<void> {
  const registered = registerOrg(deps.fs, deps.registryFile, org);
  if (!registered.ok) {
    deps.host.log("warn", "org not registered", { org: org.id, error: registered.error });
  } else if (registered.value === "added") {
    await notify(deps.host, `waymark · new org: ${org.owner}`);
  }
}

interface Resolution {
  readonly chain: ScopeChain;
  readonly cacheable: boolean;
}

async function resolveFor(deps: SessionScopeDeps, directory: string): Promise<Resolution> {
  const resolved = resolveScopes(directory, deps.git);
  if (resolved.failure !== undefined) {
    deps.host.log("warn", "scope resolution degraded to user", {
      directory,
      failure: resolved.failure,
    });
    // Not cached: a later session may succeed once git answers again.
    return { chain: resolved.chain, cacheable: false };
  }
  if (resolved.fallback !== undefined) {
    deps.host.log("info", "repo identified by its root path", {
      directory,
      reason: resolved.fallback,
    });
  }
  if (resolved.org !== undefined) {
    await announceOrg(deps, resolved.org);
  }
  return { chain: resolved.chain, cacheable: true };
}

// A directory's chain does not change while the plugin is active, so git is asked once.
export function createSessionScopes(deps: SessionScopeDeps): SessionScopes {
  const chains = new Map<string, ScopeChain>();
  return {
    async chainFor(sessionID) {
      const { directory } = await deps.host.sessionMeta(sessionID);
      const known = chains.get(directory);
      if (known !== undefined) {
        return known;
      }
      const resolution = await resolveFor(deps, directory);
      if (resolution.cacheable) {
        chains.set(directory, resolution.chain);
      }
      return resolution.chain;
    },
  };
}
