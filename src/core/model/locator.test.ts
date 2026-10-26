import { describe, expect, test } from "bun:test";
import { hasLocator } from "./locator";

describe("hasLocator", () => {
  test.each([
    ["a URL", "Runbook: https://wiki.example.com/deploy"],
    ["an absolute path", "Logs go to /var/log/app.log"],
    ["a home-relative path", "Edit ~/.config/tool"],
    ["a relative path naming a file, in backticks", "See `docs/release.md` first."],
    ["a directory path", "Everything under src/core/ is pure"],
    ["a Windows path", "Config lives in C:\\tools\\app.ini"],
    ["a ticket key in parentheses", "Tracked in (PAY-1234)."],
  ])("accepts %s", (_case, text) => {
    expect(hasLocator(text)).toBe(true);
  });

  test.each([
    ["plain prose", "Ask the platform team before changing it"],
    ["a lone slash", "either / or"],
    ["slash-joined words", "choose and/or, TCP/IP, 24/7"],
    ["a lowercase key-like token", "see pay-12"],
  ])("rejects %s", (_case, text) => {
    expect(hasLocator(text)).toBe(false);
  });

  test("accepts ticket-shaped tokens such as UTF-8, a known structural false positive", () => {
    expect(hasLocator("Use UTF-8 everywhere")).toBe(true);
  });
});
