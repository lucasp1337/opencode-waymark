import { ownField } from "../../model/own-field";
import { err, ok, type Result } from "../../model/result";
import { isSafeScopeId } from "../../model/scope";
import type { JsonSchemaObject, ToolDef } from "../../port";
import { declinePair, type LinkRequest, linkRepos, productNameOf } from "../../scope/products";
import type { FileSystem } from "../../store/fs";
import { declinedReply, linkedReply } from "./link-replies";

export interface LinkDeps {
  readonly fs: FileSystem;
  readonly registryFile: string;
}

const INPUT_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: { type: "string" },
      description: "Repo ids exactly as Waymark named them, e.g. github.com/acme/api",
    },
    product: {
      type: "string",
      description:
        "The product to create or join, a plain name such as payments. Omit to join the product one of the repos is already in",
    },
    decline: {
      type: "boolean",
      description: "true when the user said the two repos are not one product",
    },
  },
  required: ["repos"],
};

type LinkInput =
  | { readonly decline: true; readonly pair: readonly [string, string] }
  | { readonly decline: false; readonly request: LinkRequest };

const REPOS_PROBLEM = "repos must be a list of repo ids as Waymark named them";
const PRODUCT_PROBLEM = "product must be a plain name such as payments (letters, digits, . _ ~ -)";

function isRepoId(value: unknown): value is string {
  return typeof value === "string" && isSafeScopeId(value);
}

function parseRepos(value: unknown): Result<string[], string> {
  return Array.isArray(value) && value.length > 0 && value.every(isRepoId)
    ? ok([...new Set(value)])
    : err(REPOS_PROBLEM);
}

function parseProduct(value: unknown): Result<string | undefined, string> {
  if (value === undefined) {
    return ok(undefined);
  }
  const name = typeof value === "string" ? productNameOf(value) : undefined;
  return name === undefined ? err(PRODUCT_PROBLEM) : ok(name);
}

function parseDecline(value: unknown): Result<boolean, string> {
  if (value === undefined) {
    return ok(false);
  }
  return typeof value === "boolean" ? ok(value) : err("decline must be true or false");
}

function declineOf(
  repos: readonly string[],
  product: string | undefined,
): Result<LinkInput, string> {
  const [a, b, ...more] = repos;
  if (product !== undefined) {
    return err("a declined pair takes no product");
  }
  return a !== undefined && b !== undefined && more.length === 0
    ? ok({ decline: true, pair: [a, b] })
    : err("decline takes exactly two repos");
}

function parseInput(input: unknown): Result<LinkInput, string[]> {
  const repos = parseRepos(ownField(input, "repos"));
  const product = parseProduct(ownField(input, "product"));
  const decline = parseDecline(ownField(input, "decline"));
  if (!(repos.ok && product.ok && decline.ok)) {
    return err([repos, product, decline].flatMap((field) => (field.ok ? [] : [field.error])));
  }
  if (decline.value) {
    const declined = declineOf(repos.value, product.value);
    return declined.ok ? declined : err([declined.error]);
  }
  const request = product.value === undefined ? {} : { product: product.value };
  return ok({ decline: false, request: { repos: repos.value, ...request } });
}

function record(deps: LinkDeps, input: LinkInput): string {
  if (input.decline) {
    const declined = declinePair(deps.fs, deps.registryFile, input.pair);
    return declined.ok ? declinedReply(input.pair) : `Not recorded: ${declined.error}`;
  }
  const linked = linkRepos(deps.fs, deps.registryFile, input.request);
  return linked.ok ? linkedReply(linked.value) : `Not linked: ${linked.error}`;
}

export function memoryLinkTool(deps: LinkDeps): ToolDef {
  return {
    name: "memory_link",
    description:
      "Record the user's answer about linking repos into one product, whose memories apply in all of its repos. Call only after asking the user: with product to create or join one, without product to join the product one of the repos is in, or with decline true when the user said no.",
    inputSchema: INPUT_SCHEMA,
    execute: (input) => {
      const parsed = parseInput(input);
      const reply = parsed.ok
        ? record(deps, parsed.value)
        : `Not linked: ${parsed.error.join("; ")}`;
      return Promise.resolve(reply);
    },
  };
}
