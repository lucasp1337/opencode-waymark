import type { MemoryId } from "../../model/id";
import { isRecalledByTrigger } from "../../model/kind";
import { activeOnly, type Memory, type Triggers } from "../../model/memory";
import { type ScopeChain, scopeKey } from "../../model/scope";
import { wordsOf } from "../../model/words";
import type { HostPort, ToolCallInfo } from "../../port";
import type { MemoryStore } from "../../store/memory-store";
import type { Telemetry } from "../../telemetry/telemetry";
import type { NoisyThresholds } from "../lifecycle/lifecycle-settings";
import { noisyGotchaLine } from "../lifecycle/noisy-gotcha";
import { appliesLines, datedTitle } from "../memory-line";
import {
  type Baseline,
  createFreshQueue,
  type FreshQueue,
  queueFresh,
  takeFresh,
} from "./fresh-memories";
import type { OwnWrites } from "./own-writes";
import type { RecallScope } from "./recall-scope";
import { type CallFacts, callFacts, matchesTriggers } from "./trigger-match";

interface JitDeps {
  // null: this session gets no recall.
  recallScope(sessionID: string): Promise<RecallScope | null>;
  readonly store: Pick<MemoryStore, "inScopes" | "generation">;
  readonly counters: Pick<Telemetry, "recordFire" | "firesWithin">;
  readonly noisy: NoisyThresholds;
  // The chain as it is now, which a product link made after the session started extends.
  currentChain(sessionID: string): Promise<ScopeChain>;
  // What the session's frozen block was rendered from; undefined while the session has none.
  baseline(sessionID: string): Baseline | undefined;
  readonly ownWrites: Pick<OwnWrites, "isOwn">;
  readonly log: HostPort["log"];
}

interface Jit {
  onUserMessage(sessionID: string, text: string): Promise<void>;
  onToolAfter(call: ToolCallInfo): Promise<string | null>;
  // Drops everything kept for a session that no longer exists.
  forget(sessionID: string): void;
}

interface SessionRecall {
  readonly delivered: Set<MemoryId>;
  // Insertion order is match order, so the oldest match is delivered first.
  readonly queued: Map<MemoryId, Memory>;
  // Saved or changed since the block was frozen; waits for the same output as the matches.
  readonly fresh: FreshQueue;
  words: ReadonlySet<string>;
  // A session is asked about a noisy gotcha at most once.
  noisyChecked: boolean;
}

interface Candidate {
  readonly memory: Memory;
  readonly triggers: Triggers;
}

function triggeredMemories(active: readonly Memory[]): Candidate[] {
  return active.flatMap((memory) =>
    isRecalledByTrigger(memory.kind) && memory.triggers !== undefined
      ? [{ memory, triggers: memory.triggers }]
      : [],
  );
}

interface ChainMemories {
  readonly active: readonly Memory[];
  readonly candidates: readonly Candidate[];
}

interface SinceBlock {
  readonly baseline: Baseline;
  readonly active: readonly Memory[];
}

interface Memo extends ChainMemories {
  readonly generation: number;
}

// Tool calls are the hot path: a chain is read from the store once and again only after a save or
// forget changed it.
function createChainMemories(store: JitDeps["store"]) {
  const byChain = new Map<string, Memo>();
  return (chain: ScopeChain): ChainMemories => {
    const key = chain.map(scopeKey).join(" ");
    const generation = store.generation();
    const memo = byChain.get(key);
    if (memo !== undefined && memo.generation === generation) {
      return memo;
    }
    const active = activeOnly(store.inScopes(chain));
    const fresh = { generation, active, candidates: triggeredMemories(active) };
    byChain.set(key, fresh);
    return fresh;
  };
}

function jitText(memory: Memory): string {
  return [
    `waymark · ${memory.kind} · ${datedTitle(memory)}`,
    ...appliesLines(memory),
    memory.body,
  ].join("\n");
}

type DeliveryDeps = Pick<JitDeps, "counters" | "noisy">;

function deliver({ counters, noisy }: DeliveryDeps, recall: SessionRecall, memory: Memory): string {
  recall.delivered.add(memory.id);
  const firesBefore = counters.firesWithin(memory.id, noisy.days);
  counters.recordFire(memory.id);
  const check = recall.noisyChecked ? null : noisyGotchaLine(memory, firesBefore, noisy);
  if (check === null) {
    return jitText(memory);
  }
  recall.noisyChecked = true;
  return `${jitText(memory)}\n${check}`;
}

// The only write on the tool-call path: a delivery is rare, so ordinary calls stay read-only.
function takeQueued(deps: DeliveryDeps, recall: SessionRecall): string {
  const due = [...recall.queued.values()];
  recall.queued.clear();
  return [...due.map((memory) => deliver(deps, recall, memory)), ...takeFresh(recall.fresh)].join(
    "\n\n",
  );
}

function hasQueued(recall: SessionRecall): boolean {
  return recall.queued.size > 0 || recall.fresh.waiting.size > 0;
}

function queueMatches(
  recall: SessionRecall,
  candidates: readonly Candidate[],
  facts: CallFacts,
): void {
  for (const { memory, triggers } of candidates) {
    if (!recall.delivered.has(memory.id) && matchesTriggers(triggers, facts)) {
      recall.queued.set(memory.id, memory);
    }
  }
}

// State is per activation and per session: what was already delivered, what waits for an output
// that can carry text, and the words of the user's latest message.
export function createJit(deps: JitDeps): Jit {
  const sessions = new Map<string, SessionRecall>();
  const memoriesOn = createChainMemories(deps.store);

  function recallOf(sessionID: string): SessionRecall {
    const known = sessions.get(sessionID);
    if (known !== undefined) {
      return known;
    }
    const fresh: SessionRecall = {
      delivered: new Set(),
      queued: new Map(),
      fresh: createFreshQueue(),
      words: new Set(),
      noisyChecked: false,
    };
    sessions.set(sessionID, fresh);
    return fresh;
  }

  // Read before the synchronous part of a call, so that part stays free of awaits. Without the
  // current chain the trigger matches still go out; only the news since the block waits.
  async function sinceBlock(sessionID: string): Promise<SinceBlock | null> {
    const baseline = deps.baseline(sessionID);
    if (baseline === undefined) {
      return null;
    }
    try {
      const chain = await deps.currentChain(sessionID);
      return { baseline, active: memoriesOn(chain).active };
    } catch (error) {
      deps.log("error", "current scope chain unavailable for recall", {
        sessionID,
        error: String(error),
      });
      return null;
    }
  }

  return {
    onUserMessage(sessionID, text) {
      recallOf(sessionID).words = wordsOf(text);
      return Promise.resolve();
    },
    async onToolAfter(call) {
      // Taken before any await: a session forgotten meanwhile must not get its state back, or
      // everything delivered so far would be delivered again.
      const recall = recallOf(call.sessionID);
      const scope = await deps.recallScope(call.sessionID);
      if (scope === null) {
        return null;
      }
      const since = await sinceBlock(call.sessionID);
      if (sessions.get(call.sessionID) !== recall) {
        return null;
      }
      // Nothing below awaits, so two parallel calls cannot both deliver the same memory.
      const facts = callFacts(call, scope.directory, recall.words);
      queueMatches(recall, memoriesOn(scope.chain).candidates, facts);
      if (since !== null) {
        queueFresh(recall.fresh, since.active, since.baseline, (memory) =>
          deps.ownWrites.isOwn(call.sessionID, memory),
        );
      }
      return call.appendable && hasQueued(recall) ? takeQueued(deps, recall) : null;
    },
    forget(sessionID) {
      sessions.delete(sessionID);
    },
  };
}
