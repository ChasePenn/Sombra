import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapKind = 'water' | 'library' | 'community' | 'mall' | 'shade' | 'cooling' | 'hydration' | 'respite';
export type MapSpot = { id: number; lat: number; lon: number; label: string; detail: string; kind: MapKind; color: string; directions: string; official?: boolean; phone?: string | null };
type Point = { lat: number; lon: number };
export type Me = Point & { accuracy: number };

// Icon shapes (Lucide, ISC license), drawn white inside each colored pin.
const GLYPH: Record<MapKind, string> = {
  water: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  library: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  community: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  mall: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  shade: '<path d="M22 12a10 10 0 0 0-20 0Z"/><path d="M12 12v8a2 2 0 0 0 4 0"/><path d="M12 2v1"/>',
  cooling: '<path d="M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1"/><path d="m9 3 3 3 3-3M9 21l3-3 3 3M3 9l3 3-3 3M21 9l-3 3 3 3"/>',
  hydration: '<path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z"/><path d="M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"/>',
  respite: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .7-1.5l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
};
const CROSSHAIR = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';

// OpenStreetMap's own tiles first; if they won't load, a second free map style.
const TILES = [
  { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', extra: '' },
  { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', extra: ' · © CARTO' },
];

// Place names come from OpenStreetMap, which anyone can edit, so they're always escaped.
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function pinIcon(spot: MapSpot, selected: boolean) {
  return L.divIcon({
    className: '',
    // Official sites are rounded squares, so they stand out by shape and not only by color.
    html: `<span class="map-pin${spot.official ? ' is-official' : ''}${selected ? ' is-selected' : ''}" style="--pin:${spot.color}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[spot.kind]}</svg></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -16],
  });
}

function popupHtml(spot: MapSpot, labels: { directions: string; call: string }) {
  const tel = spot.phone ? spot.phone.replace(/[^\d+]/g, '') : '';
  const call = tel ? `<a href="tel:${escape(tel)}">${escape(labels.call)}</a>` : '';
  return `<div class="map-pop"><strong>${escape(spot.label)}</strong><span>${escape(spot.detail)}</span><div class="map-pop-actions"><a href="${escape(spot.directions)}" target="_blank" rel="noreferrer">${escape(labels.directions)}</a>${call}</div></div>`;
}

/**
 * The cool spots map. Created once and updated in place, so following someone as they
 * walk never rebuilds it.
 */
export default function SpotMap({ center, me, following, spots, selected, selectTick = 0, labels, onSelect, onLocate, onUserMove }: {
  center: Point;
  me: Me | null;
  following: boolean;
  spots: MapSpot[];
  selected: number | null;
  selectTick?: number;
  labels: { attribution: string; locate: string; you: string; directions: string; call: string; map: string };
  onSelect: (id: number) => void;
  onLocate: () => void;
  onUserMove: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const spotLayer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<number, L.Marker>());
  const meDot = useRef<L.CircleMarker | null>(null);
  const meRing = useRef<L.Circle | null>(null);
  const locateBtn = useRef<HTMLButtonElement | null>(null);
  // Latest callbacks, so map events always call the current ones.
  const handlers = useRef({ onSelect, onLocate, onUserMove });
  handlers.current = { onSelect, onLocate, onUserMove };
  const followRef = useRef(following);
  followRef.current = following;

  // Create the map once.
  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lon], 14);
    L.control.zoom({ position: 'topright' }).addTo(m);
    m.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

    let which = 0;
    let loaded = 0;
    let failed = 0;
    const addTiles = () => {
      const t = TILES[which];
      const layer = L.tileLayer(t.url, { maxZoom: 19, attribution: labels.attribution + t.extra, subdomains: 'abcd', detectRetina: false });
      layer.on('tileload', () => { loaded++; });
      layer.on('tileerror', () => {
        failed++;
        if (which === 0 && loaded === 0 && failed >= 4) {
          which = 1;
          m.removeLayer(layer);
          addTiles();
        }
      });
      layer.addTo(m);
    };
    addTiles();

    spotLayer.current = L.layerGroup().addTo(m);

    // "Show where I am" button, bottom right, like every phone map.
    const Locate = L.Control.extend({
      onAdd() {
        const btn = L.DomUtil.create('button', 'map-locate') as HTMLButtonElement;
        btn.type = 'button';
        btn.innerHTML = CROSSHAIR;
        btn.setAttribute('aria-label', labels.locate);
        btn.title = labels.locate;
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, 'click', (e) => { L.DomEvent.preventDefault(e); handlers.current.onLocate(); });
        locateBtn.current = btn;
        return btn;
      },
    });
    new Locate({ position: 'bottomright' }).addTo(m);

    // Dragging the map means "let me look around": stop following until asked again.
    m.on('dragstart', () => { if (followRef.current) handlers.current.onUserMove(); });

    map.current = m;
    // The map's box may not have its final size on the first frame.
    const sizeFix = window.setTimeout(() => m.invalidateSize(), 150);
    const onResize = () => m.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(sizeFix);
      window.removeEventListener('resize', onResize);
      m.remove();
      map.current = null;
      markers.current.clear();
      meDot.current = null;
      meRing.current = null;
    };
    // Built once; later changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new search point (picked a different place): go there, unless we're following the person.
  useEffect(() => {
    if (map.current && !followRef.current) map.current.setView([center.lat, center.lon], Math.max(map.current.getZoom(), 14));
  }, [center.lat, center.lon]);

  // Spots.
  useEffect(() => {
    const m = map.current;
    const layer = spotLayer.current;
    if (!m || !layer) return;
    layer.clearLayers();
    markers.current.clear();
    spots.forEach((s) => {
      const marker = L.marker([s.lat, s.lon], { icon: pinIcon(s, false), keyboard: true, title: s.label, alt: s.label, riseOnHover: true })
        .bindPopup(popupHtml(s, labels), { closeButton: true, autoPanPadding: [24, 24] })
        .addTo(layer);
      marker.on('click', () => handlers.current.onSelect(s.id));
      markers.current.set(s.id, marker);
    });
    if (!followRef.current && spots.length) {
      const points: L.LatLngExpression[] = spots.slice(0, 8).map((s) => [s.lat, s.lon]);
      points.push(me ? [me.lat, me.lon] : [center.lat, center.lon]);
      m.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
    }
    // Refit only when the spots change, not when the person moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, labels.directions]);

  // Selected spot: highlight it and open its card.
  useEffect(() => {
    markers.current.forEach((marker, id) => {
      const spot = spots.find((s) => s.id === id);
      if (spot) marker.setIcon(pinIcon(spot, id === selected));
    });
    if (selected == null) return;
    const marker = markers.current.get(selected);
    if (!marker || !map.current) return;
    marker.setZIndexOffset(1000);
    marker.openPopup();
  }, [selected, selectTick, spots]);

  // The person's own position: a blue dot with a ring showing how sure the phone is.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!me) {
      meDot.current?.remove(); meDot.current = null;
      meRing.current?.remove(); meRing.current = null;
      return;
    }
    const at: L.LatLngExpression = [me.lat, me.lon];
    const radius = Math.min(Math.max(me.accuracy || 0, 5), 2000);
    if (!meRing.current) meRing.current = L.circle(at, { radius, color: '#2F86C9', weight: 1, fillColor: '#2F86C9', fillOpacity: 0.12, interactive: false }).addTo(m);
    else meRing.current.setLatLng(at).setRadius(radius);
    if (!meDot.current) {
      meDot.current = L.circleMarker(at, { radius: 8, color: '#fff', weight: 3, fillColor: '#2F86C9', fillOpacity: 1, className: 'map-me' }).bindTooltip(labels.you).addTo(m);
    } else meDot.current.setLatLng(at);
    if (following) m.panTo(at, { animate: true });
  }, [me?.lat, me?.lon, me?.accuracy, following, labels.you]);

  // When following starts, jump to the person.
  useEffect(() => {
    locateBtn.current?.setAttribute('aria-pressed', String(following));
    locateBtn.current?.classList.toggle('is-on', following);
    if (following && me && map.current) map.current.setView([me.lat, me.lon], Math.max(map.current.getZoom(), 15));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following]);

  return <div ref={box} className="spot-map" role="region" aria-label={labels.map} />;
}
