// A test store has no logger, so a cache update that fails must fail the test.
export function rethrowCacheFailure(_operation: string, error: unknown): never {
  throw error;
}
