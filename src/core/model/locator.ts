import { err, ok, type Result } from "./result";

declare const locatorBrand: unique symbol;

// Where a reference points. Its content is the agent's; only its shape is checked.
export type Locator = string & { readonly [locatorBrand]: true };

export const MAX_LOCATOR_LENGTH = 500;

const LINE_BREAK = /[\r\n]/;

function isLocator(text: string): text is Locator {
  return text !== "" && !LINE_BREAK.test(text) && text.length <= MAX_LOCATOR_LENGTH;
}

export function parseLocator(value: unknown): Result<Locator, string> {
  if (typeof value !== "string" || value.trim() === "") {
    return err("locator must be a non-empty string");
  }
  const trimmed = value.trim();
  if (LINE_BREAK.test(trimmed)) {
    return err("locator must be a single line");
  }
  return isLocator(trimmed)
    ? ok(trimmed)
    : err(`locator must be at most ${MAX_LOCATOR_LENGTH} characters`);
}
