import { repoIdIn } from "../../model/scope";
import type { HostPort, ToolCallInfo } from "../../port";
import type { Git } from "../../scope/git";
import { type PairStatus, pairStatus } from "../../scope/products";
import { catchRegistryIo } from "../../scope/registry-file";
import type { FileSystem } from "../../store/fs";
import type { RecallScope } from "../recall/recall-scope";
import { createTouchedRepos } from "./touched-repos";

interface SecondRepoDeps {
  // null: this session gets no recall, and no hint.
  recallScope(sessionID: string): Promise<RecallScope | null>;
  readonly git: Git;
  readonly fs: FileSystem;
  readonly registryFile: string;
  readonly log: HostPort["log"];
}

interface SecondRepoHints {
  // The hint to append to this call's output, or null when there is none to give yet.
  onToolAfter(call: ToolCallInfo): Promise<string | null>;
  // Drops what is kept for a session that no longer exists.
  forget(sessionID: string): void;
}

interface Hint {
  readonly other: string;
  // The product one of the two repos is already in, if any.
  readonly product: string | undefined;
}

interface SessionHints {
  // Other repos this session has been hinted about or needs no hint for.
  readonly decided: Set<string>;
  // Waiting for a call whose output can carry them.
  readonly queued: Hint[];
}

function hintText(session: string, other: string, product: string | undefined): string {
  const yes =
    product === undefined
      ? `yes: memory_link with repos ["${session}", "${other}"] and product set to the name the user chooses`
      : `yes: memory_link with repos ["${session}", "${other}"]; both are then in product ${product}`;
  return [
    `waymark · this session's repo is ${session}; this call touched another repo, ${other}.`,
    "Ask the user, in your own words, whether both repos belong to one product, so memories saved to the product apply in both.",
    `Record the answer: ${yes}; no: memory_link with the same repos and decline true, and waymark will not ask again.`,
  ].join("\n");
}

// Silent when the user already answered: a No, a link, or a grouping of either repo elsewhere.
function hintAbout(
  other: string,
  { products: [mine, theirs], declined }: PairStatus,
): Hint | undefined {
  const grouped = mine !== undefined && theirs !== undefined;
  return declined || grouped ? undefined : { other, product: mine ?? theirs };
}

// An unreadable registry leaves the repo undecided, so a later call asks again.
function decide(
  deps: Pick<SecondRepoDeps, "fs" | "registryFile" | "log">,
  state: SessionHints,
  pair: readonly [string, string],
): void {
  const [, other] = pair;
  if (state.decided.has(other)) {
    return;
  }
  const status = catchRegistryIo(() => pairStatus(deps.fs, deps.registryFile, pair));
  if (!status.ok) {
    deps.log("warn", "product links not read", { repo: other, error: status.error });
    return;
  }
  state.decided.add(other);
  const hint = hintAbout(other, status.value);
  if (hint !== undefined) {
    state.queued.push(hint);
  }
}

function takeQueued(
  log: HostPort["log"],
  { sessionID, repo }: { sessionID: string; repo: string },
  state: SessionHints,
): string | null {
  const hints = state.queued.splice(0);
  for (const { other } of hints) {
    log("info", "product hint", { sessionID, repo, other });
  }
  return hints.length === 0
    ? null
    : hints.map(({ other, product }) => hintText(repo, other, product)).join("\n\n");
}

// Everything after the one await is synchronous, so parallel calls of a session cannot both hint
// the same repo.
export function createSecondRepoHints(deps: SecondRepoDeps): SecondRepoHints {
  const touchedRepos = createTouchedRepos(deps);
  const sessions = new Map<string, SessionHints>();
  const stateOf = (sessionID: string): SessionHints => {
    const known = sessions.get(sessionID);
    if (known !== undefined) {
      return known;
    }
    const created: SessionHints = { decided: new Set(), queued: [] };
    sessions.set(sessionID, created);
    return created;
  };
  return {
    async onToolAfter(call) {
      const scope = await deps.recallScope(call.sessionID);
      const repo = scope === null ? undefined : repoIdIn(scope.chain);
      if (scope === null || repo === undefined) {
        return null;
      }
      const state = stateOf(call.sessionID);
      const others = touchedRepos(call, scope.directory).filter((other) => other !== repo);
      for (const other of others) {
        decide(deps, state, [repo, other]);
      }
      return call.appendable
        ? takeQueued(deps.log, { sessionID: call.sessionID, repo }, state)
        : null;
    },
    forget(sessionID) {
      sessions.delete(sessionID);
    },
  };
}
