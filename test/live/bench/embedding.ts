// Runs the embedding bench inside an opencode server process and prints each stage's result.
// Usage: bun test/live/bench/embedding.ts
import { createLiveEnv, probeLines, waitUntil } from "../harness";

const DOWNLOAD_TIMEOUT_MS = 600_000;

const env = createLiveEnv();
env.installPlugin("waymark-bench", "test/live/bench/embedding-plugin.ts");
const server = await env.serve();
try {
  await server.newSession();
  await waitUntil(() => probeLines(env, "bench.done").length > 0, DOWNLOAD_TIMEOUT_MS);
  for (const line of probeLines(env, "bench.stage")) {
    console.log(JSON.stringify(line));
  }
} finally {
  await server.stop();
}
