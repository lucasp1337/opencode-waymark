import { describe, expect, test } from "bun:test";
import { isWord, normalWord, wordsOf } from "./words";

describe("isWord", () => {
  test.each(["migration", "feature-flag", "feature_flag", "Košice", "v2"])("accepts %s", (word) => {
    expect(isWord(word)).toBe(true);
  });

  test.each(["node.js", "c++", ".env", "two words", ""])("rejects %s", (text) => {
    expect(isWord(text)).toBe(false);
  });
});

describe("wordsOf", () => {
  test("splits on anything that is not part of a word and lowercases", () => {
    expect([...wordsOf("Run the (migration), please: node.js!")]).toEqual([
      "run",
      "the",
      "migration",
      "please",
      "node",
      "js",
    ]);
  });

  test("composes decomposed accents", () => {
    expect(wordsOf("Košice").has(normalWord("Košice"))).toBe(true);
  });
});
