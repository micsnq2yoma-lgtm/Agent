import * as esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";
const p = createPluginBundlerPresets({ manifestEntry: "src/manifest.ts", workerEntry: "src/worker.ts", uiEntry: "src/ui.tsx", outdir: "dist" });
console.log(JSON.stringify(Object.fromEntries(Object.entries(p.esbuild).map(([k,v])=>[k,{entry:v.entryPoints,out:v.outdir,external:v.external}]))));
for (const k of Object.keys(p.esbuild)) await esbuild.build({ ...p.esbuild[k], jsx: "automatic" });
