import type { Logger } from "../logger";

export type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

// A Waymark bug must never reach the host, and one failing handler must not starve the others.
export async function attempt<T>(
  logger: Logger,
  hook: string,
  run: () => Promise<T> | T,
): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    logger.log("error", "hook failed", { hook, error: String(error) });
    return { ok: false };
  }
}

export async function collect<A extends unknown[]>(
  logger: Logger,
  hook: string,
  fns: ReadonlyArray<(...args: A) => Promise<string | null>>,
  ...args: A
): Promise<string[]> {
  const texts: string[] = [];
  for (const fn of fns) {
    const result = await attempt(logger, hook, () => fn(...args));
    if (result.ok && result.value !== null) {
      texts.push(result.value);
    }
  }
  return texts;
}

export async function each<A extends unknown[]>(
  logger: Logger,
  hook: string,
  fns: ReadonlyArray<(...args: A) => Promise<void> | void>,
  ...args: A
): Promise<void> {
  for (const fn of fns) {
    await attempt(logger, hook, () => fn(...args));
  }
}
