import { useEffect, useState } from 'react';
import { BookOpen, Droplet, Navigation, Phone, ShoppingBag, Building2, Umbrella } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { LocationPicker, useInitialPlace } from '../components/LocationPicker';
import { useSession } from '../lib/session';
import { fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';

type Spot = { id: number; kind: 'water' | 'library' | 'community' | 'mall' | 'shade'; name: string | null; lat: number; lon: number; openingHours: string | null; distanceM: number };

const kindIcon: Record<Spot['kind'], LucideIcon> = { water: Droplet, library: BookOpen, community: Building2, mall: ShoppingBag, shade: Umbrella };
const kindTone: Record<Spot['kind'], string> = { water: 'tone-blue', library: 'tone-orange', community: 'tone-green', mall: 'tone-brown', shade: 'tone-green' };

function distance(m: number, lang: 'en' | 'es') {
  // People in Arizona think in miles; Spanish speakers here usually do too.
  const miles = m / 1609.34;
  if (miles < 0.1) return lang === 'es' ? `${Math.round(m * 3.281)} pies` : `${Math.round(m * 3.281)} ft`;
  return `${miles.toLocaleString(lang, { maximumFractionDigits: 1 })} mi`;
}

export default function CoolSpots() {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const [place, setPlace] = useInitialPlace();
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');

  useEffect(() => {
    if (!place) return;
    let live = true;
    setState('loading');
    fetch(`/api/places/cool?lat=${place.lat}&lon=${place.lon}`, { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('places'))))
      .then((data: { places: Spot[] }) => { if (live) { setSpots(data.places); setState('done'); } })
      .catch(() => live && setState('error'));
    return () => { live = false; };
  }, [place]);

  return (
    <AppShell>
      <div className="page">
        <header className="page-head">
          <h1>{f.coolTitle}</h1>
          <p>{f.coolSub}</p>
        </header>
        <LocationPicker value={place} onChange={setPlace} />

        <aside className="relief-card">
          <p>{f.heatRelief}</p>
          <a href="tel:211" className="btn btn-secondary"><Phone size={18} aria-hidden="true" />{f.call211}</a>
        </aside>

        {state === 'loading' && <p className="notice" role="status">{f.coolLoading}</p>}
        {state === 'error' && <p className="error" role="alert">{f.coolFailed}</p>}
        {state === 'done' && spots && spots.length === 0 && <p className="notice">{f.coolEmpty}</p>}
        {state === 'done' && spots && spots.length > 0 && (
          <ul className="spot-list">
            {spots.map((s) => {
              const Icon = kindIcon[s.kind];
              return (
                <li key={s.id} className={`spot ${kindTone[s.kind]}`}>
                  <span className="mode-choice-icon"><Icon size={22} aria-hidden="true" /></span>
                  <span className="spot-copy">
                    <strong>{s.name ?? f[`kind_${s.kind}`]}</strong>
                    <small>{s.name ? `${f[`kind_${s.kind}`]} · ` : ''}{fill(f.away, { d: distance(s.distanceM, lang) })}</small>
                    {s.openingHours && <small className="spot-hours">{s.openingHours}</small>}
                  </span>
                  <a className="icon-btn spot-go" aria-label={`${f.directions}: ${s.name ?? f[`kind_${s.kind}`]}`}
                    href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`} target="_blank" rel="noreferrer">
                    <Navigation size={20} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <p className="fine-print">{f.coolSource}</p>
      </div>
    </AppShell>
  );
}
