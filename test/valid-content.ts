import type { MemoryContent, ValidContent } from "../src/core/model/memory";
import { parseContent } from "../src/core/model/validate";

// Test fixtures go through the real validator, so they carry the ValidContent guarantee honestly.
export function validContent(input: MemoryContent): ValidContent {
  const result = parseContent(input);
  if (!result.ok) {
    throw new Error(`invalid fixture: ${result.error.join("; ")}`);
  }
  return result.value;
}
