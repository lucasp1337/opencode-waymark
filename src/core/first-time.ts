// For logging a persistent problem once per activation instead of on every hook call: the
// returned function says true the first time it is given a key.
export function firstTimeSeen(): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  };
}
