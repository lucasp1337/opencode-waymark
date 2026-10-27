import { isMemoryId } from "../model/id";
import type { Memory } from "../model/memory";
import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import type { MemoryStore } from "../store/memory-store";

export function lookupMemory(store: MemoryStore, input: unknown): Result<Memory, string> {
  const id = ownField(input, "id");
  if (!isMemoryId(id)) {
    return err(`id must be a memory id like 01JB8Z6Q4R3M2N1P0V9W8X7Y6Z, got ${JSON.stringify(id)}`);
  }
  const memory = store.get(id);
  return memory === undefined ? err(`no memory with id ${id}`) : ok(memory);
}
