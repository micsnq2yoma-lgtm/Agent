// Skin context: every user-facing role word goes through `t()` (PLAN 7.2).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { cssVars, getSkin, term, type Skin, type TermKey } from "@agentself/skins";

interface SkinCtx {
  skin: Skin;
  t: (k: TermKey) => string;
  setSkinId: (id: string) => void;
  dark: boolean;
}

const Ctx = createContext<SkinCtx>({ skin: getSkin("office"), t: (k) => term(getSkin("office"), k), setSkinId: () => {}, dark: false });

export function SkinProvider({ initial, children, onChange }: { initial: string; children: ReactNode; onChange?: (id: string) => void }) {
  const [id, setId] = useState(initial);
  useEffect(() => setId(initial), [initial]);
  const [dark, setDark] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const fn = () => setDark(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  const skin = getSkin(id);
  useEffect(() => {
    const vars = cssVars(skin, dark);
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    document.documentElement.dataset.skin = skin.id;
    document.documentElement.dataset.layoutSidebar = skin.layout.sidebar;
    document.documentElement.dataset.cardColumns = skin.layout.cardColumns;
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
