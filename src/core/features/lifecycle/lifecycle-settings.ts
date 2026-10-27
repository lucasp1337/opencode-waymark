// A fact or decision leaves the index when it was neither read in `sessions` in-scope sessions nor
// within `days` days.
export interface IndexExitThresholds {
  readonly sessions: number;
  readonly days: number;
}

// A gotcha that fired `fires` times within `days` days is worth asking the user about.
export interface NoisyThresholds {
  readonly fires: number;
  readonly days: number;
}

export interface Lifecycle {
  readonly indexExit: IndexExitThresholds;
  readonly noisy: NoisyThresholds;
}

export const DEFAULT_LIFECYCLE: Lifecycle = {
  indexExit: { sessions: 20, days: 30 },
  noisy: { fires: 10, days: 30 },
};
