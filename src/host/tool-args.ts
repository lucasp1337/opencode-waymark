const PATH_FIELDS = ["filePath", "path"];

function stringField(args: unknown, field: string): string | undefined {
  if (args === null || typeof args !== "object") {
    return undefined;
  }
  const value = Object.getOwnPropertyDescriptor(args, field)?.value;
  return typeof value === "string" ? value : undefined;
}

export function touchedPaths(args: unknown): string[] {
  return PATH_FIELDS.flatMap((field) => stringField(args, field) ?? []);
}

export function commandOf(args: unknown): string | undefined {
  return stringField(args, "command");
}
