// Reads an own property of untrusted input without trusting its type.
export function ownField(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
