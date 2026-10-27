import type { MemoryId } from "../model/id";
import type { HostPort } from "../port";
import type { SessionScopes } from "../scope/session-scopes";
import type { MemoryStore } from "../store/memory-store";
import type { Retriever } from "./recall/retriever";
import type { BudgetCaps } from "./save/budget";

// Everything the memory tools need, injected by the runtime.
export interface ToolDeps {
  readonly host: Pick<HostPort, "capabilities" | "toast" | "log">;
  readonly store: MemoryStore;
  readonly scopes: SessionScopes;
  readonly now: () => Date;
  readonly newId: () => MemoryId;
  // Read per save, so a changed setting applies without a restart.
  readonly caps: () => BudgetCaps;
  readonly retriever: Retriever;
}
