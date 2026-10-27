import { describe, expect, test } from "bun:test";
import { parseJsonc } from "./jsonc";

describe("parseJsonc", () => {
  test("parses plain JSON", () => {
    expect(parseJsonc('{"a": [1, true, null]}')).toEqual({
      ok: true,
      value: { a: [1, true, null] },
    });
  });

  test("ignores line and block comments", () => {
    const text = `{
      // a line comment
      "a": 1, /* inline */ "b": 2
      /* spanning
         lines */
    }`;

    expect(parseJsonc(text)).toEqual({ ok: true, value: { a: 1, b: 2 } });
  });

  test("keeps comment markers inside strings", () => {
    const text = '{"url": "https://example.com/*not a comment*/", "path": "a//b"}';

    expect(parseJsonc(text)).toEqual({
      ok: true,
      value: { url: "https://example.com/*not a comment*/", path: "a//b" },
    });
  });

  test("keeps an escaped quote from ending a string early", () => {
    expect(parseJsonc('{"a": "say \\"hi\\" // still text"} // gone')).toEqual({
      ok: true,
      value: { a: 'say "hi" // still text' },
    });
  });

  test("a comment does not join the tokens around it", () => {
    expect(parseJsonc("[1/**/2]").ok).toBe(false);
  });

  test("rejects a block comment that never closes", () => {
    expect(parseJsonc('{"a": 1} /* open').ok).toBe(false);
  });

  test("rejects trailing commas and other non-JSON", () => {
    expect(parseJsonc('{"a": 1,}').ok).toBe(false);
    expect(parseJsonc("{a: 1}").ok).toBe(false);
  });

  test("rejects empty text", () => {
    expect(parseJsonc("// only a comment").ok).toBe(false);
  });

  test("names the problem in the error", () => {
    expect(parseJsonc("{")).toEqual({
      ok: false,
      error: expect.stringContaining("not valid JSONC"),
    });
  });
});
