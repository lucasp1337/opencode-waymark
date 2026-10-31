import { afterAll } from "bun:test";
import { removeOwnSandboxes } from "./harness";

// Preloaded by the live test scripts: a global afterAll runs once, after the last test file.
// bun test does not fire process exit handlers registered from test files.
afterAll(removeOwnSandboxes);
