import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import type { FileSystem } from "../store/fs";

export interface OrgRef {
  readonly id: string;
  readonly owner: string;
}

type JsonObject = Record<string, unknown>;

interface Registry {
  // Whole file, so keys this version does not know survive a rewrite.
  readonly document: JsonObject;
  readonly orgs: JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): Result<unknown, string> {
  try {
    const parsed: unknown = JSON.parse(text);
    return ok(parsed);
  } catch {
    return err("is not valid JSON");
  }
}

function parseRegistry(text: string | undefined): Result<Registry, string> {
  if (text === undefined) {
    return ok({ document: {}, orgs: {} });
  }
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }
  if (!isJsonObject(json.value)) {
    return err("must be a JSON object");
  }
  const field = ownField(json.value, "orgs");
  const orgs = field === undefined ? {} : field;
  return isJsonObject(orgs)
    ? ok({ document: json.value, orgs })
    : err('"orgs" must be a JSON object');
}

// A registry that cannot be understood is reported and left untouched. I/O errors from the
// FileSystem throw and are caught at the caller's edge.
export function registerOrg(
  fs: FileSystem,
  file: string,
  org: OrgRef,
): Result<"added" | "known", string> {
  const registry = parseRegistry(fs.readText(file));
  if (!registry.ok) {
    return err(`registry ${file} ${registry.error}`);
  }
  const { document, orgs } = registry.value;
  if (ownField(orgs, org.id) !== undefined) {
    return ok("known");
  }
  const updated = { ...document, orgs: { ...orgs, [org.id]: { owner: org.owner } } };
  fs.writeAtomic(file, `${JSON.stringify(updated, null, 2)}\n`);
  return ok("added");
}
