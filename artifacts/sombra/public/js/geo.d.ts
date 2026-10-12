export type Fix = { lat: number; lon: number; accuracy: number; at: number; stale?: boolean };
export type GeoProblem = 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'insecure';
export class GeoError extends Error {
  constructor(problem: GeoProblem);
  problem: GeoProblem;
}
export function lastFix(maxAgeMs?: number, now?: number): Fix | null;
export function locate(options?: { onRetry?: () => void; quickMs?: number; preciseMs?: number; graceMs?: number }): Promise<Fix>;
export function follow(onFix: (fix: Fix) => void, onProblem?: (problem: GeoProblem) => void): () => void;
export function permission(): Promise<PermissionState | 'unknown'>;
export function platform(userAgent?: string): 'ios' | 'android' | 'desktop';
export function metersBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number;
export function roundedQuery(point: { lat: number; lon: number }): string;
