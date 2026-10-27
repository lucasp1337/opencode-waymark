import { err, ok, type Result } from "../model/result";

// Strings are matched first, so a `//` inside one is kept. A comment becomes a space so that
// `1/**/2` does not turn into `12`.
function stripComments(text: string): string {
  const token = /"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  return text.replace(token, (match) => (match.startsWith('"') ? match : " "));
}

// JSON with `//` and `/* */` comments; anything else that is not JSON is rejected.
export function parseJsonc(text: string): Result<unknown, string> {
  try {
    const parsed: unknown = JSON.parse(stripComments(text));
    return ok(parsed);
  } catch (error) {
    return err(`not valid JSONC (${String(error)})`);
  }
}
