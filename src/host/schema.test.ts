import { describe, expect, test } from "bun:test";
import { useRuntime } from "../../test/runtime-fixture";
import type { JsonSchemaObject } from "../core/port";
import { buildShape, type SchemaBuilder, UnsupportedSchemaError } from "./schema";

// Builds a readable tree so tests assert on structure instead of on zod internals.
const treeBuilder: SchemaBuilder<string> = {
  string: () => "string",
  number: () => "number",
  boolean: () => "boolean",
  enumOf: (values) => `enum(${values.join("|")})`,
  array: (item) => `array(${item})`,
  object: (shape) => `object(${Object.keys(shape).join(",")})`,
  optional: (schema) => `optional(${schema})`,
  describe: (schema, text) => `${schema}#${text}`,
};

function objectOf(
  properties: JsonSchemaObject["properties"],
  required?: string[],
): JsonSchemaObject {
  return required === undefined
    ? { type: "object", properties }
    : { type: "object", properties, required };
}

describe("buildShape", () => {
  test("maps each supported JSON Schema type to a builder node", () => {
    const schema = objectOf(
      {
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
        d: { type: "array", items: { type: "string" } },
        e: objectOf({ inner: { type: "string" } }),
      },
      ["a", "b", "c", "d", "e"],
    );

    expect(buildShape(schema, treeBuilder)).toEqual({
      a: "string",
      b: "number",
      c: "boolean",
      d: "array(string)",
      e: "object(inner)",
    });
  });

  test("marks properties missing from required as optional", () => {
    const schema = objectOf({ a: { type: "string" }, b: { type: "string" } }, ["a"]);

    expect(buildShape(schema, treeBuilder)).toEqual({ a: "string", b: "optional(string)" });
  });

  test("treats every property as optional when required is absent", () => {
    const schema = objectOf({ a: { type: "number" } });

    expect(buildShape(schema, treeBuilder)).toEqual({ a: "optional(number)" });
  });

  test("builds string enums", () => {
    const schema = objectOf({ mode: { type: "string", enum: ["plain", "loud"] } }, ["mode"]);

    expect(buildShape(schema, treeBuilder)).toEqual({ mode: "enum(plain|loud)" });
  });

  test("attaches descriptions before applying optional", () => {
    const schema = objectOf({ a: { type: "string", description: "the a" } });

    expect(buildShape(schema, treeBuilder)).toEqual({ a: "optional(string#the a)" });
  });

  test("rejects an enum with no values", () => {
    const schema = objectOf({ mode: { type: "string", enum: [] } });

    expect(() => buildShape(schema, treeBuilder)).toThrow(UnsupportedSchemaError);
  });
});

describe("Waymark's tool schemas", () => {
  const runtime = useRuntime();

  test("every registered tool schema converts with only supported types", () => {
    const shapes = [...runtime().host.tools.values()].map((tool) =>
      buildShape(tool.inputSchema, treeBuilder),
    );

    expect(shapes.map((shape) => Object.keys(shape))).toEqual([
      ["kind", "scope", "title", "body", "locator", "why", "triggers", "relation"],
      ["id", "title", "body", "locator", "why", "triggers"],
      ["id"],
      ["query", "kinds", "scopes"],
      ["id"],
      [
        "preset",
        "caps",
        "indexLines",
        "indexExitSessions",
        "indexExitDays",
        "subagents",
        "compactionSave",
        "toasts",
      ],
      ["args"],
      ["repos", "product", "decline"],
    ]);
  });
});
