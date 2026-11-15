// Agentself (P8): reverse-proxy /agentself/api/* to the Agentself local service
// (apps/console/server, front desk / Feishu / office snapshot / settings / memory / wizard).
// Mounted before the JSON body parser so request bodies stream through untouched.
// The local service listens on loopback only; the browser only ever talks to this server.
import http from "node:http";
import type { Request, Response, NextFunction } from "express";

export function agentselfLocalServiceUrl(): URL {
  return new URL(process.env.AGENTSELF_LOCAL_URL ?? "http://127.0.0.1:3200");
}

export function agentselfProxy() {
  return (req: Request, res: Response, _next: NextFunction) => {
    const base = agentselfLocalServiceUrl();
    // req.url is relative to the mount point ("/context?x=1"); forward the full public path.
    const target = new URL(`/agentself/api${req.url === "/" ? "" : req.url}`, base);
    const headers = { ...req.headers, host: base.host };
    delete headers.cookie;
    delete headers.authorization;
    const upstream = http.request(target, { method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.setTimeout(10 * 60_000);
    upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
    upstream.on("error", (e) => {
      if (res.headersSent) return res.end();
      res.status(502).json({ error: `Agentself 本地服务不可用：${e.message}` });
    });
    req.pipe(upstream);
  };
}
