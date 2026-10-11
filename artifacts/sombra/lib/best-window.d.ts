export interface BestWindow {
  date: string;
  start: string;
  end: string;
  category: number;
  label: string;
  peakWbgtF: number;
  totalHeat: number;
  work: number | 'NL';
  restMinutes: number;
  waterQt: number;
  stopWork: boolean;
}

export function findBestWindows(input: {
  hours: { date: string; time: string; wbgtF: number }[];
  durationHours: number;
  intensity: 'easy' | 'moderate' | 'hard';
  newToHeat: boolean;
  categoryIncrease?: 0 | 1;
  table: unknown;
  now: string;
}): {
  best: BestWindow | null;
  alternatives: BestWindow[];
  avoid: { date: string; start: string; end: string }[];
};
