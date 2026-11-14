import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.AGENTSELF_CONSOLE_SERVER ?? "http://127.0.0.1:3200";
export default defineConfig({
  plugins: [react()],
  server: { port: 5273, proxy: { "/api": target, "/agentself": target } },
  build: { outDir: "dist", emptyOutDir: true },
});
