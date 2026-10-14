export type CoolKind = 'water' | 'library' | 'community' | 'mall' | 'shade' | 'cooling' | 'hydration' | 'respite';
export type CoolPlace = {
  id: number; kind: CoolKind; name: string | null; lat: number; lon: number; distanceM: number;
  /** true open, false closed, null unknown. */
  open: boolean | null; official?: boolean; phone?: string | null;
  /** Minutes after midnight when it closes today, if known. */
  closesAt?: number | null;
};
export type CoolPick = { best: CoolPlace; hoursUnknown: boolean; others: CoolPlace[] } | null;
export function isIndoor(kind: CoolKind): boolean;
export function walkMinutes(meters: number): number;
export function pickCoolDown(places: CoolPlace[]): CoolPick;
