import type { HostPort } from "../../port";

// The user can turn Waymark's toasts off; every feature notifies through the host this returns.
export function withToastSetting(host: HostPort, enabled: () => boolean): HostPort {
  return {
    ...host,
    toast: (message, variant) => (enabled() ? host.toast(message, variant) : Promise.resolve()),
  };
}
