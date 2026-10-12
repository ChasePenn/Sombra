import { useCallback, useRef, useState } from 'react';
import { GeoError, locate, platform, type Fix, type GeoProblem } from '../../public/js/geo.js';
import { featureCopy } from './features-copy';
import { fill, type Lang } from './copy';

/** What to tell someone when their location couldn't be found, with how to fix it. */
export function geoMessage(problem: GeoProblem, lang: Lang) {
  const f = featureCopy[lang];
  switch (problem) {
    case 'denied': return f[`geoDenied_${platform()}`];
    case 'timeout': return f.geoTimeout;
    case 'unsupported': return f.geoUnsupported;
    case 'insecure': return f.geoInsecure;
    default: return f.geoUnavailable;
  }
}

export type LocateState =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'stale'; text: string }
  | { kind: 'failed'; problem: GeoProblem; text: string };

/** "Use my location" with progress and plain-language failures. */
export function useLocate(lang: Lang) {
  const [state, setState] = useState<LocateState>({ kind: 'idle' });
  const busy = useRef(false);
  const run = useCallback(async (): Promise<Fix | null> => {
    if (busy.current) return null;
    busy.current = true;
    const f = featureCopy[lang];
    setState({ kind: 'busy', text: f.locating });
    try {
      const fix = await locate({ onRetry: () => setState({ kind: 'busy', text: f.geoRetrying }) });
      if (fix.stale) setState({ kind: 'stale', text: fill(f.geoStale, { mins: Math.max(1, Math.round((Date.now() - fix.at) / 60000)) }) });
      else setState({ kind: 'idle' });
      return fix;
    } catch (error) {
      const problem: GeoProblem = error instanceof GeoError ? error.problem : 'unavailable';
      setState({ kind: 'failed', problem, text: geoMessage(problem, lang) });
      return null;
    } finally {
      busy.current = false;
    }
  }, [lang]);
  return { state, run, clear: () => setState({ kind: 'idle' }) };
}
