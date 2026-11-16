// Minimal Paperclip REST client for Agentself scripts (local_trusted board access).
export const API = process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100";

export async function api(method, path, body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 400)}`);
  return json;
}

export const list = (x) => (Array.isArray(x) ? x : (x?.items ?? x?.data ?? []));

export async function ensureCompany(name) {
  const companies = list(await api("GET", "/companies"));
  const live = companies.filter((c) => c.status !== "archived");
  // "Agentself" is the product's old name: an install from before the rename keeps its company
  return live.find((c) => c.name === name) ?? (name === "AgenTeam" ? live.find((c) => c.name === "Agentself") : null) ?? (await api("POST", "/companies", { name }));
}
