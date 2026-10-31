import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import type { FileSystem } from "../store/fs";

export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): Result<unknown, string> {
  try {
    const parsed: unknown = JSON.parse(text);
    return ok(parsed);
  } catch (error) {
    return err(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function objectField(document: JsonObject, name: string): Result<JsonObject, string> {
  const field = ownField(document, name);
  if (field === undefined) {
    return ok({});
  }
  return isJsonObject(field) ? ok(field) : err(`"${name}" must be a JSON object`);
}

function parseDocument(text: string | undefined): Result<JsonObject, string> {
  if (text === undefined) {
    return ok({});
  }
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }
  return isJsonObject(json.value) ? ok(json.value) : err("must be a JSON object");
}

export interface LoadedRegistry<T> {
  // Whole file, so keys one part of Waymark does not know survive its rewrite.
  readonly document: JsonObject;
  readonly parsed: T;
}

// A missing file is an empty registry. A registry that cannot be understood is reported with the
// file's name; I/O errors from the FileSystem throw and are caught at the caller's edge.
export function loadRegistry<T>(
  fs: FileSystem,
  file: string,
  parse: (document: JsonObject) => Result<T, string>,
): Result<LoadedRegistry<T>, string> {
  const document = parseDocument(fs.readText(file));
  if (!document.ok) {
    return err(`registry ${file} ${document.error}`);
  }
  const parsed = parse(document.value);
  return parsed.ok
    ? ok({ document: document.value, parsed: parsed.value })
    : err(`registry ${file} ${parsed.error}`);
}

export function writeRegistry(fs: FileSystem, file: string, document: JsonObject): void {
  fs.writeAtomic(file, `${JSON.stringify(document, null, 2)}\n`);
}

// For callers that log a registry problem and carry on: a thrown I/O error becomes an error value.
export function catchRegistryIo<T>(read: () => Result<T, string>): Result<T, string> {
  try {
    return read();
  } catch (error) {
    return err(String(error));
  }
}

export async function catchRegistryIoAsync<T>(
  read: () => Promise<Result<T, string>>,
): Promise<Result<T, string>> {
  try {
    return await read();
  } catch (error) {
    return err(String(error));
  }
}
