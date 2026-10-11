import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapSpot = { id: number; lat: number; lon: number; label: string; color: string };

/** Small map of cool spots around a center point, using OpenStreetMap tiles. */
export default function SpotMap({ center, spots, attribution, onSelect }: {
  center: { lat: number; lon: number };
  spots: MapSpot[];
  attribution: string;
  onSelect?: (id: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!box.current || map.current) return;
    map.current = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lon], 14);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, [center.lat, center.lon, attribution]);

  useEffect(() => {
    if (!map.current || !layer.current) return;
    layer.current.clearLayers();
    L.circleMarker([center.lat, center.lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#3A1607', fillOpacity: 1 }).addTo(layer.current);
    const points: L.LatLngExpression[] = [[center.lat, center.lon]];
    spots.forEach((s) => {
      const marker = L.circleMarker([s.lat, s.lon], { radius: 10, color: '#fff', weight: 3, fillColor: s.color, fillOpacity: 1 })
        .bindTooltip(s.label)
        .addTo(layer.current!);
      if (onSelect) marker.on('click', () => onSelect(s.id));
      points.push([s.lat, s.lon]);
    });
    if (points.length > 1) map.current.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 });
  }, [spots, center.lat, center.lon, onSelect]);

  return <div ref={box} className="spot-map" role="region" aria-label="Map" />;
}
