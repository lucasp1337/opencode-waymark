import { describe, expect, test } from "bun:test";
import { memoryId } from "../../../../test/memory-id";
import { parseMemoryCommand } from "./command-parse";

const ID = memoryId("01JB8Z6Q4R3M2N1P0V9W8X0001");

describe("parseMemoryCommand", () => {
  test.each(["", "   ", "\n"])("blank arguments %j list the chain", (args) => {
    expect(parseMemoryCommand(args)).toEqual({ ok: true, value: { name: "list" } });
  });

  test("review is recognised", () => {
    expect(parseMemoryCommand("review")).toEqual({ ok: true, value: { name: "review" } });
  });

  test("words are split on any whitespace", () => {
    expect(parseMemoryCommand(`  move\t${ID}\n repo `)).toEqual({
      ok: true,
      value: { name: "move", id: ID, level: "repo" },
    });
  });

  test("an id in brackets, as listings show it, is accepted", () => {
    expect(parseMemoryCommand(`move [${ID}] org`)).toEqual({
      ok: true,
      value: { name: "move", id: ID, level: "org" },
    });
  });

  test("brackets that do not surround the whole id are not stripped", () => {
    expect(parseMemoryCommand(`move [${ID} org`).ok).toBe(false);
  });

  test("org merge names the org to keep first and the org to merge second", () => {
    expect(parseMemoryCommand("org merge github.com/acme github.com/acme-labs")).toEqual({
      ok: true,
      value: {
        name: "org-merge",
        merge: { into: "github.com/acme", from: "github.com/acme-labs" },
      },
    });
  });

  test.each([
    ["an unknown subcommand", "frobnicate"],
    ["setup, which the command template handles", "setup"],
    ["review with extra words", "review now"],
  ])("%s gets the usage text", (_case, args) => {
    const parsed = parseMemoryCommand(args);

    expect(!parsed.ok && parsed.error).toContain("Subcommands of /memory:");
  });

  test.each([
    ["no scope", `move ${ID}`],
    ["an id that is not a memory id", "move abc repo"],
    ["empty brackets", "move [] repo"],
    ["a scope level that does not exist", `move ${ID} galaxy`],
    ["trailing words", `move ${ID} repo now`],
  ])("move with %s is refused with its usage", (_case, args) => {
    const parsed = parseMemoryCommand(args);

    expect(!parsed.ok && parsed.error).toStartWith(
      "Not moved: expected /memory move <id> <user|org|product|repo>",
    );
  });

  test.each([
    ["only the verb", "org merge"],
    ["one org", "org merge github.com/acme"],
    ["three orgs", "org merge a b c"],
    ["another verb", "org split a b"],
    ["no verb", "org"],
  ])("org with %s is refused with its usage", (_case, args) => {
    const parsed = parseMemoryCommand(args);

    expect(!parsed.ok && parsed.error).toStartWith("Not merged: expected /memory org merge");
  });
});
