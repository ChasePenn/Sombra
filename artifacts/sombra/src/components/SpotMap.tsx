import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { glyphSvg, type GlyphName } from '../lib/glyphs';

export type MapKind = 'water' | 'library' | 'community' | 'mall' | 'shade' | 'cooling' | 'hydration' | 'respite';
export type MapSpot = { id: number; lat: number; lon: number; label: string; detail: string; kind: MapKind; color: string; directions: string; official?: boolean; phone?: string | null };
type Point = { lat: number; lon: number };
export type Me = Point & { accuracy: number };

// Icon shapes (Lucide, ISC license), drawn white inside each colored pin.
const GLYPH: Record<MapKind, GlyphName> = {
  water: 'drop', library: 'book', community: 'building', mall: 'bag',
  shade: 'umbrella', cooling: 'snowflake', hydration: 'drops', respite: 'house',
};
const CROSSHAIR = glyphSvg('locate', { size: 22 });

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
    html: `<span class="map-pin${spot.official ? ' is-official' : ''}${selected ? ' is-selected' : ''}" style="--pin:${spot.color}">${glyphSvg(GLYPH[spot.kind], { size: 20, stroke: '#fff', width: 2.2 })}</span>`,
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
    if (!meRing.current) meRing.current = L.circle(at, { radius, color: '#1D5F8F', weight: 1, fillColor: '#1D5F8F', fillOpacity: 0.12, interactive: false }).addTo(m);
    else meRing.current.setLatLng(at).setRadius(radius);
    if (!meDot.current) {
      meDot.current = L.circleMarker(at, { radius: 8, color: '#fff', weight: 3, fillColor: '#1D5F8F', fillOpacity: 1, className: 'map-me' }).bindTooltip(labels.you).addTo(m);
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
