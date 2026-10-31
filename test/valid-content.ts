import type { MemoryContent, ValidContent } from "../src/core/model/memory";
import { parseContent } from "../src/core/model/validate";

// Test fixtures go through the real validator, so they carry the ValidContent guarantee honestly.
// Content as a test writes it: the locator is plain text until the validator brands it.
export type ContentInput = Omit<MemoryContent, "locator"> & { readonly locator?: string };

export function validContent(input: ContentInput): ValidContent {
  const result = parseContent(input);
  if (!result.ok) {
    throw new Error(`invalid fixture: ${result.error.join("; ")}`);
  }
  return result.value;
}
