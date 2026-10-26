declare const memoryIdBrand: unique symbol;

export type MemoryId = string & { readonly [memoryIdBrand]: true };

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isMemoryId(value: unknown): value is MemoryId {
  return typeof value === "string" && ULID.test(value);
}
