import type { JsonSchema, JsonSchemaObject } from "./port";

export interface SchemaBuilder<T> {
  string(): T;
  number(): T;
  boolean(): T;
  enumOf(values: [string, ...string[]]): T;
  array(item: T): T;
  object(shape: Record<string, T>): T;
  optional(schema: T): T;
  describe(schema: T, text: string): T;
}

export class UnsupportedSchemaError extends Error {}

function buildEnum<T>(values: string[], builder: SchemaBuilder<T>): T {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new UnsupportedSchemaError("enum needs at least one value");
  }
  return builder.enumOf([first, ...rest]);
}

function buildNode<T>(schema: JsonSchema, builder: SchemaBuilder<T>): T {
  switch (schema.type) {
    case "string":
      return schema.enum ? buildEnum(schema.enum, builder) : builder.string();
    case "number":
      return builder.number();
    case "boolean":
      return builder.boolean();
    case "array":
      return builder.array(buildNode(schema.items, builder));
    case "object":
      return builder.object(buildShape(schema, builder));
  }
}

function withDescription<T>(node: T, schema: JsonSchema, builder: SchemaBuilder<T>): T {
  return schema.description === undefined ? node : builder.describe(node, schema.description);
}

// The SDK wants a zod raw shape; building it through SchemaBuilder keeps zod out of core.
export function buildShape<T>(
  schema: JsonSchemaObject,
  builder: SchemaBuilder<T>,
): Record<string, T> {
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(
    Object.entries(schema.properties).map(([name, property]) => {
      const node = withDescription(buildNode(property, builder), property, builder);
      return [name, required.has(name) ? node : builder.optional(node)];
    }),
  );
}
