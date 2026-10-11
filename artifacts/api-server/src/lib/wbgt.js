/*
 * Derivative implementation of James C. Liljegren's (UChicago Argonne, LLC)
 * 2008 model. Its required acknowledgment and license are in the adjacent
 * THIRD_PARTY_NOTICES.md file.
 */
const PI = Math.PI;
const STEFAN_BOLTZMANN = 5.6696e-8;
const CP = 1003.5;
const M_AIR = 28.97;
const M_WATER = 18.015;
const R_AIR = 8314.34 / M_AIR;
const PR = CP / (CP + 1.25 * R_AIR);
const RATIO = (CP * M_AIR) / M_WATER;
const EMISSIVITY_WICK = 0.95;
const ALBEDO_WICK = 0.4;
const WICK_DIAMETER = 0.007;
const WICK_LENGTH = 0.0254;
const EMISSIVITY_GLOBE = 0.95;
const ALBEDO_GLOBE = 0.05;
const EMISSIVITY_SURFACE = 0.999;
const GLOBE_DIAMETER = 0.0508;
const MIN_WIND_MS = 0.5;
const CONVERGENCE_K = 0.02;
const MAX_ITERATIONS = 500;

function saturationVaporPressure(tempK) {
  const y = (tempK - 273.15) / (tempK - 32.18);
  return 1.004 * 6.1121 * Math.exp(17.502 * y);
}

function dewPoint(tempVaporPressureHpa) {
  const z = Math.log(tempVaporPressureHpa / (6.1121 * 1.004));
  return 273.15 + (240.97 * z) / (17.502 - z);
}

function airViscosity(tempK) {
  const sigma = 3.617;
  const epsilonKappa = 97.0;
  const reducedTemp = tempK / epsilonKappa;
  const omega = ((reducedTemp - 2.9) / 0.4) * -0.034 + 1.048;
  return (2.6693e-6 * Math.sqrt(M_AIR * tempK)) / (sigma * sigma * omega);
}

function airThermalConductivity(tempK) {
  return (CP + 1.25 * R_AIR) * airViscosity(tempK);
}

function waterVaporDiffusivity(tempK, pressureHpa) {
  const criticalPressureAir = 36.4;
  const criticalPressureWater = 218;
  const criticalTempAir = 132;
  const criticalTempWater = 647.3;
  const a = 3.64e-4;
  const b = 2.334;
  const pressureAtmospheres = pressureHpa / 1013.25;
  const criticalPressure13 = Math.pow(
    criticalPressureAir * criticalPressureWater,
    1 / 3,
  );
  const criticalTemp512 = Math.pow(
    criticalTempAir * criticalTempWater,
    5 / 12,
  );
  const criticalTemp12 = Math.sqrt(criticalTempAir * criticalTempWater);
  const mixedMolecularWeight = Math.sqrt(1 / M_AIR + 1 / M_WATER);

  return (
    ((a *
      Math.pow(tempK / criticalTemp12, b) *
      criticalPressure13 *
      criticalTemp512 *
      mixedMolecularWeight) /
      pressureAtmospheres) *
    1e-4
  );
}

function heatOfEvaporation(tempK) {
  return ((313.15 - tempK) / 30) * -71100 + 2.4073e6;
}

function atmosphericEmissivity(tempK, relativeHumidity) {
  return 0.575 * Math.pow(relativeHumidity * saturationVaporPressure(tempK), 0.143);
}

function cylinderHeatTransfer(tempK, pressureHpa, windMs) {
  const density = (pressureHpa * 100) / (R_AIR * tempK);
  const reynolds =
    (Math.max(windMs, MIN_WIND_MS) * density * WICK_DIAMETER) /
    airViscosity(tempK);
  const nusselt =
    0.281 * Math.pow(reynolds, 1 - 0.4) * Math.pow(PR, 1 - 0.56);
  return (nusselt * airThermalConductivity(tempK)) / WICK_DIAMETER;
}

function sphereHeatTransfer(tempK, pressureHpa, windMs) {
  const density = (pressureHpa * 100) / (R_AIR * tempK);
  const reynolds =
    (Math.max(windMs, MIN_WIND_MS) * density * GLOBE_DIAMETER) /
    airViscosity(tempK);
  const nusselt = 2 + 0.6 * Math.sqrt(reynolds) * Math.pow(PR, 0.3333);
  return (nusselt * airThermalConductivity(tempK)) / GLOBE_DIAMETER;
}

function iterateNaturalWetBulb({
  airK,
  humidity,
  pressureHpa,
  windMs,
  solarWm2,
  directFraction,
  zenithDeg,
  albedo,
}) {
  const zenith = (zenithDeg * Math.PI) / 180;
  const airVaporPressure = Math.max(
    1e-6,
    humidity * saturationVaporPressure(airK),
  );
  const airDewPointK = dewPoint(airVaporPressure);
  let previousK = airDewPointK;
  let currentK = previousK;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const referenceK = 0.5 * (previousK + airK);
    const transfer = cylinderHeatTransfer(referenceK, pressureHpa, windMs);
    const radiativeFlux =
      STEFAN_BOLTZMANN *
        EMISSIVITY_WICK *
        (0.5 *
          (atmosphericEmissivity(airK, humidity) * airK ** 4 +
            EMISSIVITY_SURFACE * airK ** 4) -
          previousK ** 4) +
      (1 - ALBEDO_WICK) *
        solarWm2 *
        ((1 - directFraction) *
          (1 + 0.25 * WICK_DIAMETER / WICK_LENGTH) +
          directFraction *
            (Math.tan(zenith) / PI + 0.25 * WICK_DIAMETER / WICK_LENGTH) +
          albedo);
    const wickVaporPressure = saturationVaporPressure(previousK);
    const density = (pressureHpa * 100) / (R_AIR * referenceK);
    const schmidt =
      airViscosity(referenceK) /
      (density * waterVaporDiffusivity(referenceK, pressureHpa));
    currentK =
      airK -
      (heatOfEvaporation(referenceK) / RATIO) *
        ((wickVaporPressure - airVaporPressure) /
          (pressureHpa - wickVaporPressure)) *
        Math.pow(PR / schmidt, 0.56) +
      radiativeFlux / transfer;

    if (!Number.isFinite(currentK)) {
      throw new Error("Natural wet-bulb model produced a non-finite value.");
    }
    if (Math.abs(currentK - previousK) < CONVERGENCE_K) {
      return currentK - 273.15;
    }
    previousK = 0.9 * previousK + 0.1 * currentK;
  }

  throw new Error("Natural wet-bulb model did not converge.");
}

function iterateGlobe({
  airK,
  humidity,
  pressureHpa,
  windMs,
  solarWm2,
  directFraction,
  zenithDeg,
  albedo,
}) {
  const cosineZenith = Math.max(
    0.00873,
    Math.cos((zenithDeg * Math.PI) / 180),
  );
  let previousK = airK;
  let currentK = previousK;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const referenceK = 0.5 * (previousK + airK);
    const transfer = sphereHeatTransfer(referenceK, pressureHpa, windMs);
    const radiativeTemperature =
      0.5 *
      (atmosphericEmissivity(airK, humidity) * airK ** 4 +
        EMISSIVITY_SURFACE * airK ** 4);
    const convectiveTerm =
      (transfer / (STEFAN_BOLTZMANN * EMISSIVITY_GLOBE)) *
      (previousK - airK);
    const solarTerm =
      (solarWm2 / (2 * STEFAN_BOLTZMANN * EMISSIVITY_GLOBE)) *
      (1 - ALBEDO_GLOBE) *
      (directFraction * (1 / (2 * cosineZenith) - 1) + 1 + albedo);
    currentK = Math.pow(
      radiativeTemperature - convectiveTerm + solarTerm,
      0.25,
    );

    if (!Number.isFinite(currentK)) {
      throw new Error("Globe-temperature model produced a non-finite value.");
    }
    if (Math.abs(currentK - previousK) < CONVERGENCE_K) {
      return currentK - 273.15;
    }
    previousK = 0.9 * previousK + 0.1 * currentK;
  }

  throw new Error("Globe-temperature model did not converge.");
}

function validateInput(input) {
  const bounds = [
    ["tempC", input.tempC, -80, 70],
    ["rh", input.rh, 0, 100],
    ["pressureHpa", input.pressureHpa, 100, 1200],
    ["windMs", input.windMs, 0, 150],
    ["solarWm2", input.solarWm2, 0, 1600],
    ["directFraction", input.directFraction, 0, 1],
    ["zenithDeg", input.zenithDeg, 0, 180],
    ["albedo", input.albedo, 0, 1],
  ];

  for (const [name, value, minimum, maximum] of bounds) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < minimum ||
      value > maximum
    ) {
      throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
    }
  }
}

/**
 * Calculates outdoor WBGT using the Liljegren heat- and mass-transfer model.
 * Pressure is supplied in hPa, relative humidity in percent, wind at 2 m,
 * and radiation in W/m²; temperatures in the result are °C.
 */
export function wbgt(input) {
  validateInput(input);
  const humidity = Math.max(1e-6, input.rh / 100);
  const airK = input.tempC + 273.15;
  const windMs = Math.max(MIN_WIND_MS, input.windMs);
  const belowSolarHorizon = input.zenithDeg >= 89.5;
  const solarWm2 = belowSolarHorizon ? 0 : input.solarWm2;
  const directFraction = belowSolarHorizon ? 0 : input.directFraction;
  const modelInput = {
    airK,
    humidity,
    pressureHpa: input.pressureHpa,
    windMs,
    solarWm2,
    directFraction,
    zenithDeg: input.zenithDeg,
    albedo: input.albedo,
  };
  const tnwbC = iterateNaturalWetBulb(modelInput);
  const tgC = iterateGlobe(modelInput);
  const wbgtC = 0.1 * input.tempC + 0.7 * tnwbC + 0.2 * tgC;

  return { wbgtC, tnwbC, tgC };
}
