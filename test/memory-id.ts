import { isMemoryId, type MemoryId } from "../src/core/model/id";

// Fixture ids go through the real guard, so they carry the MemoryId brand honestly.
export function memoryId(text: string): MemoryId {
  if (!isMemoryId(text)) {
    throw new Error(`fixture id ${text} is not a ULID`);
  }
  return text;
}
