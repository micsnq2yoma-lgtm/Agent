export interface UpdateProgress {
  status?: string;
  updatedAt?: string;
}

const TERMINAL = new Set(["updated", "up_to_date", "rolled_back", "broken"]);

/** Ignore previous results and version checks while the detached updater starts. */
export function updateFinished(state: UpdateProgress, previousUpdatedAt?: string): boolean {
  return TERMINAL.has(state.status ?? "") && !!state.updatedAt && state.updatedAt !== previousUpdatedAt;
}
