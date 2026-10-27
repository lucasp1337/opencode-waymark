import type { HostPort } from "../port";
import type { SessionScopes } from "../scope/session-scopes";
import type { MemoryStore } from "../store/memory-store";

// Everything the memory tools need, injected by the runtime.
export interface ToolDeps {
  readonly host: Pick<HostPort, "capabilities" | "toast" | "log">;
  readonly store: MemoryStore;
  readonly scopes: SessionScopes;
}
