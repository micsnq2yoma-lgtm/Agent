// Skin context: every user-facing role word goes through `t()` (PLAN 7.2).
// P9: one skin for the whole app — the provider also sets Paperclip's CSS variables and feeds
// the skin's terms into the zh-CN translation layer. Light / dark follows Paperclip's theme.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cssVars, getSkin, paperclipVars, term, termOverrides, type Skin, type TermKey } from "@agentself/skins";
import { setTermOverrides } from "@/i18n/dom-translate";

interface SkinCtx {
  skin: Skin;
  t: (k: TermKey) => string;
  setSkinId: (id: string) => void;
  dark: boolean;
}

const Ctx = createContext<SkinCtx>({ skin: getSkin("office"), t: (k) => term(getSkin("office"), k), setSkinId: () => {}, dark: false });

function htmlIsDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function SkinProvider({ initial, children, onChange }: { initial: string; children: ReactNode; onChange?: (id: string) => void }) {
  const [id, setId] = useState(initial);
  useEffect(() => setId(initial), [initial]);
  const [dark, setDark] = useState(htmlIsDark);
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const mo = new MutationObserver(() => setDark(htmlIsDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  const skin = getSkin(id);
  useEffect(() => {
    const vars = { ...cssVars(skin, dark), ...paperclipVars(skin, dark) };
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    document.documentElement.dataset.skin = skin.id;
    document.documentElement.dataset.layoutSidebar = skin.layout.sidebar;
    document.documentElement.dataset.cardColumns = skin.layout.cardColumns;
    setTermOverrides(termOverrides(skin));
  }, [skin, dark]);
  const value = useMemo<SkinCtx>(
    () => ({
      skin,
      dark,
      t: (k) => term(skin, k),
      setSkinId: (next) => {
        setId(next);
        onChange?.(next);
      },
    }),
    [skin, dark, onChange],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSkin = () => useContext(Ctx);
