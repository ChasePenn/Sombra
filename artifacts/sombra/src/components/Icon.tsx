import { Check, GraduationCap, HardHat, Settings, Sunrise, Users, type LucideIcon } from 'lucide-react';

// Icons are bundled with the app (no icon-font CDN), so they always render, even offline.
const icons: Record<string, LucideIcon> = {
  'hard-hat': HardHat,
  student: GraduationCap,
  'sun-horizon': Sunrise,
  gear: Settings,
  'users-three': Users,
  check: Check,
};

export function Icon({ name, size = 24, strokeWidth = 2.2 }: { name: string; size?: number; strokeWidth?: number }) {
  const Glyph = icons[name] ?? Sunrise;
  return <Glyph size={size} strokeWidth={strokeWidth} aria-hidden="true" />;
}
