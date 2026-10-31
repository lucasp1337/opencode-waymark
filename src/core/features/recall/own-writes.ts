import { AsyncLocalStorage } from "node:async_hooks";
import type { MemoryId } from "../../model/id";
import type { Memory } from "../../model/memory";
import type { ToolDef } from "../../port";
import type { MemoryStore } from "../../store/memory-store";

export interface OwnWrites {
  // Memories saved while the tool runs are attributed to the session that called it.
  attributeTool(def: ToolDef): ToolDef;
  attributeStore(store: MemoryStore): MemoryStore;
  // True when this session wrote exactly this version of the memory, so it already has it.
  isOwn(sessionID: string, memory: Memory): boolean;
  forget(sessionID: string): void;
}

// The `updated` stamp of the last version each session wrote, per memory.
export function createOwnWrites(): OwnWrites {
  const writing = new AsyncLocalStorage<string>();
  const written = new Map<string, Map<MemoryId, string>>();

  function record(memory: Memory): void {
    const sessionID = writing.getStore();
    if (sessionID === undefined) {
      return;
    }
    const stamps = written.get(sessionID) ?? new Map<MemoryId, string>();
    stamps.set(memory.id, memory.updated);
    written.set(sessionID, stamps);
  }

  return {
    attributeTool: (def) => ({
      ...def,
      execute: (input, ctx) => writing.run(ctx.sessionID, () => def.execute(input, ctx)),
    }),
    attributeStore: (store) => ({
      ...store,
      save(memory) {
        store.save(memory);
        record(memory);
      },
    }),
    isOwn: (sessionID, memory) => written.get(sessionID)?.get(memory.id) === memory.updated,
    forget(sessionID) {
      written.delete(sessionID);
    },
  };
}
