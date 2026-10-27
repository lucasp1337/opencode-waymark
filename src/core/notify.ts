import type { HostPort } from "./port";

// Toasts are best-effort: a host may have none, headless runs show nothing, and a lost toast must
// never fail a save.
export async function notify(
  host: Pick<HostPort, "capabilities" | "toast" | "log">,
  message: string,
): Promise<void> {
  if (!host.capabilities.toast) {
    return;
  }
  try {
    await host.toast(message, "info");
  } catch (error) {
    host.log("warn", "toast failed", { message, error: String(error) });
  }
}
