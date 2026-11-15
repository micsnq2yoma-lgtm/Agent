// Line icons (DESIGN §4.1): teams and leads use the pack's `icon` key, mapped to lucide.
// Pixel robots are only for employees (§5).
import { Code, Globe, Heart, Mail, Microscope, Rocket, Sparkles, Target, type LucideIcon } from "lucide-react";

export const PACK_ICONS: Record<string, LucideIcon> = {
  microscope: Microscope,
  rocket: Rocket,
  heart: Heart,
  code: Code,
  globe: Globe,
  mail: Mail,
  sparkles: Sparkles,
  target: Target,
};
export const PACK_ICON_KEYS = Object.keys(PACK_ICONS);

export function PackIcon({ name, size = 18 }: { name?: string | null; size?: number }) {
  const I = (name && PACK_ICONS[name]) || Sparkles;
  return <I size={size} strokeWidth={1.8} aria-hidden="true" />;
}
