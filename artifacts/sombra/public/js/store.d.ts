import type { WorkerSession, SessionContext } from "@workspace/heat-safety/session";
import type { Personalization } from "@workspace/heat-safety/templates";
import type { SafetyLevel } from "@workspace/heat-safety/safety";
export type { WorkerSession };
export type CheckinDetails = {
  note?: string; language?: "en"|"es"; mode?:string; context?: SessionContext;
  response?: Personalization & {level:SafetyLevel;source:"ai"|"template"};
  recheckAt?: string; pendingSync?: boolean;
};
export type SombraProfile = {
  name: string;
  language: "en" | "es";
  mode: string;
  usualIntensity: "easy" | "moderate" | "hard";
  newToHeat: boolean;
  notificationsEnabled: boolean;
};
export function getModePreference(): string;
export function setModePreference(mode: string): void;

export type CrewMember = {
  id?: string;
  name: string;
  intensity: "easy" | "moderate" | "hard";
  newToHeat: boolean;
};

export type SavedShift = {
  id?: string;
  date: string;
  location: string;
  planJson: Record<string, unknown>;
  createdAt?: string;
};

export type Checkin = {
  id?: string;
  workerName: string;
  time: string;
  level: string;
  symptomsJson: string[];
  detailsJson?: CheckinDetails;
  createdAt?: string;
};

export function setAccountSession(userId: string | null | undefined): void;
export function getProfile(): Promise<SombraProfile | null>;
export function saveProfile(profile: SombraProfile): Promise<SombraProfile>;
export function getCrew(): Promise<CrewMember[]>;
export function saveCrew(crew: CrewMember[]): Promise<CrewMember[]>;
export function getShifts(): Promise<SavedShift[]>;
export function saveShift(shift: SavedShift): Promise<SavedShift>;
export function getCheckins(): Promise<Checkin[]>;
export function saveCheckin(checkin: Checkin): Promise<Checkin>;
export function getSessions(): Promise<WorkerSession[]>;
export function saveSession(session: WorkerSession): Promise<WorkerSession>;
export function syncActivity(): Promise<void>;
export function hasPendingActivity(): boolean;
export function getLocalSnapshot(): {
  profile: SombraProfile | null;
  crew: CrewMember[];
  shifts: SavedShift[];
  checkins: Checkin[];
  sessions: WorkerSession[];
};
export function hasLocalData(snapshot?: ReturnType<typeof getLocalSnapshot>): boolean;
export function hasImportedGuestData(userId: string | undefined): boolean;
export function skipGuestImport(userId: string | undefined): void;
export function isSignInPromptDismissed(): boolean;
export function dismissSignInPrompt(): void;
export function isWelcomeDismissed(): boolean;
export function dismissWelcome(): void;
export function importGuestData(
  snapshot?: ReturnType<typeof getLocalSnapshot>,
  userId?: string,
): Promise<{ imported: boolean; reason: string | null }>;
export function clearLocalData(): void;
export function deleteAccount(): Promise<void>;
