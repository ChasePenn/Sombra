import type {SafetyLevel} from "@workspace/heat-safety/safety";
import type {SessionContext} from "@workspace/heat-safety/session";
export function createGeminiClient(): import("@google/genai").GoogleGenAI;
import type {Personalization} from "@workspace/heat-safety/templates";
export const personalizationSchema:object;
export function validatePersonalization(value:unknown,level:SafetyLevel,language?:"en"|"es"):Personalization|null;
export function personalize(input:{level:SafetyLevel;context:SessionContext;language:"en"|"es";mode?:string;symptoms?:string[];note?:string;pastAnswers?:unknown[]},options?:{client?:any;model?:string;timeoutMs?:number;onFailure?:(failure:{kind:string;status:number|null;code?:string})=>void}):Promise<Personalization & {level:SafetyLevel;source:"ai"|"template"}>;
