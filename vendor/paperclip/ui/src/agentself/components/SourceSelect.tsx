// Model source picker: Claude subscription / Codex subscription / an API model (settings → 模型与订阅).
import type { CSSProperties } from "react";
import { sourceOptions, useModels } from "../lib/models";

export function SourceSelect({ value, onChange, lead = false, label = "模型来源", style }: { value: string; onChange: (v: string) => void; lead?: boolean; label?: string; style?: CSSProperties }) {
  const m = useModels();
  const opts = sourceOptions(m, { lead });
  const known = opts.some((o) => o.value === value);
  return (
    <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      {!known && <option value={value}>{value}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled && o.value !== value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
