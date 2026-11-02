// The V1 SDK's Config type has no `skills` field, yet opencode reads `skills.paths` from the object
// the config hook mutates, so the current value is parsed here rather than trusted.
export type SkillsMerge =
  | { readonly ok: true; readonly skills: object }
  | { readonly ok: false; readonly reason: string };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

// The config hook runs again on every instance reload, so merging the same dirs twice is a no-op.
export function mergeSkillPaths(current: unknown, dirs: readonly string[]): SkillsMerge {
  const skills = current ?? {};
  if (typeof skills !== "object" || Array.isArray(skills)) {
    return { ok: false, reason: "skills is not an object" };
  }
  const paths: unknown = Reflect.get(skills, "paths") ?? [];
  if (!isStringArray(paths)) {
    return { ok: false, reason: "skills.paths is not a list of strings" };
  }
  return { ok: true, skills: { ...skills, paths: [...new Set([...paths, ...dirs])] } };
}
