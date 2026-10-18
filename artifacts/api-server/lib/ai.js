import { GoogleGenAI } from "@google/genai";
import { fillTemplate, firstAid, templates } from "@workspace/heat-safety/templates";

export function createGeminiClient() {
  return new GoogleGenAI({apiKey:process.env.GEMINI_API_KEY});
}

export const personalizationSchema = {
  type: "object", additionalProperties: false,
  properties: {
    message: { type: "string" }, follow_up_question: { type: "string" },
    actions: { type: "array", items: { type: "string" } },
    recheck_in_minutes: { type: "integer" },
  },
  required: ["message", "follow_up_question", "actions", "recheck_in_minutes"],
};
export function validatePersonalization(value, level, language = "en") {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((key) => !personalizationSchema.required.includes(key)) ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 800 ||
      typeof value.follow_up_question !== "string" || value.follow_up_question.length > 200 ||
      !Array.isArray(value.actions) || value.actions.length > 10 ||
      value.actions.some((a) => typeof a !== "string" || !a.trim() || a.length > 140) ||
      !Number.isFinite(value.recheck_in_minutes)) return null;
  const sentences = [...new Intl.Segmenter(language, {granularity:"sentence"}).segment(value.message.trim())].filter((s) => s.segment.trim());
  if (sentences.length < 2 || sentences.length > 3) return null;
  if (value.follow_up_question.trim() && (value.follow_up_question.match(/\?/g) || []).length !== 1) return null;
  const text = [value.message,value.follow_up_question,...value.actions].join(" ");
  // Throw out replies that reassure, diagnose, or contradict the safety rules.
  if (/\b(no risk|completely safe|safe to work|you (?:have|are suffering from) heat ?(?:stroke|exhaustion)|sin riesgo|totalmente segur[oa]|tienes (?:un )?golpe de calor)\b/i.test(text)) return null;
  if (level === "CAUTION" && /\b(keep working|continue work(?:ing)?|do not stop|don't stop|ignore (?:your |the )?symptoms|do not seek|no need (?:for|to)|sigue trabajando|contin[uú]a trabajando|no pares|ignora (?:los |tus )?s[ií]ntomas|no necesitas ayuda)\b/i.test(text)) return null;
  return {
    message:value.message.trim(),follow_up_question:value.follow_up_question.trim(),
    actions:value.actions.slice(0,3).map((a) => a.trim()),
    recheck_in_minutes:Math.max(15,Math.min(level === "CAUTION" ? 30 : 60,Math.round(value.recheck_in_minutes))),
  };
}
export async function personalize(input, options = {}) {
  const {level,context,language,mode="workers",symptoms=[],note="",pastAnswers=[]} = input;
  const fallback = {level,...fillTemplate(level,context,language,mode),source:"template"};
  // Emergencies never reach the model: no client, no key, no request.
  if (level === "DANGER") return fallback;
  const model = options.model ?? process.env.GEMINI_MODEL;
  if (!model || (!options.client && !process.env.GEMINI_API_KEY)) {
    options.onFailure?.({kind:"configuration",status:null});
    return fallback;
  }
  const locale = templates[language];
  const riskWord = (category) => Number.isInteger(category) && category >= 0 && category <= 5 ? locale.riskWords[category] : locale.unavailable;
  const modelContext = {
    first_name:context.firstName,hours_worked:Number(context.hoursWorked.toFixed(1)),
    water_cups_logged:context.waterCups,water_cups_recommended_so_far:context.recommendedCups === null ? null : Number(context.recommendedCups.toFixed(1)),
    heat_risk_now:riskWord(context.currentCategory),heat_risk_next_hour:riskWord(context.nextCategory),
    site_type:context.siteType,symptoms,past_answers_today:pastAnswers,note,language,
    fixed_safety_level:level,fixed_first_aid:level === "CAUTION" ? firstAid[language].CAUTION : null,
  };
  const client = options.client ?? createGeminiClient();
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_,reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("Personalization timed out")); }, Math.min(5000,options.timeoutMs ?? 5000));
    });
    const response = await Promise.race([
      client.models.generateContent({
        model,contents:JSON.stringify(modelContext),
        config:{
          systemInstruction: `${templates.systemInstruction} Write 2–3 sentences in message, one follow-up question or an empty string, at most 3 short actions, and a recheck time between 15 and 60 minutes (at most 30 for CAUTION). Do not invent quantities or missing weather readings. Write plainly, like a coworker talking: no lists of three in a sentence and no em dashes.`,
          responseMimeType:"application/json",responseJsonSchema:personalizationSchema,
          abortSignal:controller.signal,httpOptions:{timeout:5000},maxOutputTokens:1024,
        },
      }), timeout,
    ]);
    const parsed = validatePersonalization(JSON.parse(response.text ?? ""),level,language);
    if (!parsed) options.onFailure?.({kind:"validation",status:null});
    return parsed ? {level,...parsed,source:"ai"} : fallback;
  } catch (error) {
    // Never log the error, note, prompt, key or reply.
    const codes = [
      ["API_KEY_BLOCKED", /API_KEY_(?:LEAKED|BLOCKED)|API key.*(?:leak|revoke|block)/i],
      ["API_KEY_EXPIRED", /API_KEY_EXPIRED|API key.*expired/i],
      ["API_KEY_INVALID", /API_KEY_INVALID|API key.*(?:invalid|not valid|not found)|invalid api key/i],
      ["MODEL_UNAVAILABLE", /model.*(?:not found|not supported|not available)/i],
      ["SCHEMA_UNSUPPORTED", /(?:response.?json.?schema|response.?schema).*(?:not supported|invalid)/i],
      ["QUOTA_EXCEEDED", /RESOURCE_EXHAUSTED|quota exceeded/i],
    ];
    const code = codes.find(([,pattern])=>pattern.test(String(error?.message ?? "")))?.[0] ?? "PROVIDER_REQUEST_REJECTED";
    options.onFailure?.({kind:controller.signal.aborted ? "timeout" : "provider",status:Number.isInteger(error?.status) ? error.status : null,code});
    return fallback;
  } finally { clearTimeout(timer); }
}
