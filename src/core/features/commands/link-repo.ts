import { repoIdIn, type ScopeChain } from "../../model/scope";
import { linkRepos, unlinkRepo } from "../../scope/products";
import { linkedReply, unlinkedReply } from "../link/link-replies";
import type { LinkDeps } from "../link/memory-link";

const NO_REPO = "this session does not run in a repo.";

export function linkSessionRepo(deps: LinkDeps, chain: ScopeChain, product: string): string {
  const repo = repoIdIn(chain);
  if (repo === undefined) {
    return `Not linked: ${NO_REPO}`;
  }
  const linked = linkRepos(deps.fs, deps.registryFile, { repos: [repo], product });
  return linked.ok ? linkedReply(linked.value) : `Not linked: ${linked.error}`;
}

export function unlinkSessionRepo(deps: LinkDeps, chain: ScopeChain): string {
  const repo = repoIdIn(chain);
  if (repo === undefined) {
    return `Not unlinked: ${NO_REPO}`;
  }
  const unlinked = unlinkRepo(deps.fs, deps.registryFile, repo);
  return unlinked.ok ? unlinkedReply(repo, unlinked.value) : `Not unlinked: ${unlinked.error}`;
}
