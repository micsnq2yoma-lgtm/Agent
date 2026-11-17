// A version check is not an update transition: polling must not mistake it for completion.
export function mergeUpdateState(current, patch, now = new Date().toISOString()) {
  return {
    ...current,
    ...patch,
    ...(patch.lastCheck !== undefined ? { checkedAt: now } : {}),
    ...(patch.status !== undefined ? { updatedAt: now } : {}),
  };
}
