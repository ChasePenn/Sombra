import { useEffect, useRef, useState } from 'react';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { useSession } from '../lib/session';
import { featureCopy } from '../lib/features-copy';
import { fill } from '../lib/copy';
import { getLastPlace, setLastPlace, type Place } from '../lib/local';
import { useLocate } from '../lib/location';

type Result = { name: string; admin1?: string | null; latitude: number; longitude: number };

/** "My location" is saved in whichever language was on at the time; show it in today's. */
const isMyLocation = (name: string) => name === featureCopy.en.myLocation || name === featureCopy.es.myLocation;

/** Shows the current place with a "Change" button; search or GPS when changing. */
export function LocationPicker({ value, onChange }: { value: Place | null; onChange: (place: Place) => void }) {
  const { lang } = useSession();
  const f = featureCopy[lang];
  const [editing, setEditing] = useState(!value);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState('');
  const timer = useRef<number | undefined>(undefined);

  // No place: ask for one. A place arriving from elsewhere (live location on the map) closes the search.
  const hadValue = useRef(Boolean(value));
  useEffect(() => {
    if (!value) setEditing(true);
    else if (!hadValue.current) setEditing(false);
    hadValue.current = Boolean(value);
  }, [value]);

  useEffect(() => {
    window.clearTimeout(timer.current);
    const q = query.trim();
    if (q.length < 2) { setResults([]); return; }
    timer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/weather/geocode?name=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('search');
        const data = (await res.json()) as Result[];
        setResults(Array.isArray(data) ? data : []);
        setStatus(Array.isArray(data) && data.length ? '' : f.noResults);
      } catch {
        setStatus(f.searchFailed);
      }
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [query, f.noResults, f.searchFailed]);

  const choose = (place: Place) => {
    setLastPlace(place);
    onChange(place);
    setEditing(false);
    setQuery('');
    setResults([]);
    setStatus('');
  };

  const finder = useLocate(lang);
  const locate = async () => {
    setStatus('');
    const fix = await finder.run();
    if (fix) choose({ lat: fix.lat, lon: fix.lon, name: f.myLocation });
  };

  if (!editing && value) {
    return (
      <>
        <div className="place-row">
          <span className="place-icon" aria-hidden="true"><MapPin size={18} /></span>
          <span className="place-name">{isMyLocation(value.name) ? f.nearYou : fill(f.near, { place: value.name })}</span>
          <button type="button" className="btn-quiet place-change" onClick={() => setEditing(true)}>{f.change}</button>
        </div>
        {finder.state.kind === 'stale' && <p className="place-status" role="status">{finder.state.text}</p>}
        {!isInArizona(value.lat, value.lon) && <p className="arizona-note" role="note">{f.outsideArizona}</p>}
      </>
    );
  }

  return (
    <div className="place-edit">
      <label className="vh" htmlFor="place-search">{f.searchPlace}</label>
      <div className="place-search">
        <Search size={18} aria-hidden="true" />
        <input id="place-search" className="input" type="search" placeholder={f.searchPlace} value={query}
          onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </div>
      {results.length > 0 && (
        <ul className="place-results">
          {results.map((r) => (
            <li key={`${r.latitude},${r.longitude}`}>
              <button type="button" onClick={() => choose({ lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1].filter(Boolean).join(', ') })}>
                {r.name}{r.admin1 ? <small>{r.admin1}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-secondary btn-block" onClick={locate} disabled={finder.state.kind === 'busy'} aria-busy={finder.state.kind === 'busy'}>
        <LocateFixed size={18} aria-hidden="true" />{f.useMyLocation}
      </button>
      {finder.state.kind === 'busy' && <p className="place-status" role="status">{finder.state.text}</p>}
      {finder.state.kind === 'failed' && <p className="place-status place-problem" role="alert">{finder.state.text}</p>}
      {status && <p className="place-status" role="status">{status}</p>}
    </div>
  );
}

/** The last planned place, if any. */
export function useInitialPlace() {
  return useState<Place | null>(() => getLastPlace());
}

/** Hours are Arizona time (no daylight saving); outside Arizona that may not match local time. */
export function isInArizona(lat: number, lon: number) {
  return lat >= 31.3 && lat <= 37.0 && lon >= -114.9 && lon <= -109.0;
}
