import { describe, expect, test } from "bun:test";
import { mergeSkillPaths } from "./skill-paths";

describe("mergeSkillPaths", () => {
  test("creates the paths list when the config has no skills", () => {
    expect(mergeSkillPaths(undefined, ["/a"])).toEqual({ ok: true, skills: { paths: ["/a"] } });
  });

  test("keeps existing paths, urls and other fields", () => {
    const current = { paths: ["/user"], urls: ["https://x"], extra: 1 };

    expect(mergeSkillPaths(current, ["/a"])).toEqual({
      ok: true,
      skills: { paths: ["/user", "/a"], urls: ["https://x"], extra: 1 },
    });
  });

  test("adds a dir that is already listed only once", () => {
    expect(mergeSkillPaths({ paths: ["/a"] }, ["/a", "/b", "/b"])).toEqual({
      ok: true,
      skills: { paths: ["/a", "/b"] },
    });
  });

  test("does not change the current value", () => {
    const current = { paths: ["/user"] };

    mergeSkillPaths(current, ["/a"]);

    expect(current).toEqual({ paths: ["/user"] });
  });

  test("rejects a skills value that is not an object", () => {
    expect(mergeSkillPaths("/a", ["/b"])).toEqual({ ok: false, reason: "skills is not an object" });
    expect(mergeSkillPaths(["/a"], ["/b"])).toEqual({
      ok: false,
      reason: "skills is not an object",
    });
  });

  test("rejects paths that are not a list of strings", () => {
    expect(mergeSkillPaths({ paths: "/a" }, ["/b"])).toEqual({
      ok: false,
      reason: "skills.paths is not a list of strings",
    });
    expect(mergeSkillPaths({ paths: [1] }, ["/b"])).toEqual({
      ok: false,
      reason: "skills.paths is not a list of strings",
    });
  });
});
