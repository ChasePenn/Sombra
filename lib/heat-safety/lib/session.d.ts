export type PlanHour = { at: number; time: string; wbgtF: number; category: number; workMinutes: number; restMinutes: number; waterCups: number };
export type WorkerSession = { id?: string; activityAvailable?:boolean; workerName: string; date: string; startedAt: string|null; endedAt: string|null; breaks: {start:string;end:string|null}[]; waterLogs: {time:string;cups:number}[]; planHours: PlanHour[]; siteType: string; remindersShown: string[] };
export type SessionContext = {activityAvailable?:boolean;workerName:string;firstName:string;hoursWorked:number;waterCups:number;recommendedCups:number|null;breaksTaken:number;currentWbgtF:number|null;nextWbgtF:number|null;currentCategory:number|null;nextCategory:number|null;siteType:string;currentHour:PlanHour|null};
export function phoenixDate(now?:number):string;
export function hourInstant(date:string,time:string,nextDay?:boolean):number;
export function emptySession(workerName:string,date?:string):WorkerSession;
export function sessionContext(session:WorkerSession,now?:number):SessionContext;
export function applySessionAction(session:WorkerSession,action:"water"|"start"|"start-break"|"end-break"|"end",now?:number):WorkerSession;
export function dueReminder(session:WorkerSession,checkins:any[],now?:number):{key:string;type:"followup"|"checkin"|"break"|"water";minutes?:number;cups?:number}|null;
