import { firstTimeSeen } from "../../first-time";
import { repoIdIn, type ScopeChain } from "../../model/scope";
import type { HostPort, ToolCallInfo } from "../../port";
import type { CheckoutRecorder } from "../../scope/checkouts";
import { type PairStatus, pairStatus } from "../../scope/products";
import { catchRegistryIo } from "../../scope/registry-file";
import type { FileSystem } from "../../store/fs";
import type { MemoryStore } from "../../store/memory-store";
import type { RecallScope } from "../recall/recall-scope";
import type { ToolDeps } from "../tool-deps";
import type { RepoWatch, SeenRepo } from "./repo-watch";
import { roleNote } from "./role-note";

interface SecondRepoDeps extends Pick<ToolDeps, "productRepos"> {
  readonly store: Pick<MemoryStore, "inScopes">;
  // null: this session gets no recall, and no hint.
  recallScope(sessionID: string): Promise<RecallScope | null>;
  readonly repoWatch: RepoWatch;
  readonly fs: FileSystem;
  readonly registryFile: string;
  readonly recordCheckout: CheckoutRecorder;
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
  // Repos of the product already checked for a targeted memory, and the suggestions waiting.
  readonly noted: Set<string>;
  readonly roleNotes: string[];
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

function decideAboutOthers(
  deps: Pick<SecondRepoDeps, "fs" | "registryFile" | "log">,
  state: SessionHints,
  { own, seen }: { own: string; seen: readonly SeenRepo[] },
): void {
  for (const { repo } of seen.filter((found) => found.repo !== own)) {
    decide(deps, state, [own, repo]);
  }
}

// A store or registry that cannot be read leaves the repo unchecked, so a later call asks again;
// the problem is logged once per activation.
function noteRoles(
  deps: Pick<SecondRepoDeps, "store" | "productRepos" | "log">,
  state: SessionHints,
  { chain, own, seen }: { chain: ScopeChain; own: string; seen: readonly SeenRepo[] },
  firstTime: (problem: string) => boolean,
): void {
  for (const { repo } of seen.filter(
    (found) => found.repo !== own && !state.noted.has(found.repo),
  )) {
    const note = catchRegistryIo(() => roleNote(deps, chain, repo));
    if (note.ok) {
      state.noted.add(repo);
      if (note.value !== undefined) {
        state.roleNotes.push(note.value);
      }
    } else if (firstTime(note.error)) {
      deps.log("warn", "role suggestion not checked", { repo, error: note.error });
    }
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
  const texts = [
    ...hints.map(({ other, product }) => hintText(repo, other, product)),
    ...state.roleNotes.splice(0),
  ];
  return texts.length === 0 ? null : texts.join("\n\n");
}

// Hints are decided before the awaits that follow the first one, so parallel calls of a session
// cannot both hint the same repo.
export function createSecondRepoHints(deps: SecondRepoDeps): SecondRepoHints {
  const sessions = new Map<string, SessionHints>();
  const firstTime = firstTimeSeen();
  const stateOf = (sessionID: string): SessionHints => {
    const known = sessions.get(sessionID);
    if (known !== undefined) {
      return known;
    }
    const created: SessionHints = {
      decided: new Set(),
      queued: [],
      noted: new Set(),
      roleNotes: [],
    };
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
      const seen = deps.repoWatch.observe(call, scope.directory);
      decideAboutOthers(deps, state, { own: repo, seen });
      noteRoles(deps, state, { chain: scope.chain, own: repo, seen }, firstTime);
      const hint = call.appendable
        ? takeQueued(deps.log, { sessionID: call.sessionID, repo }, state)
        : null;
      for (const found of seen) {
        // Not awaited: the recorder logs its own failures and may wait for the registry lock.
        void deps.recordCheckout(found.repo, found.root);
      }
      return hint;
    },
    forget(sessionID) {
      sessions.delete(sessionID);
      deps.repoWatch.forget(sessionID);
    },
  };
}
