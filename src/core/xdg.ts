import { isAbsolute } from "node:path";

// The XDG spec says empty or relative values must be ignored.
export function absoluteOr(value: string | undefined, fallback: string): string {
  return value !== undefined && isAbsolute(value) ? value : fallback;
}
