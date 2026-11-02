import { describe, expect, test } from "bun:test";
import { productMapLine } from "./product-map";

const HOME = "/home/lucas";
const ORDERS = "github.com/acme/orders";
const CUSTOMERS = "github.com/acme/customers";
const BILLING = "github.com/acme/billing";
const INVOICE = "github.com/acme/invoice-pdf";

function mapOf(overrides: Partial<Parameters<typeof productMapLine>[0]> = {}): Promise<string> {
  return productMapLine({
    product: "payments",
    own: ORDERS,
    members: [CUSTOMERS, BILLING, ORDERS, INVOICE],
    checkouts: new Map([
      [CUSTOMERS, `${HOME}/src/customers`],
      [BILLING, `${HOME}/src/billing`],
    ]),
    home: HOME,
    exists: () => Promise.resolve(true),
    ...overrides,
  });
}

describe("productMapLine", () => {
  test("puts the own repo first and keeps the registry's order for the rest", async () => {
    expect(await mapOf()).toBe(
      "Product payments: orders (here) · customers ~/src/customers · billing ~/src/billing · invoice-pdf (no checkout seen)",
    );
  });

  test("shows a path outside the home directory as it is", async () => {
    const line = await mapOf({ checkouts: new Map([[CUSTOMERS, "/srv/customers"]]) });

    expect(line).toContain("customers /srv/customers");
  });

  test("does not mistake a sibling directory of the home directory for a path inside it", async () => {
    const line = await mapOf({ checkouts: new Map([[CUSTOMERS, "/home/lucas2/customers"]]) });

    expect(line).toContain("customers /home/lucas2/customers");
  });

  test("shows the home directory itself as a tilde", async () => {
    expect(await mapOf({ checkouts: new Map([[CUSTOMERS, HOME]]) })).toContain("customers ~ ·");
  });

  test("hides a path whose work tree is gone", async () => {
    const line = await mapOf({ exists: (root) => Promise.resolve(!root.endsWith("customers")) });

    expect(line).toContain("customers (no checkout seen)");
    expect(line).toContain("billing ~/src/billing");
  });

  test("shows the own repo first even when the registry does not list it", async () => {
    expect(await mapOf({ members: [CUSTOMERS] })).toStartWith(
      "Product payments: orders (here) · customers",
    );
  });

  test("counts the repos that do not fit instead of listing them", async () => {
    const members = Array.from({ length: 30 }, (_, n) => `github.com/acme/service-${n}`);

    const line = await mapOf({ members: [ORDERS, ...members], checkouts: new Map() });

    expect(line.length).toBeLessThanOrEqual(200);
    expect(line).toMatch(/ · \+\d+ more, see \/memory triggers repos$/);
    expect(line).toStartWith("Product payments: orders (here) · service-0 (no checkout seen)");
  });

  test("always shows the own repo, even when its entry alone exceeds the cap", async () => {
    const own = `github.com/acme/${"x".repeat(300)}`;

    const line = await mapOf({ own, members: [own, CUSTOMERS], checkouts: new Map() });

    expect(line).toBe(
      `Product payments: ${"x".repeat(300)} (here) · +1 more, see /memory triggers repos`,
    );
  });
});
