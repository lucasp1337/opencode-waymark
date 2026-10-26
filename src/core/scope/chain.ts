import { createHash } from "node:crypto";
import type { ScopeChain, ScopeRef } from "../model/scope";
import type { Git } from "./git";
import type { OrgRef } from "./registry";
import { orgIdOf, parseRemote, type RemoteIdentity, repoIdOf } from "./remote";

export interface ResolvedScopes {
  readonly chain: ScopeChain;
  // Present when the repository has an origin that names an owner.
  readonly org?: OrgRef;
  // Git could not answer, so the chain is the user scope alone rather than a guessed repo scope.
  readonly failure?: string;
  // The chain is usable but less precise than it could be.
  readonly fallback?: string;
}

const USER_SCOPE: ScopeRef = { level: "user" };
const ROOT_HASH_LENGTH = 16;
const ORIGIN_NOT_AN_ADDRESS = "origin is not a host/owner/name address; using the local repo id";

function localRepoScope(root: string): ScopeRef {
  const hash = createHash("sha256").update(root).digest("hex").slice(0, ROOT_HASH_LENGTH);
  return { level: "repo", id: `local/${hash}` };
}

function localScopes(root: string): ResolvedScopes {
  return { chain: [USER_SCOPE, localRepoScope(root)] };
}

function remoteScopes(identity: RemoteIdentity): ResolvedScopes {
  const org = { id: orgIdOf(identity), owner: identity.owner };
  return {
    chain: [USER_SCOPE, { level: "org", id: org.id }, { level: "repo", id: repoIdOf(identity) }],
    org,
  };
}

function originScopes(root: string, origin: string): ResolvedScopes {
  const remote = parseRemote(origin);
  return remote.ok
    ? remoteScopes(remote.value)
    : { ...localScopes(root), fallback: ORIGIN_NOT_AN_ADDRESS };
}

function repoScopes(root: string, git: Git): ResolvedScopes {
  const origin = git.originUrl(root);
  switch (origin.status) {
    case "found":
      return originScopes(root, origin.value);
    case "absent":
      return localScopes(root);
    case "failed":
      return { chain: [USER_SCOPE], failure: origin.reason };
  }
}

export function resolveScopes(dir: string, git: Git): ResolvedScopes {
  const root = git.root(dir);
  switch (root.status) {
    case "found":
      return repoScopes(root.value, git);
    case "absent":
      return { chain: [USER_SCOPE] };
    case "failed":
      return { chain: [USER_SCOPE], failure: root.reason };
  }
}
