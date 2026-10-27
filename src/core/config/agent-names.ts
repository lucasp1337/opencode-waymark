function isAgentName(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

// Shared by the config file and the plugin option, so both accept the same lists.
export function isAgentNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isAgentName);
}
