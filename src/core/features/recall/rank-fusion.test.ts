import { describe, expect, test } from "bun:test";
import { fuseRankings } from "./rank-fusion";

const itself = (item: string) => item;

describe("fuseRankings", () => {
  test("an item ranked by both rankings beats one ranked first by only one", () => {
    expect(
      fuseRankings(
        [
          ["a", "b"],
          ["c", "b"],
        ],
        itself,
      ),
    ).toEqual(["b", "a", "c"]);
  });

  test("keeps the order of a single ranking", () => {
    expect(fuseRankings([["x", "y", "z"]], itself)).toEqual(["x", "y", "z"]);
  });

  test("returns nothing when there are no rankings", () => {
    expect(fuseRankings([], itself)).toEqual([]);
  });

  test("equal scores keep the order of the first ranking that listed them", () => {
    expect(fuseRankings([["a"], ["b"]], itself)).toEqual(["a", "b"]);
  });

  test("lists an item once even when several rankings include it", () => {
    expect(fuseRankings([["a", "b"], ["a"]], itself)).toEqual(["a", "b"]);
  });

  test("identifies items by the given key rather than by reference", () => {
    const first = [{ id: "1", from: "first" }];
    const second = [{ id: "1", from: "second" }];

    expect(fuseRankings([first, second], (item) => item.id)).toEqual(first);
  });
});
