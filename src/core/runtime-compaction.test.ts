import { describe, expect, test } from "bun:test";
import { SESSION, useRuntime } from "../../test/runtime-fixture";

const runtime = useRuntime();
const withoutHook = useRuntime({
  capabilities: {
    systemInjection: true,
    toolOutputMutation: true,
    compactionHook: false,
    toast: true,
  },
});

describe("compaction", () => {
  test("a compaction asks the summary to list what is not yet saved", async () => {
    const fx = runtime();

    const [note = ""] = await fx.host.emitCompaction(SESSION);

    expect(note).toContain('"Not yet saved to memory"');
    expect(note).toContain("memory_save");
  });

  test("with compaction save turned off, a compaction gets no note", async () => {
    const fx = runtime();
    await fx.host.callTool("memory_config", { compactionSave: false }, SESSION);

    expect(await fx.host.emitCompaction(SESSION)).toEqual([]);
  });

  test("a subagent session's compaction gets no note", async () => {
    const fx = runtime();
    fx.host.sessions.set("ses_sub", { id: "ses_sub", directory: "/work/api", parentID: SESSION });

    expect(await fx.host.emitCompaction("ses_sub")).toEqual([]);
  });

  test("a host without the compaction hook gets no compaction handler", async () => {
    const fx = withoutHook();

    expect(await fx.host.emitCompaction(SESSION)).toEqual([]);
  });
});
