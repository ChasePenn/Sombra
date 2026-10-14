import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Droplet, Droplets, House, Navigation, Phone, ShoppingBag, Building2, Snowflake, Umbrella, Stethoscope } from 'lucide-react';
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
import { pickCoolDown, walkMinutes, type CoolPick } from '../../lib/cool-now.js';

const SpotMap = lazy(() => import('../components/SpotMap'));

type Kind = MapKind;
type Spot = { id: number; kind: Kind; name: string | null; lat: number; lon: number; openingHours: string | null; distanceM: number };
/** An official Heat Relief Network site (Maricopa Association of Governments). */
type Relief = {
  id: number; type: 'cooling' | 'hydration' | 'respite'; name: string; org: string | null; address: string | null; phone: string | null;
  lat: number; lon: number; start: string | null; end: string | null; hours: Array<[number, number] | null>; status: number;
  pets: boolean | null; accessible: boolean | null; distanceM: number;
};
type Season = { open: number; until: string | null; lastEnd: string | null };
type Filter = 'all' | 'official' | 'water' | 'indoor' | 'shade';
type Loaded = { places: Spot[]; updated: string | null; relief?: Relief[]; reliefSeason?: Season | null };
/** One row on the map and list, from either source. */
type Item = {
  id: number; kind: Kind; name: string | null; lat: number; lon: number; distanceM: number; open: boolean | null;
  official: boolean; phone: string | null; org: string | null; closesAt: number | null; note: string | null;
  accessible: boolean | null; pets: boolean | null;
};

const kindIcon: Record<Kind, LucideIcon> = { water: Droplet, library: BookOpen, community: Building2, mall: ShoppingBag, shade: Umbrella, cooling: Snowflake, hydration: Droplets, respite: House };
const kindTone: Record<Kind, string> = { water: 'tone-blue', library: 'tone-orange', community: 'tone-green', mall: 'tone-brown', shade: 'tone-green', cooling: 'tone-blue', hydration: 'tone-blue', respite: 'tone-green' };
const kindColor: Record<Kind, string> = { water: '#2F86C9', library: '#FF6A2B', community: '#2FA36B', mall: '#3A1607', shade: '#2FA36B', cooling: '#1F5FA8', hydration: '#1F5FA8', respite: '#23805A' };
const filterKinds: Record<Filter, Kind[]> = {
  all: ['water', 'library', 'community', 'mall', 'shade', 'cooling', 'hydration', 'respite'],
  official: ['cooling', 'hydration', 'respite'],
  water: ['water', 'hydration'],
  indoor: ['library', 'community', 'mall', 'cooling', 'respite'],
  shade: ['shade'],
};

/** Open right now by the site's published hours. Sites that open only during heat warnings are "unknown". */
function reliefOpen(r: Relief, now: { day: number; minutes: number }) {
  if (r.status === 4) return { open: null, closesAt: null };
  const today = r.hours[now.day];
  if (!today) return { open: false, closesAt: null };
  const open = now.minutes >= today[0] && now.minutes < today[1];
  return { open, closesAt: open ? today[1] : null };
}

const clockText = (minutes: number, lang: 'en' | 'es') => {
  const d = new Date(Date.UTC(2026, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60));
  return minutes >= 1440 ? (lang === 'es' ? 'medianoche' : 'midnight') : new Intl.DateTimeFormat(lang === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
};

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
  // Cool down now: off -> finding (location) -> waiting (spots for here) -> shown.
  const [coolNow, setCoolNow] = useState<'off' | 'finding' | 'waiting' | 'shown'>('off');
  const [pick, setPick] = useState<CoolPick>(null);
  const [pickFromPlace, setPickFromPlace] = useState(false);
  const coolBox = useRef<HTMLDivElement>(null);

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
      .then((data: { places: Spot[]; updated?: string | null; relief?: Relief[]; reliefSeason?: Season }) => {
        if (!alive) return;
        const value: Loaded = { places: data.places ?? [], updated: data.updated ?? null, relief: data.relief ?? [], reliefSeason: data.reliefSeason ?? null };
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

  // One tap: find the person, load spots around them, and point at the single best place.
  const startCoolNow = useCallback(async () => {
    setCoolNow('finding');
    setPick(null);
    let fix: Fix | null = me && Date.now() - me.at < 2 * 60_000 ? me : null;
    if (!fix) fix = await finder.run();
    if (fix) {
      setPickFromPlace(false);
      setMe(fix);
      setFollowing(true);
      followingRef.current = true;
      const current = placeRef.current;
      if (!current || cellOf(current) !== cellOf(fix)) setPlace({ lat: fix.lat, lon: fix.lon, name: f.myLocation });
      if (!fix.stale && !stopRef.current) startLive();
    } else if (placeRef.current) {
      // Location didn't work: use the place they picked, and say so.
      setPickFromPlace(true);
    } else {
      setCoolNow('off');
      return;
    }
    setCoolNow('waiting');
  }, [me, finder, setPlace, f.myLocation, startLive]);

  useEffect(() => {
    if (coolNow !== 'shown') return;
    coolBox.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const params = new URLSearchParams(window.location.search);
    if (params.has('now')) {
      params.delete('now');
      const rest = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
    }
  }, [coolNow]);

  // Arriving from "Cool down now" elsewhere (heat warning card, a caution check-in).
  useEffect(() => {
    // The link is cleaned up once the answer shows, so a page reload on the way (switching
    // to the person's mode) still ends in an answer.
    if (new URLSearchParams(window.location.search).get('now') !== '1') return;
    void startCoolNow();
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Everything near here, official sites first in line when two are the same place.
  const items = useMemo<Item[]>(() => {
    const now = nowForHours();
    const official: Item[] = (loaded?.relief ?? []).map((r) => ({
      id: -r.id, kind: r.type, name: r.name, lat: r.lat, lon: r.lon,
      distanceM: origin ? Math.round(metersBetween(origin, r)) : r.distanceM,
      ...reliefOpen(r, now),
      official: true, phone: r.phone, org: r.org, accessible: r.accessible, pets: r.pets,
      note: r.status === 4 ? f.reliefWarnOnly : r.status === 2 || r.status === 3 ? f.reliefHoursChange : null,
    }));
    const mapped: Item[] = (loaded?.places ?? [])
      // A library that's also an official cooling center shows once, as the official site.
      .filter((s) => !official.some((o) => metersBetween(o, s) < 80))
      .map((s) => ({
        id: s.id, kind: s.kind, name: s.name, lat: s.lat, lon: s.lon,
        distanceM: origin ? Math.round(metersBetween(origin, s)) : s.distanceM,
        open: isOpenNow(s.openingHours, now), closesAt: null,
        official: false, phone: null, org: null, note: null, accessible: null, pets: null,
      }));
    return [...official, ...mapped];
  }, [loaded, origin, f.reliefWarnOnly, f.reliefHoursChange]);

  const shown = useMemo(() => {
    return items
      .filter((s) => filterKinds[filter].includes(s.kind))
      // Water fountains and shade shelters are always available; buildings must be known to be open.
      .filter((s) => !openOnly || s.open === true || ((s.kind === 'water' || s.kind === 'shade') && s.open !== false))
      .sort((a, b) => a.distanceM - b.distanceM);
  }, [items, filter, openOnly]);

  // When the spots for here are in, choose.
  useEffect(() => {
    if (coolNow !== 'waiting' || !place || state === 'loading') return;
    if (state === 'done' && loaded && (pickFromPlace || !me || cellOf(me) === cellOf(place))) {
      setPick(pickCoolDown(items));
      setCoolNow('shown');
    } else if (state === 'error') {
      setPick(null);
      setCoolNow('shown');
    }
  }, [coolNow, state, loaded, items, place, me, pickFromPlace]);

  const label = (s: Item) => s.name ?? f[`kind_${s.kind}`];
  const openText = (s: Item) => s.open === true
    ? (s.closesAt != null ? fill(f.openUntil, { time: clockText(s.closesAt, lang) }) : f.openNow)
    : s.open === false ? f.closedNow : null;
  const detail = (s: Item) => [
    s.name ? f[`kind_${s.kind}`] : null,
    fill(f.away, { d: distance(s.distanceM, lang) }),
    openText(s),
  ].filter(Boolean).join(' · ');

  const mapSpots = useMemo(() => shown.map((s) => ({
    id: s.id, lat: s.lat, lon: s.lon, kind: s.kind, color: kindColor[s.kind], label: label(s), detail: detail(s), directions: directionsUrl(s, s.distanceM),
    official: s.official, phone: s.phone,
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

  const season = loaded?.reliefSeason ?? null;
  const longDate = (d: string) => new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const seasonText = season?.open
    ? (season.until ? fill(f.heatReliefUntil, { date: longDate(season.until) }) : f.heatRelief)
    : season?.lastEnd ? fill(f.heatReliefEnded, { date: longDate(season.lastEnd) }) : f.heatReliefGeneric;

  const updatedText = loaded?.updated
    ? fill(f.coolSourceDated, { date: new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${loaded.updated}T12:00:00Z`)) })
    : f.coolSource;

  return (
    <AppShell>
      <div className="page">
        <PageHead story="out" title={f.coolTitle} />

        <div ref={coolBox} className="cool-now">
          {coolNow !== 'shown' && (
            <button type="button" className="btn cool-now-btn btn-block" onClick={() => void startCoolNow()} disabled={coolNow === 'finding' || coolNow === 'waiting'} aria-busy={coolNow === 'finding' || coolNow === 'waiting'}>
              <Snowflake size={24} aria-hidden="true" />
              <span><strong>{coolNow === 'off' ? f.coolNow : f.coolNowFinding}</strong>{coolNow === 'off' && <small>{f.coolNowHint}</small>}</span>
            </button>
          )}
          {coolNow === 'shown' && (
            <section className="cool-now-card" aria-labelledby="cool-now-title" aria-live="polite">
              <div className="cool-now-head">
                <h2 id="cool-now-title">{f.coolNowTitle}</h2>
                <button type="button" className="text-btn" onClick={() => setCoolNow('off')}>{f.coolNowClose}</button>
              </div>
              {pick ? (
                <>
                  <p className="cool-now-name">{label(pick.best as Item)}</p>
                  <p className="cool-now-meta">
                    {[pick.best.name ? f[`kind_${pick.best.kind}`] : null, fill(f.coolNowWalk, { min: walkMinutes(pick.best.distanceM) }), openText(pick.best as Item)].filter(Boolean).join(' · ')}
                  </p>
                  {pick.hoursUnknown && <p className="cool-now-note">{f.coolNowHoursUnknown}</p>}
                  {(pick.best as Item).note && <p className="cool-now-note">{(pick.best as Item).note}</p>}
                  <div className="cool-now-actions">
                    <a className="btn btn-primary" href={directionsUrl(pick.best, pick.best.distanceM)} target="_blank" rel="noreferrer"><Navigation size={20} aria-hidden="true" />{f.coolNowGo}</a>
                    {pick.best.phone && <a className="btn btn-secondary" href={`tel:${pick.best.phone.replace(/[^\d+]/g, '')}`}><Phone size={20} aria-hidden="true" />{f.careCall}</a>}
                  </div>
                  {pick.others.length > 0 && (
                    <>
                      <h3 className="cool-now-sub">{f.coolNowOthers}</h3>
                      <ul className="cool-now-others">
                        {pick.others.map((o) => (
                          <li key={o.id}>
                            <a href={directionsUrl(o, o.distanceM)} target="_blank" rel="noreferrer">
                              <span><strong>{label(o as Item)}</strong><small>{[o.name ? f[`kind_${o.kind}`] : null, fill(f.coolNowWalk, { min: walkMinutes(o.distanceM) })].filter(Boolean).join(' · ')}</small></span>
                              <Navigation size={18} aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {pickFromPlace && place && <p className="cool-now-note">{fill(f.coolNowFrom, { place: place.name })}</p>}
                </>
              ) : (
                <p className="cool-now-name cool-now-none">{f.coolNowNone}</p>
              )}
              <p className="cool-now-warn"><a href="tel:911">{f.coolNowWarn}</a></p>
            </section>
          )}
          {coolNow !== 'shown' && finder.state.kind === 'failed' && !place && <p className="place-status place-problem" role="alert">{finder.state.text}</p>}
        </div>

        <LocationPicker value={place} onChange={(p) => { setFollowing(false); setPlace(p); }} />

        <div className="chips spot-filters" role="group" aria-label={f.coolTitle}>
          {([['all', f.filterAll], ...(items.some((i) => i.official) ? [['official', f.filterOfficial]] : []), ['water', f.filterWater], ['indoor', f.filterIndoor], ['shade', f.filterShade]] as [Filter, string][]).map(([value, text]) => (
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
                labels={{ attribution: f.mapAttribution, locate: f.mapLocate, you: f.mapYou, directions: f.directions, call: f.careCall, map: f.coolTitle }}
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
                <li key={s.id} id={`spot-${s.id}`} className={`spot ${kindTone[s.kind]} ${s.official ? 'is-official' : ''} ${selected === s.id ? 'is-focused' : ''}`}>
                  <button type="button" className="spot-main" onClick={() => fromList(s.id)} aria-label={`${label(s)}, ${fill(f.away, { d: distance(s.distanceM, lang) })}. ${f.showOnMap}`}>
                    <span className="mode-choice-icon"><Icon size={22} aria-hidden="true" /></span>
                    <span className="spot-copy">
                      <strong>{label(s)}</strong>
                      <small>{s.name ? `${f[`kind_${s.kind}`]} · ` : ''}{fill(f.away, { d: distance(s.distanceM, lang) })}</small>
                      {s.open === true && <small className="spot-open">{openText(s)}</small>}
                      {s.open === false && <small className="spot-closed">{f.closedNow}</small>}
                      {s.note && <small className="spot-note">{s.note}</small>}
                      {s.official && (s.accessible || s.pets) && (
                        <small className="spot-extra">{[s.accessible ? f.accessibleShort : null, s.pets ? f.petsOk : null].filter(Boolean).join(' · ')}</small>
                      )}
                    </span>
                  </button>
                  {/* Calling is on the map card and in Cool down now; one button keeps the row readable. */}
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
          {/* What the official network says about its own season, not a guess from the calendar. */}
          <p>{seasonText}</p>
          <a href="tel:211" className="btn btn-secondary"><Phone size={18} aria-hidden="true" />{f.call211}</a>
        </aside>
        <p className="fine-print">{updatedText}{items.some((i) => i.official) ? ` ${f.reliefSource}` : ''}</p>
      </div>
    </AppShell>
  );
}
