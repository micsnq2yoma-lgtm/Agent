import * as esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";
const p = createPluginBundlerPresets({ manifestEntry: "src/manifest.ts", workerEntry: "src/worker.ts", outdir: "dist" });
await esbuild.build({ ...p.esbuild.manifest });
// Bundle workspace code (@agenteam/shared) into the worker; keep the SDK external.
await esbuild.build({ ...p.esbuild.worker, external: ["@paperclipai/plugin-sdk", "@paperclipai/shared"] });
console.log("built");
