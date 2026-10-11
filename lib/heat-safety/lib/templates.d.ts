import type { SafetyLevel } from "./safety.js";
export type Personalization = { message: string; follow_up_question: string; actions: string[]; recheck_in_minutes: number };
export const templates: any;
export const firstAid: { sources: {name: string; url: string}[]; en: Record<"DANGER"|"CAUTION", {title: string; steps: string[]; reminder: string}>; es: Record<"DANGER"|"CAUTION", {title: string; steps: string[]; reminder: string}> };
export function fillTemplate(level: SafetyLevel, context: any, language?: string, mode?: string): Personalization;
