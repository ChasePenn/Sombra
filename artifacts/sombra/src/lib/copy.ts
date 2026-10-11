import type workers from '../../config/modes/workers.json';
import { resolveAudienceMode } from '../../lib/modes.js';

export type Lang = 'en' | 'es';
export type Intensity = 'easy' | 'moderate' | 'hard';
type Copy = typeof workers.locales.en.app;
type AboutCopy = typeof workers.locales.en.about;
export type CheckInCopy = typeof workers.locales.en.checkIn;
export type AudienceModeId = string;
type Mode = {
  id: string;
  icon: string;
  rules?: { categoryIncrease?: number; stopAtExtreme?: boolean; planKind?: string; coolerAdviceCategory?: number };
  welcomeQuestions?: Record<Lang, string>;
  taglines: Record<Lang, string>;
  locales: Record<Lang, {
    app: Copy;
    about: AboutCopy;
    mode: { name: string; shortName: string; description: string; group: string; member: string; leader: string; welcomeQuestion?: string };
    taskIntensities: { value: Intensity; label: string; forecastLabel: string; example: string }[];
    ui: Record<string, string>;
    surface: Record<string, string>;
    shade: Record<string, string>;
    checkIn: CheckInCopy;
  }>;
};
const modules = import.meta.glob<Mode>('../../config/modes/*.json', { eager: true, import: 'default' });
const configuredModes = Object.values(modules).filter((entry) => entry.id && entry.id !== 'workers');
const configuredModeIds = new Set(configuredModes.map((entry) => entry.id));
let savedMode = 'work';
try {
  const stored = window.localStorage.getItem('sombra.mode');
  const normalizedStored = stored === 'workers' ? 'work' : stored;
  if (normalizedStored && /^[a-z][a-z0-9-]*$/.test(normalizedStored) && configuredModeIds.has(normalizedStored)) savedMode = normalizedStored;
} catch { /* The work mode remains available if local preferences cannot be read. */ }
const requestedMode = new URLSearchParams(window.location.search).get('mode') || savedMode;
const normalizedMode = requestedMode === 'workers' ? 'work' : requestedMode;
export const audienceModeId: AudienceModeId = configuredModeIds.has(normalizedMode) ? normalizedMode : 'work';
export const modeQuery = audienceModeId === 'work' ? '' : `?mode=${encodeURIComponent(audienceModeId)}`;
const mode = resolveAudienceMode(
  Object.fromEntries(Object.entries(modules).map(([key, value]) => [key.replace('../../', '../'), value])),
  audienceModeId,
);

export const intensities = (lang: Lang) => mode.locales[lang].taskIntensities;
export const intensityLabel = (lang: Lang, v: Intensity) => intensities(lang).find((i) => i.value === v)?.label ?? v;
export const modeUi = (lang: Lang) => mode.locales[lang].ui;
export const modeRules = () => mode.rules ?? {};
export const currentMode = (lang: Lang) => ({
  ...mode.locales[lang].mode,
  welcomeQuestion: mode.welcomeQuestions?.[lang],
});
export const availableModes = (lang: Lang) =>
  configuredModes.map(({ id }) => {
    const entry = resolveAudienceMode(
      Object.fromEntries(Object.entries(modules).map(([key, value]) => [key.replace('../../', '../'), value])),
      id,
    );
    return { id, icon: entry.icon, ...entry.locales[lang].mode, welcomeQuestion: entry.welcomeQuestions?.[lang] };
  });
export const navigateToMode = (id: AudienceModeId) => {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', id);
  window.location.assign(url.toString());
};
export const checkInQuestions = (lang: Lang) => mode.locales[lang].checkIn.questions;
export const checkInCopy = (lang: Lang): CheckInCopy => mode.locales[lang].checkIn;
export const siteLabel = (lang:Lang,value:string) => value.split(',').map((key)=> {
  const id = key.trim();
  return mode.locales[lang].surface[id] || mode.locales[lang].shade[id] || checkInCopy(lang).siteUnknown;
}).join(', ');
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

export const copy: Record<Lang, Copy> = {
  en: { ...mode.locales.en.app, tagline: mode.taglines.en },
  es: { ...mode.locales.es.app, tagline: mode.taglines.es },
};
export const aboutCopy = { en: mode.locales.en.about, es: mode.locales.es.about };
