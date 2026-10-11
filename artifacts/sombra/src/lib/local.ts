/**
 * Device-only settings. Health details and the people someone checks on stay on
 * this phone: they are never sent to the server or synced to an account.
 */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('sombra:local', { detail: key }));
    return true;
  } catch {
    return false;
  }
}

/* Group features (crew / team / group) are off until someone turns them on. */
const GROUP = 'sombra.group-enabled';
export const isGroupEnabled = () => read<boolean>(GROUP, false);
export const setGroupEnabled = (on: boolean) => write(GROUP, on);

/* The last place someone planned for, so tools can start there. */
export type Place = { lat: number; lon: number; name: string };
const PLACE = 'sombra.last-place';
export const getLastPlace = () => read<Place | null>(PLACE, null);
export const setLastPlace = (place: Place) => write(PLACE, place);

/* Personal heat risk profile. */
export type RiskFactor =
  | 'age65' | 'child' | 'pregnant' | 'heart' | 'diabetes' | 'kidney'
  | 'meds_bp' | 'meds_allergy' | 'meds_mental' | 'past_illness';
export const RISK_FACTORS: RiskFactor[] = [
  'age65', 'child', 'pregnant', 'heart', 'diabetes', 'kidney', 'meds_bp', 'meds_allergy', 'meds_mental', 'past_illness',
];
const RISK = 'sombra.risk-profile';
export const getRiskFactors = () => read<RiskFactor[]>(RISK, []).filter((f) => RISK_FACTORS.includes(f));
export const setRiskFactors = (factors: RiskFactor[]) => write(RISK, factors);

/* People someone checks on during hot days. */
export type CareContact = {
  id: string;
  name: string;
  phone: string;
  time: string; // HH:MM, daily reminder
  lastChecked: string | null; // ISO
};
const CARE = 'sombra.care-contacts';
export const getCareContacts = () => read<CareContact[]>(CARE, []);
export const saveCareContacts = (contacts: CareContact[]) => write(CARE, contacts);
