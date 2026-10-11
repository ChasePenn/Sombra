export interface WbgtInput {
  tempC: number;
  rh: number;
  pressureHpa: number;
  windMs: number;
  solarWm2: number;
  directFraction: number;
  zenithDeg: number;
  albedo: number;
}

export interface WbgtResult {
  wbgtC: number;
  tnwbC: number;
  tgC: number;
}

export function wbgt(input: WbgtInput): WbgtResult;
