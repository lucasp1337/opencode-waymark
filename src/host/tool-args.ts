const PATH_FIELDS = ["filePath", "path", "workdir"];
const PATCH_FIELD = "patchText";
// The fixed file headers of the apply_patch format; each names exactly one path.
const PATCH_HEADERS = ["*** Add File:", "*** Update File:", "*** Delete File:", "*** Move to:"];

function stringField(args: unknown, field: string): string | undefined {
  if (args === null || typeof args !== "object") {
    return undefined;
  }
  const value = Object.getOwnPropertyDescriptor(args, field)?.value;
  return typeof value === "string" ? value : undefined;
}

function patchHeaderPath(line: string): string[] {
  const header = PATCH_HEADERS.find((candidate) => line.startsWith(candidate));
  const path = header === undefined ? "" : line.slice(header.length).trim();
  return path === "" ? [] : [path];
}

function patchPaths(patchText: string | undefined): string[] {
  return patchText === undefined ? [] : patchText.split(/\r?\n/).flatMap(patchHeaderPath);
}

export function touchedPaths(args: unknown): string[] {
  return [
    ...PATH_FIELDS.flatMap((field) => stringField(args, field) ?? []),
    ...patchPaths(stringField(args, PATCH_FIELD)),
  ];
}

export function commandOf(args: unknown): string | undefined {
  return stringField(args, "command");
}
