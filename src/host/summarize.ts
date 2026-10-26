const MAX_STRING = 200;

export type Summary = string | number | boolean | null | Summary[] | { [key: string]: Summary };

function summarizeString(value: string): string {
  return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
}

function summarizeObject(value: object, depth: number): Summary {
  if (depth === 0) {
    return Array.isArray(value) ? `array(${value.length})` : "object";
  }
  if (Array.isArray(value)) {
    return value.map((item) => summarize(item, depth - 1));
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, summarize(item, depth - 1)]),
  );
}

// Hook payloads can hold whole models and messages; the log only needs their shape and short values.
export function summarize(value: unknown, depth = 2): Summary {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return summarizeString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return typeof value === "object" ? summarizeObject(value, depth) : typeof value;
}
