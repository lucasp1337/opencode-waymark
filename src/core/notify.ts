import type { HostPort } from "./port";

// Toasts are best-effort: headless runs have no TUI, and a lost toast must never fail a save.
export async function notify(
  host: Pick<HostPort, "toast" | "log">,
  message: string,
): Promise<void> {
  try {
    await host.toast(message, "info");
  } catch (error) {
    host.log("warn", "toast failed", { message, error: String(error) });
  }
}
