export type SafetyLevel = "OK" | "CAUTION" | "DANGER";
export const SYMPTOM_IDS: readonly string[];
export function evaluateSafety(input: { symptoms?: string[]; hoursWorked?: number; waterCups?: number; recommendedCups?: number | null }): SafetyLevel;
export function enforceSafetyFloor(ruleLevel: SafetyLevel, proposedLevel?: string): SafetyLevel;
