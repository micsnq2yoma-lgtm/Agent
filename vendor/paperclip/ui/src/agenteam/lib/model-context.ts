// Pure model metadata helpers: also tested by the root suite without installing the Paperclip UI.
interface ModelContextInfo {
  providers: Array<{ id: string; model?: string; smallModel?: string; contextLengths?: Record<string, number> }>;
}

/** Context length for the selected API model, or the provider default when no override is set. */
export function contextLengthOf(m: ModelContextInfo | null, source: string | undefined, model?: string): number | null {
  if (!source?.startsWith("api:")) return null;
  const provider = m?.providers.find((x) => x.id === source.slice(4));
  const selected = model?.trim() || provider?.model || provider?.smallModel;
  const length = selected ? provider?.contextLengths?.[selected] : undefined;
  return typeof length === "number" && Number.isSafeInteger(length) && length > 0 ? length : null;
}

export const contextLengthText = (length: number | null | undefined): string =>
  typeof length === "number" && Number.isSafeInteger(length) && length > 0 ? `上下文 ${length.toLocaleString("zh-CN")} token` : "上下文未提供";
