import type { MemoryId } from "../../model/id";
import { isRecalledByTrigger } from "../../model/kind";
import { activeOnly, type Memory, type Triggers } from "../../model/memory";
import { type ScopeChain, scopeKey } from "../../model/scope";
import { wordsOf } from "../../model/words";
import type { ToolCallInfo } from "../../port";
import type { MemoryStore } from "../../store/memory-store";
import type { Telemetry } from "../../telemetry/telemetry";
import type { NoisyThresholds } from "../lifecycle/lifecycle-settings";
import { noisyGotchaLine } from "../lifecycle/noisy-gotcha";
import type { RecallScope } from "./recall-scope";
import { type CallFacts, callFacts, matchesTriggers } from "./trigger-match";

interface JitDeps {
  // null: this session gets no recall.
  recallScope(sessionID: string): Promise<RecallScope | null>;
  readonly store: Pick<MemoryStore, "inScopes" | "generation">;
  readonly counters: Pick<Telemetry, "recordFire" | "firesWithin">;
  readonly noisy: NoisyThresholds;
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
  words: ReadonlySet<string>;
  // A session is asked about a noisy gotcha at most once.
  noisyChecked: boolean;
}

interface Candidate {
  readonly memory: Memory;
  readonly triggers: Triggers;
}

function triggeredMemories(memories: readonly Memory[]): Candidate[] {
  return activeOnly(memories).flatMap((memory) =>
    isRecalledByTrigger(memory.kind) && memory.triggers !== undefined
      ? [{ memory, triggers: memory.triggers }]
      : [],
  );
}

interface Memo {
  readonly generation: number;
  readonly candidates: readonly Candidate[];
}

// Tool calls are the hot path: candidates are read from the store once per chain and again only
// after a save or forget changed it.
function createCandidates(store: JitDeps["store"]) {
  const byChain = new Map<string, Memo>();
  return (chain: ScopeChain): readonly Candidate[] => {
    const key = chain.map(scopeKey).join(" ");
    const generation = store.generation();
    const memo = byChain.get(key);
    if (memo !== undefined && memo.generation === generation) {
      return memo.candidates;
    }
    const candidates = triggeredMemories(store.inScopes(chain));
    byChain.set(key, { generation, candidates });
    return candidates;
  };
}

function jitText(memory: Memory): string {
  return `waymark · ${memory.kind} · ${memory.title}\n${memory.body}`;
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
  return due.map((memory) => deliver(deps, recall, memory)).join("\n\n");
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
  const candidatesFor = createCandidates(deps.store);

  function recallOf(sessionID: string): SessionRecall {
    const known = sessions.get(sessionID);
    if (known !== undefined) {
      return known;
    }
    const fresh: SessionRecall = {
      delivered: new Set(),
      queued: new Map(),
      words: new Set(),
      noisyChecked: false,
    };
    sessions.set(sessionID, fresh);
    return fresh;
  }

  return {
    onUserMessage(sessionID, text) {
      recallOf(sessionID).words = wordsOf(text);
      return Promise.resolve();
    },
    async onToolAfter(call) {
      const scope = await deps.recallScope(call.sessionID);
      if (scope === null) {
        return null;
      }
      // Nothing below awaits, so two parallel calls cannot both deliver the same memory.
      const recall = recallOf(call.sessionID);
      const facts = callFacts(call, scope.directory, recall.words);
      queueMatches(recall, candidatesFor(scope.chain), facts);
      return call.appendable && recall.queued.size > 0 ? takeQueued(deps, recall) : null;
    },
    forget(sessionID) {
      sessions.delete(sessionID);
    },
  };
}
