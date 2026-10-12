import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Droplet, Navigation, Phone, ShoppingBag, Building2, Umbrella, Stethoscope } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { NextStep, PageHead } from '../components/Story';
import { LocationPicker, useInitialPlace } from '../components/LocationPicker';
import { useSession } from '../lib/session';
import { fill } from '../lib/copy';
import { featureCopy } from '../lib/features-copy';
import { phoenixNow } from '../lib/time';
import { setLastPlace, type Place } from '../lib/local';
import { geoMessage, useLocate } from '../lib/location';
import { follow, metersBetween, permission, platform, roundedQuery, type Fix } from '../../public/js/geo.js';
import { isOpenNow } from '../../lib/opening-hours.js';
import type { MapKind } from '../components/SpotMap';

const SpotMap = lazy(() => import('../components/SpotMap'));

type Kind = MapKind;
type Spot = { id: number; kind: Kind; name: string | null; lat: number; lon: number; openingHours: string | null; distanceM: number };
type Filter = 'all' | 'water' | 'indoor' | 'shade';
type Loaded = { places: Spot[]; updated: string | null };

const kindIcon: Record<Kind, LucideIcon> = { water: Droplet, library: BookOpen, community: Building2, mall: ShoppingBag, shade: Umbrella };
const kindTone: Record<Kind, string> = { water: 'tone-blue', library: 'tone-orange', community: 'tone-green', mall: 'tone-brown', shade: 'tone-green' };
const kindColor: Record<Kind, string> = { water: '#2F86C9', library: '#FF6A2B', community: '#2FA36B', mall: '#3A1607', shade: '#2FA36B' };
const filterKinds: Record<Filter, Kind[]> = { all: ['water', 'library', 'community', 'mall', 'shade'], water: ['water'], indoor: ['library', 'community', 'mall'], shade: ['shade'] };

// The server only ever sees a point rounded to about 1 km; this is that cell.
const cellOf = (p: { lat: number; lon: number }) => `${Math.round(p.lat * 100) / 100},${Math.round(p.lon * 100) / 100}`;

const CACHE = 'sombra.spots-cache';
function readCache(cell: string): Loaded | null {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || '{}') as Record<string, Loaded & { at: number }>;
    const hit = all[cell];
    // Places barely change; a week-old list is still far better than none with no signal.
    return hit && Date.now() - hit.at < 7 * 86_400_000 ? hit : null;
  } catch { return null; }
}
function writeCache(cell: string, value: Loaded) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE) || '{}') as Record<string, Loaded & { at: number }>;
    all[cell] = { ...value, at: Date.now() };
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 12);
    localStorage.setItem(CACHE, JSON.stringify(Object.fromEntries(keep)));
  } catch { /* storage full or blocked: fine */ }
}

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

/** Walking directions when it's close, driving when it isn't; Apple Maps on iPhone. */
function directionsUrl(s: { lat: number; lon: number }, meters: number) {
  const walk = meters < 1600;
  if (platform() === 'ios') return `https://maps.apple.com/?daddr=${s.lat},${s.lon}&dirflg=${walk ? 'w' : 'd'}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=${walk ? 'walking' : 'driving'}`;
}

export default function CoolSpots() {
  const { lang, t } = useSession();
  const f = featureCopy[lang];
  const [place, setPlaceState] = useInitialPlace();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [offline, setOffline] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [filter, setFilter] = useState<Filter>('all');
  const [openOnly, setOpenOnly] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectTick, setSelectTick] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Live location.
  const [me, setMe] = useState<Fix | null>(null);
  const [following, setFollowing] = useState(false);
  const [live, setLive] = useState<'off' | 'on' | 'paused'>('off');
  const [liveProblem, setLiveProblem] = useState<string | null>(null);
  const finder = useLocate(lang);
  const stopRef = useRef<(() => void) | null>(null);
  const placeRef = useRef<Place | null>(place);
  placeRef.current = place;
  const mapBox = useRef<HTMLDivElement>(null);

  const setPlace = useCallback((next: Place) => { setPlaceState(next); setLastPlace(next); }, [setPlaceState]);

  // Load spots for the current place's 1 km cell (the same cell always gives the same answer).
  const cell = place ? cellOf(place) : null;
  useEffect(() => {
    if (!place || !cell) return;
    let alive = true;
    const cached = readCache(cell);
    // Show what we had right away; replace it when the fresh answer arrives.
    // Walking into a new area keeps the old list on screen (with live distances) until the new one arrives.
    if (cached) { setLoaded(cached); setState('done'); } else setState((s) => (s === 'done' ? 'done' : 'loading'));
    setOffline(false);
    const load = () => fetch(`/api/places/cool?${roundedQuery(place)}`, { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('places'))));
    // One quiet retry before showing an error: a busy moment usually passes in seconds.
    load()
      .catch(() => new Promise((wait) => setTimeout(wait, 2500)).then(load))
      .then((data: { places: Spot[]; updated?: string }) => {
        if (!alive) return;
        const value = { places: data.places, updated: data.updated ?? null };
        writeCache(cell, value);
        setLoaded(value);
        setState('done');
      })
      .catch(() => {
        if (!alive) return;
        if (cached) { setOffline(true); return; }
        // Still showing the last area's spots: say they may be out of date rather than hiding them.
        if (stateRef.current === 'done') setOffline(true);
        else setState('error');
      });
    return () => { alive = false; };
    // The cell, not every tiny move, decides when to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cell, attempt]);

  // --- Live location -------------------------------------------------------

  const followingRef = useRef(following);
  followingRef.current = following;
  const waitTimer = useRef<number | undefined>(undefined);

  const onFix = useCallback((fix: Fix) => {
    window.clearTimeout(waitTimer.current);
    setMe(fix);
    setLive('on');
    setLiveProblem(null);
    // Walked into a new 1 km cell while following: look up spots there. If the person
    // searched for somewhere else or is looking around the map, their choice stays.
    const current = placeRef.current;
    if (!current || (followingRef.current && cellOf(current) !== cellOf(fix))) setPlace({ lat: fix.lat, lon: fix.lon, name: f.myLocation });
  }, [f.myLocation, setPlace]);

  const stopLive = useCallback(() => { window.clearTimeout(waitTimer.current); stopRef.current?.(); stopRef.current = null; }, []);
  const startLive = useCallback(() => {
    stopLive();
    // Allowed, but nothing arrives (Location Services off for the whole phone, or no signal
    // indoors): say so instead of showing nothing. Following keeps trying in the background.
    waitTimer.current = window.setTimeout(() => setLiveProblem(geoMessage('unavailable', lang)), 20_000);
    stopRef.current = follow(onFix, (problem) => {
      // Phones lose GPS for a moment all the time (tunnels, buildings); the browser keeps
      // trying on its own, so only a revoked permission actually stops following.
      if (problem === 'timeout' || problem === 'unavailable') return;
      setLive('paused');
      setFollowing(false);
      setLiveProblem(geoMessage(problem, lang));
      stopLive();
    });
  }, [onFix, stopLive, lang]);

  // Follow again from the last known position, without waiting for the phone to move.
  const backToMe = useCallback(() => {
    setFollowing(true);
    followingRef.current = true;
    if (!me) return;
    const current = placeRef.current;
    if (!current || cellOf(current) !== cellOf(me)) setPlace({ lat: me.lat, lon: me.lon, name: f.myLocation });
  }, [me, setPlace, f.myLocation]);

  // The target button: find the person (with clear help if that fails), then follow them.
  const locateMe = useCallback(async () => {
    if (live === 'on' && me) { backToMe(); return; }
    setLiveProblem(null);
    const fix = await finder.run();
    if (!fix) return;
    setFollowing(true);
    followingRef.current = true; // onFix below runs before the next render
    if (fix.stale) {
      // An older position: show it, but don't claim to be following.
      setMe(fix);
      const current = placeRef.current;
      if (!current || cellOf(current) !== cellOf(fix)) setPlace({ lat: fix.lat, lon: fix.lon, name: f.myLocation });
      return;
    }
    onFix(fix);
    startLive();
  }, [finder, live, me, onFix, startLive, setPlace, f.myLocation, backToMe]);

  // If location is already allowed, show the dot straight away; never prompt on arrival.
  useEffect(() => {
    let alive = true;
    void permission().then((state) => {
      if (!alive || state !== 'granted') return;
      setFollowing(true);
      startLive();
    });
    return () => { alive = false; stopLive(); };
  }, [startLive, stopLive]);

  // Save battery: stop GPS while the app is in the background, pick up again on return.
  const resumeRef = useRef(false);
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden && stopRef.current) { stopLive(); resumeRef.current = true; }
      else if (!document.hidden && resumeRef.current) { resumeRef.current = false; startLive(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [startLive, stopLive]);

  // --- What to show --------------------------------------------------------

  // Distances from where the person really is (exact, on the phone) when we know it and it's
  // near the search point; otherwise from the place they picked.
  const origin = useMemo(() => {
    if (me && place && metersBetween(me, place) < 5000) return me;
    return place;
  }, [me, place]);

  const shown = useMemo(() => {
    const now = nowForHours();
    return (loaded?.places ?? [])
      .map((s) => ({ ...s, distanceM: origin ? Math.round(metersBetween(origin, s)) : s.distanceM, open: isOpenNow(s.openingHours, now) }))
      .filter((s) => filterKinds[filter].includes(s.kind))
      // Water fountains and shade shelters are always available; buildings must be known to be open.
      .filter((s) => !openOnly || s.open === true || ((s.kind === 'water' || s.kind === 'shade') && s.open !== false))
      .sort((a, b) => a.distanceM - b.distanceM);
  }, [loaded, filter, openOnly, origin]);

  const label = (s: Spot) => s.name ?? f[`kind_${s.kind}`];
  const detail = (s: Spot & { open: boolean | null }) => [
    s.name ? f[`kind_${s.kind}`] : null,
    fill(f.away, { d: distance(s.distanceM, lang) }),
    s.open === true ? f.openNow : s.open === false ? f.closedNow : null,
  ].filter(Boolean).join(' · ');

  const mapSpots = useMemo(() => shown.map((s) => ({
    id: s.id, lat: s.lat, lon: s.lon, kind: s.kind, color: kindColor[s.kind], label: label(s), detail: detail(s), directions: directionsUrl(s, s.distanceM),
  })),
  // Rebuild markers when the list or language changes, not on every distance tick.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [shown.map((s) => s.id).join(','), lang, Math.round((origin?.lat ?? 0) * 500), Math.round((origin?.lon ?? 0) * 500)]);

  const fromMap = useCallback((id: number) => {
    setSelected(id);
    // Looking at a spot: don't pull the map away from it on the next GPS update.
    setFollowing(false);
    document.getElementById(`spot-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);
  const fromList = (id: number) => {
    setSelected(id);
    setSelectTick((n) => n + 1);
    setFollowing(false);
    mapBox.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const updatedText = loaded?.updated
    ? fill(f.coolSourceDated, { date: new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${loaded.updated}T12:00:00Z`)) })
    : f.coolSource;

  return (
    <AppShell>
      <div className="page">
        <PageHead story="out" title={f.coolTitle} />
        <LocationPicker value={place} onChange={(p) => { setFollowing(false); setPlace(p); }} />

        <div className="chips spot-filters" role="group" aria-label={f.coolTitle}>
          {([['all', f.filterAll], ['water', f.filterWater], ['indoor', f.filterIndoor], ['shade', f.filterShade]] as [Filter, string][]).map(([value, text]) => (
            <button key={value} type="button" className="chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>{text}</button>
          ))}
          <button type="button" className="chip" aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>{f.openNowOnly}</button>
        </div>

        {/* The map shows as soon as there's a place, even before spots arrive or if they fail. */}
        {place && (
          <div ref={mapBox}>
            <Suspense fallback={<div className="spot-map" />}>
              <SpotMap
                center={place}
                me={me}
                following={following}
                spots={state === 'done' ? mapSpots : []}
                selected={selected}
                selectTick={selectTick}
                labels={{ attribution: f.mapAttribution, locate: f.mapLocate, you: f.mapYou, directions: f.directions, map: f.coolTitle }}
                onSelect={fromMap}
                onLocate={() => void locateMe()}
                onUserMove={() => setFollowing(false)}
              />
            </Suspense>
            <div className="map-status" aria-live="polite">
              {finder.state.kind === 'busy' && <span>{finder.state.text}</span>}
              {finder.state.kind === 'stale' && <span>{finder.state.text}</span>}
              {finder.state.kind !== 'busy' && live === 'on' && following && <span className="map-live">{f.mapLive}</span>}
              {live === 'on' && !following && me && (
                <button type="button" className="text-btn" onClick={backToMe}>{f.mapRecenter}</button>
              )}
              {live === 'paused' && !liveProblem && <span>{f.mapPaused}</span>}
            </div>
            {finder.state.kind === 'failed' && <p className="place-status place-problem" role="alert">{finder.state.text}</p>}
            {liveProblem && <p className="place-status place-problem" role="alert">{liveProblem}</p>}
          </div>
        )}

        {state === 'loading' && <p className="notice" role="status">{f.coolLoading}</p>}
        {state === 'error' && (
          <div className="error" role="alert">
            {f.coolFailed}
            <button type="button" className="btn btn-quiet" onClick={() => setAttempt((n) => n + 1)}>{t.retry}</button>
          </div>
        )}
        {offline && <p className="notice" role="status">{f.coolOffline}</p>}
        {state === 'done' && shown.length === 0 && <p className="notice">{f.coolEmpty}</p>}

        {state === 'done' && shown.length > 0 && (
          <ul className="spot-list">
            {shown.map((s) => {
              const Icon = kindIcon[s.kind];
              return (
                <li key={s.id} id={`spot-${s.id}`} className={`spot ${kindTone[s.kind]} ${selected === s.id ? 'is-focused' : ''}`}>
                  <button type="button" className="spot-main" onClick={() => fromList(s.id)} aria-label={`${label(s)}, ${fill(f.away, { d: distance(s.distanceM, lang) })}. ${f.showOnMap}`}>
                    <span className="mode-choice-icon"><Icon size={22} aria-hidden="true" /></span>
                    <span className="spot-copy">
                      <strong>{label(s)}</strong>
                      <small>{s.name ? `${f[`kind_${s.kind}`]} · ` : ''}{fill(f.away, { d: distance(s.distanceM, lang) })}</small>
                      {s.open === true && <small className="spot-open">{f.openNow}</small>}
                      {s.open === false && <small className="spot-closed">{f.closedNow}</small>}
                    </span>
                  </button>
                  <a className="icon-btn spot-go" aria-label={`${f.directions}: ${label(s)}`}
                    href={directionsUrl(s, s.distanceM)} target="_blank" rel="noreferrer">
                    <Navigation size={20} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        <NextStep href="/app/check-in" story="out" Icon={Stethoscope}>{f.nextCool}</NextStep>

        <aside className="relief-card">
          <p>{f.heatRelief}</p>
          <a href="tel:211" className="btn btn-secondary"><Phone size={18} aria-hidden="true" />{f.call211}</a>
        </aside>
        <p className="fine-print">{updatedText}</p>
      </div>
    </AppShell>
  );
}
