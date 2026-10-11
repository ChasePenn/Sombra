import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, Droplet, Navigation, Phone, ShoppingBag, Building2, Umbrella } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { LocationPicker, useInitialPlace } from '../components/LocationPicker';
import { Segmented } from '../components/Controls';
import { useSession } from '../lib/session';
import { fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';
import { phoenixNow } from '../lib/time';
import { isOpenNow } from '../../lib/opening-hours.js';

const SpotMap = lazy(() => import('../components/SpotMap'));

type Kind = 'water' | 'library' | 'community' | 'mall' | 'shade';
type Spot = { id: number; kind: Kind; name: string | null; lat: number; lon: number; openingHours: string | null; distanceM: number };
type Filter = 'all' | 'water' | 'indoor' | 'shade';

const kindIcon: Record<Kind, LucideIcon> = { water: Droplet, library: BookOpen, community: Building2, mall: ShoppingBag, shade: Umbrella };
const kindTone: Record<Kind, string> = { water: 'tone-blue', library: 'tone-orange', community: 'tone-green', mall: 'tone-brown', shade: 'tone-green' };
const kindColor: Record<Kind, string> = { water: '#2F86C9', library: '#FF6A2B', community: '#2FA36B', mall: '#3A1607', shade: '#2FA36B' };
const filterKinds: Record<Filter, Kind[]> = { all: ['water', 'library', 'community', 'mall', 'shade'], water: ['water'], indoor: ['library', 'community', 'mall'], shade: ['shade'] };

function distance(m: number, lang: 'en' | 'es') {
  const miles = m / 1609.34;
  if (miles < 0.1) return lang === 'es' ? `${Math.round(m * 3.281)} pies` : `${Math.round(m * 3.281)} ft`;
  return `${miles.toLocaleString(lang, { maximumFractionDigits: 1 })} mi`;
}

function nowForHours() {
  const now = phoenixNow();
  const day = new Date(`${now.slice(0, 10)}T12:00:00Z`).getUTCDay();
  return { day, minutes: Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16)) };
}

export default function CoolSpots() {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const [place, setPlace] = useInitialPlace();
  const [spots, setSpots] = useState<Spot[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [filter, setFilter] = useState<Filter>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [focused, setFocused] = useState<number | null>(null);

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

  const shown = useMemo(() => {
    const now = nowForHours();
    return (spots ?? [])
      .map((s) => ({ ...s, open: isOpenNow(s.openingHours, now) }))
      .filter((s) => filterKinds[filter].includes(s.kind))
      // Water fountains and shade shelters are always available; buildings must be known to be open.
      .filter((s) => !openOnly || s.open === true || ((s.kind === 'water' || s.kind === 'shade') && s.open !== false));
  }, [spots, filter, openOnly]);

  const label = (s: Spot) => s.name ?? f[`kind_${s.kind}`];
  const select = useCallback((id: number) => {
    setFocused(id);
    document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

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

        <div className="spot-controls">
          <Segmented<'list' | 'map'> label={f.coolTitle} value={view} onChange={setView} options={[{ value: 'list', label: f.viewList }, { value: 'map', label: f.viewMap }]} />
          <div className="chips" role="group" aria-label={f.coolTitle}>
            {([['all', f.filterAll], ['water', f.filterWater], ['indoor', f.filterIndoor], ['shade', f.filterShade]] as [Filter, string][]).map(([value, text]) => (
              <button key={value} type="button" className="chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>{text}</button>
            ))}
            <button type="button" className="chip" aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>{f.openNowOnly}</button>
          </div>
        </div>

        {state === 'loading' && <p className="notice" role="status">{f.coolLoading}</p>}
        {state === 'error' && <p className="error" role="alert">{f.coolFailed}</p>}
        {state === 'done' && shown.length === 0 && <p className="notice">{f.coolEmpty}</p>}

        {state === 'done' && place && view === 'map' && shown.length > 0 && (
          <Suspense fallback={<div className="spot-map" />}>
            <SpotMap center={place} attribution={f.mapAttribution} onSelect={select}
              spots={shown.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, label: label(s), color: kindColor[s.kind] }))} />
          </Suspense>
        )}

        {state === 'done' && shown.length > 0 && (
          <ul className="spot-list">
            {shown.map((s) => {
              const Icon = kindIcon[s.kind];
              return (
                <li key={s.id} id={`spot-${s.id}`} className={`spot ${kindTone[s.kind]} ${focused === s.id ? 'is-focused' : ''}`}>
                  <span className="mode-choice-icon"><Icon size={22} aria-hidden="true" /></span>
                  <span className="spot-copy">
                    <strong>{label(s)}</strong>
                    <small>{s.name ? `${f[`kind_${s.kind}`]} · ` : ''}{fill(f.away, { d: distance(s.distanceM, lang) })}</small>
                    {s.open === true && <small className="spot-open">{f.openNow}</small>}
                    {s.open === false && <small className="spot-closed">{f.closedNow}</small>}
                  </span>
                  <a className="icon-btn spot-go" aria-label={`${f.directions}: ${label(s)}`}
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
