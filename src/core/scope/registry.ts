import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import type { FileSystem } from "../store/fs";

export interface OrgRef {
  readonly id: string;
  readonly owner: string;
}

// `from` becomes an alias of `into`: sessions in `from`'s repos resolve to `into`.
export interface OrgMerge {
  readonly into: string;
  readonly from: string;
}

type JsonObject = Record<string, unknown>;

interface Registry {
  // Whole file, so keys this version does not know survive a rewrite.
  readonly document: JsonObject;
  readonly orgs: JsonObject;
  // Merged org id -> the org that absorbed it. Never chained: a merge repoints earlier aliases.
  readonly aliases: Readonly<Record<string, string>>;
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

function objectField(document: JsonObject, name: string): Result<JsonObject, string> {
  const field = ownField(document, name);
  if (field === undefined) {
    return ok({});
  }
  return isJsonObject(field) ? ok(field) : err(`"${name}" must be a JSON object`);
}

function parseAliases(document: JsonObject): Result<Record<string, string>, string> {
  const field = objectField(document, "aliases");
  if (!field.ok) {
    return field;
  }
  const aliases: [string, string][] = [];
  for (const [merged, target] of Object.entries(field.value)) {
    if (typeof target !== "string") {
      return err('"aliases" must map org ids to org ids');
    }
    aliases.push([merged, target]);
  }
  return ok(Object.fromEntries(aliases));
}

function parseRegistry(text: string | undefined): Result<Registry, string> {
  if (text === undefined) {
    return ok({ document: {}, orgs: {}, aliases: {} });
  }
  const json = parseJson(text);
  if (!json.ok) {
    return json;
  }
  if (!isJsonObject(json.value)) {
    return err("must be a JSON object");
  }
  const document = json.value;
  const orgs = objectField(document, "orgs");
  const aliases = parseAliases(document);
  if (!orgs.ok) {
    return orgs;
  }
  return aliases.ok ? ok({ document, orgs: orgs.value, aliases: aliases.value }) : aliases;
}

function loadRegistry(fs: FileSystem, file: string): Result<Registry, string> {
  const registry = parseRegistry(fs.readText(file));
  return registry.ok ? registry : err(`registry ${file} ${registry.error}`);
}

function writeRegistry(fs: FileSystem, file: string, document: JsonObject): void {
  fs.writeAtomic(file, `${JSON.stringify(document, null, 2)}\n`);
}

function aliasOf(aliases: Registry["aliases"], id: string): string | undefined {
  const target = ownField(aliases, id);
  return typeof target === "string" ? target : undefined;
}

export interface OrgEntry {
  // The org the repo belongs to now: `org` itself unless it was merged into another.
  readonly id: string;
  // True on the first sight of an org that was never registered or merged.
  readonly added: boolean;
}

// Registers an org on first sight and says which org its repos belong to. A registry that cannot
// be understood is reported and left untouched. I/O errors from the FileSystem throw and are
// caught at the caller's edge.
export function resolveOrg(fs: FileSystem, file: string, org: OrgRef): Result<OrgEntry, string> {
  const registry = loadRegistry(fs, file);
  if (!registry.ok) {
    return registry;
  }
  const { document, orgs, aliases } = registry.value;
  const absorbedBy = aliasOf(aliases, org.id);
  if (absorbedBy !== undefined) {
    return ok({ id: absorbedBy, added: false });
  }
  if (ownField(orgs, org.id) !== undefined) {
    return ok({ id: org.id, added: false });
  }
  writeRegistry(fs, file, { ...document, orgs: { ...orgs, [org.id]: { owner: org.owner } } });
  return ok({ id: org.id, added: true });
}

function knownOrgs(orgs: JsonObject): string {
  const ids = Object.keys(orgs);
  return ids.length === 0 ? "none" : ids.join(", ");
}

function mergeAllowed({ orgs, aliases }: Registry, { into, from }: OrgMerge): Result<void, string> {
  if (into === from) {
    return err("an org cannot be merged into itself");
  }
  const unknown = [into, from].filter((id) => ownField(orgs, id) === undefined);
  if (unknown.length > 0) {
    return err(`unknown org ${unknown.join(" and ")}; known orgs: ${knownOrgs(orgs)}`);
  }
  const absorbedBy = aliasOf(aliases, from);
  if (absorbedBy !== undefined) {
    return err(`${from} was already merged into ${absorbedBy}`);
  }
  const intoAbsorbedBy = aliasOf(aliases, into);
  return intoAbsorbedBy === undefined
    ? ok(undefined)
    : err(`${into} was merged into ${intoAbsorbedBy}; merge into that org instead`);
}

function withMerge(aliases: Registry["aliases"], { into, from }: OrgMerge): JsonObject {
  const repointed = Object.entries(aliases).map(([merged, target]) => [
    merged,
    target === from ? into : target,
  ]);
  return { ...Object.fromEntries(repointed), [from]: into };
}

// Read-only, so the caller can move memories before the merge is recorded: a crash in between
// leaves a merge that can simply be run again.
export function checkMerge(fs: FileSystem, file: string, merge: OrgMerge): Result<void, string> {
  const registry = loadRegistry(fs, file);
  return registry.ok ? mergeAllowed(registry.value, merge) : registry;
}

export function recordMerge(fs: FileSystem, file: string, merge: OrgMerge): Result<void, string> {
  const registry = loadRegistry(fs, file);
  if (!registry.ok) {
    return registry;
  }
  const allowed = mergeAllowed(registry.value, merge);
  if (!allowed.ok) {
    return allowed;
  }
  writeRegistry(fs, file, {
    ...registry.value.document,
    aliases: withMerge(registry.value.aliases, merge),
  });
  return ok(undefined);
}
