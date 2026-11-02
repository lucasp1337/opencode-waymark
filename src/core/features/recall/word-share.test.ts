import { describe, expect, test } from "bun:test";
import { wordsOf } from "../../model/words";
import { wordShare } from "./word-share";

describe("wordShare", () => {
  test("is one when the stored text holds every new word", () => {
    expect(wordShare(wordsOf("Run tests"), "Always run the tests first")).toBe(1);
  });

  test("is the fraction of the new words that the stored text holds", () => {
    expect(wordShare(wordsOf("run the tests now"), "run tests")).toBe(0.5);
  });

  test("ignores case and repeated words", () => {
    expect(wordShare(wordsOf("Tests tests TESTS"), "tests")).toBe(1);
  });

  test("is zero when no word is shared", () => {
    expect(wordShare(wordsOf("backups"), "tests")).toBe(0);
  });

  test("is zero for a new text without words", () => {
    expect(wordShare(wordsOf("..."), "tests")).toBe(0);
  });
});
