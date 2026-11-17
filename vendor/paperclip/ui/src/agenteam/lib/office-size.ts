/** Integer scaling keeps the canvas sharp. Large teams scroll at a readable 2x. */
export function fitOfficeScale(world: { width: number; height: number }, available: { width: number; height: number }): number {
  return Math.max(2, Math.min(4, Math.floor(available.width / world.width), Math.floor(available.height / world.height)));
}
