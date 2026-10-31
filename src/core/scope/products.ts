import { ownField } from "../model/own-field";
import { err, ok, type Result } from "../model/result";
import { isSafeScopeId } from "../model/scope";
import type { FileSystem } from "../store/fs";
import {
  isJsonObject,
  type JsonObject,
  type LoadedRegistry,
  loadRegistry,
  objectField,
  writeRegistry,
} from "./registry-file";
import { type LockTiming, systemLockTiming, withRegistryLock } from "./registry-lock";

// Two repos the user said are not one product, sorted so the pair has one spelling.
type RepoPair = readonly [string, string];

interface Products {
  // Product name -> its entry as stored, so fields this version does not know survive.
  readonly entries: JsonObject;
  // Product name -> the repo ids linked to it. A repo is in at most one product.
  readonly repos: ReadonlyMap<string, readonly string[]>;
  readonly declined: readonly RepoPair[];
}

type Registry = LoadedRegistry<Products>;

// A product name becomes one directory under the data root. Lower case only, so two spellings
// cannot share one directory on a case-insensitive file system.
export function isProductName(name: string): boolean {
  return isSafeScopeId(name) && !name.includes("/") && name === name.toLowerCase();
}

// The product name a user or agent typed, in the one spelling the registry keeps.
export function productNameOf(text: string): string | undefined {
  const name = text.toLowerCase();
  return isProductName(name) ? name : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function reposOf(name: string, entry: unknown): Result<readonly string[], string> {
  const repos = isJsonObject(entry) ? ownField(entry, "repos") : undefined;
  if (!isProductName(name)) {
    return err(`product "${name}" is not a plain name`);
  }
  return isStringArray(repos)
    ? ok(repos)
    : err(`product "${name}" must be an object with a "repos" list of repo ids`);
}

// A chain has one product slot, so a repo listed in two products could not be resolved.
function inOneProductEach(repos: ReadonlyMap<string, readonly string[]>): Result<void, string> {
  const owners = new Map<string, string>();
  for (const [name, linked] of repos) {
    const shared = linked.find((repo) => owners.has(repo));
    if (shared !== undefined) {
      return err(`repo ${shared} is in products "${owners.get(shared)}" and "${name}"`);
    }
    for (const repo of linked) {
      owners.set(repo, name);
    }
  }
  return ok(undefined);
}

function parseRepos(entries: JsonObject): Result<Map<string, readonly string[]>, string> {
  const repos = new Map<string, readonly string[]>();
  for (const [name, entry] of Object.entries(entries)) {
    const linked = reposOf(name, entry);
    if (!linked.ok) {
      return linked;
    }
    repos.set(name, linked.value);
  }
  const unique = inOneProductEach(repos);
  return unique.ok ? ok(repos) : unique;
}

function pairOf(a: string, b: string): RepoPair {
  return a < b ? [a, b] : [b, a];
}

function isPair(value: unknown): value is [string, string] {
  return isStringArray(value) && value.length === 2;
}

function parseDeclined(document: JsonObject): Result<RepoPair[], string> {
  const field = ownField(document, "declined") ?? [];
  if (!(Array.isArray(field) && field.every(isPair))) {
    return err('"declined" must be a list of repo id pairs');
  }
  return ok(field.map(([a, b]) => pairOf(a, b)));
}

function parseProducts(document: JsonObject): Result<Products, string> {
  const entries = objectField(document, "products");
  if (!entries.ok) {
    return entries;
  }
  const repos = parseRepos(entries.value);
  if (!repos.ok) {
    return repos;
  }
  const declined = parseDeclined(document);
  return declined.ok
    ? ok({ entries: entries.value, repos: repos.value, declined: declined.value })
    : declined;
}

function load(fs: FileSystem, file: string): Result<Registry, string> {
  return loadRegistry(fs, file, parseProducts);
}

function productIn(products: Products, repo: string): string | undefined {
  for (const [name, repos] of products.repos) {
    if (repos.includes(repo)) {
      return name;
    }
  }
  return undefined;
}

function isDeclinedIn(products: Products, a: string, b: string): boolean {
  const [first, second] = pairOf(a, b);
  return products.declined.some(([x, y]) => x === first && y === second);
}

// The product a repo is linked to, if any. I/O errors from the FileSystem throw.
export function productOf(
  fs: FileSystem,
  file: string,
  repo: string,
): Result<string | undefined, string> {
  const registry = load(fs, file);
  return registry.ok ? ok(productIn(registry.value.parsed, repo)) : registry;
}

// The repos linked to a product; none when the product is not in the registry.
export function productRepos(
  fs: FileSystem,
  file: string,
  product: string,
): Result<readonly string[], string> {
  const registry = load(fs, file);
  return registry.ok ? ok(registry.value.parsed.repos.get(product) ?? []) : registry;
}

export interface PairStatus {
  readonly products: readonly [string | undefined, string | undefined];
  readonly declined: boolean;
}

// What the registry says about two repos: the product of each, and whether the user said No.
export function pairStatus(
  fs: FileSystem,
  file: string,
  [a, b]: readonly [string, string],
): Result<PairStatus, string> {
  const registry = load(fs, file);
  if (!registry.ok) {
    return registry;
  }
  const products = registry.value.parsed;
  return ok({
    products: [productIn(products, a), productIn(products, b)],
    declined: isDeclinedIn(products, a, b),
  });
}

export interface LinkRequest {
  readonly repos: readonly string[];
  // Omitted: the repos join the one product some of them are already in.
  readonly product?: string;
}

export interface Linked {
  readonly product: string;
  // Every repo of the product after the link, in the order they joined.
  readonly repos: readonly string[];
  readonly created: boolean;
}

function memberships(products: Products, repos: readonly string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const repo of repos) {
    const product = productIn(products, repo);
    if (product !== undefined) {
      found.set(repo, product);
    }
  }
  return found;
}

function inOtherProducts(found: ReadonlyMap<string, string>, product: string): string[] {
  return [...found].flatMap(([repo, name]) =>
    name === product ? [] : [`${repo} is in product ${name}`],
  );
}

const LEAVE_HINT = "A repo leaves its product with /memory unlink.";

function targetProduct(products: Products, request: LinkRequest): Result<string, string> {
  const found = memberships(products, request.repos);
  if (request.product !== undefined) {
    const conflicts = inOtherProducts(found, request.product);
    return conflicts.length === 0
      ? ok(request.product)
      : err(`${conflicts.join("; ")}. ${LEAVE_HINT}`);
  }
  const [joined, ...others] = new Set(found.values());
  if (joined === undefined) {
    return err("none of these repos is in a product yet; name the product to create.");
  }
  return others.length === 0
    ? ok(joined)
    : err(
        `these repos are in different products: ${[joined, ...others].join(", ")}. ${LEAVE_HINT}`,
      );
}

function withProduct(registry: Registry, product: string, repos: readonly string[]): JsonObject {
  const { document, parsed } = registry;
  const entry = ownField(parsed.entries, product);
  const kept = isJsonObject(entry) ? entry : {};
  return { ...document, products: { ...parsed.entries, [product]: { ...kept, repos } } };
}

// Creates the product or adds the repos to it. Nothing is written when the request is refused.
export function linkRepos(
  fs: FileSystem,
  file: string,
  request: LinkRequest,
  timing: LockTiming = systemLockTiming,
): Promise<Result<Linked, string>> {
  return withRegistryLock(fs, file, timing, () => {
    const registry = load(fs, file);
    if (!registry.ok) {
      return registry;
    }
    const products = registry.value.parsed;
    const target = targetProduct(products, request);
    if (!target.ok) {
      return target;
    }
    const before = products.repos.get(target.value);
    const repos = [...new Set([...(before ?? []), ...request.repos])];
    writeRegistry(fs, file, withProduct(registry.value, target.value, repos));
    return ok({ product: target.value, repos, created: before === undefined });
  });
}

export interface Unlinked {
  readonly product: string;
  // The repos still in the product; the user said No to pairing each of them with the repo.
  readonly remaining: readonly string[];
}

function withDeclined(
  document: JsonObject,
  products: Products,
  pairs: readonly RepoPair[],
): JsonObject {
  const added = pairs.filter(([a, b]) => !isDeclinedIn(products, a, b));
  return { ...document, declined: [...products.declined, ...added] };
}

// The product keeps its name and memories; linking a repo to it again brings them back.
export function unlinkRepo(
  fs: FileSystem,
  file: string,
  repo: string,
  timing: LockTiming = systemLockTiming,
): Promise<Result<Unlinked, string>> {
  return withRegistryLock(fs, file, timing, () => {
    const registry = load(fs, file);
    if (!registry.ok) {
      return registry;
    }
    const products = registry.value.parsed;
    const product = productIn(products, repo);
    if (product === undefined) {
      return err(`${repo} is not in a product.`);
    }
    const remaining = (products.repos.get(product) ?? []).filter((linked) => linked !== repo);
    const unlinked = withProduct(registry.value, product, remaining);
    const pairs = remaining.map((other) => pairOf(repo, other));
    writeRegistry(fs, file, withDeclined(unlinked, products, pairs));
    return ok({ product, remaining });
  });
}

// Records the user's No for two repos, so they are never suggested as one product again.
export function declinePair(
  fs: FileSystem,
  file: string,
  [a, b]: readonly [string, string],
  timing: LockTiming = systemLockTiming,
): Promise<Result<void, string>> {
  return withRegistryLock(fs, file, timing, () => {
    const registry = load(fs, file);
    if (!registry.ok) {
      return registry;
    }
    const products = registry.value.parsed;
    const shared = productIn(products, a);
    if (shared !== undefined && shared === productIn(products, b)) {
      return err(`${a} and ${b} are linked as product ${shared}; /memory unlink separates them.`);
    }
    if (!isDeclinedIn(products, a, b)) {
      writeRegistry(fs, file, withDeclined(registry.value.document, products, [pairOf(a, b)]));
    }
    return ok(undefined);
  });
}
