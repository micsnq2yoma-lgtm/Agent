import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** A moved AgenTeam checkout can leave its bundled plugin pointing at the old checkout.
 * Only recover this known local package, from an ancestor of this running server.
 * The loader still validates the manifest and all activation permissions before use.
 * Runs once during activation, with no directory scan or background polling.
 */
export function relocatedTeamLayerPath(
  plugin: { pluginKey: string; packageName: string; packagePath?: string | null },
  from = path.dirname(fileURLToPath(import.meta.url)),
): string | null {
  if (plugin.pluginKey !== "agenteam.team-layer" || !["@agenteam/team-layer", "@agentself/team-layer"].includes(plugin.packageName)) return null;
  if (!plugin.packagePath || existsSync(plugin.packagePath)) return null;
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    try {
      const app = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      if (app.name === "agenteam") {
        const candidate = path.join(dir, "plugins", "team-layer");
        const pkg = JSON.parse(readFileSync(path.join(candidate, "package.json"), "utf8"));
        return pkg.name === "@agenteam/team-layer" ? candidate : null;
      }
    } catch { /* Not the enclosing AgenTeam package, or no valid bundled plugin. */ }
    if (path.dirname(dir) === dir) return null;
  }
}
