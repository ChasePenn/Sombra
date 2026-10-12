import { useEffect, useState } from 'react';
import { roundedQuery } from '../../public/js/geo.js';
import { Link } from 'wouter';
import { TriangleAlert } from 'lucide-react';
import { getLastPlace } from '../lib/local';

type Alert = { event: string; kind: string };

// One lookup per place every 10 minutes, shared by every screen.
const seen = new Map<string, { at: number; alert: Alert | null }>();

/**
 * While the National Weather Service has a heat warning for your place, every screen
 * shows it, so each tool reads as part of the same day. Nothing shows otherwise.
 */
export function HeatBanner() {
  const [alert, setAlert] = useState<Alert | null>(() => {
    const place = getLastPlace();
    return place ? seen.get(`${place.lat},${place.lon}`)?.alert ?? null : null;
  });

  useEffect(() => {
    let live = true;
    const load = () => {
      const place = getLastPlace();
      if (!place) { setAlert(null); return; }
      const key = `${place.lat},${place.lon}`;
      const hit = seen.get(key);
      if (hit && Date.now() - hit.at < 600_000) { setAlert(hit.alert); return; }
      fetch(`/api/conditions?${roundedQuery(place)}`, { headers: { Accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { alerts: Alert[] | null } | null) => {
          if (!d) return;
          const heat = d.alerts?.find((a) => a.kind === 'heat') ?? null;
          seen.set(key, { at: Date.now(), alert: heat });
          if (live) setAlert(heat);
        })
        .catch(() => undefined);
    };
    load();
    const onLocal = (e: Event) => { if ((e as CustomEvent).detail === 'sombra.last-place') load(); };
    window.addEventListener('sombra:local', onLocal);
    return () => { live = false; window.removeEventListener('sombra:local', onLocal); };
  }, []);

  if (!alert) return null;
  return (
    <Link href="/app" className="heat-banner" role="status">
      <TriangleAlert size={18} aria-hidden="true" />
      <span>{alert.event}</span>
    </Link>
  );
}
