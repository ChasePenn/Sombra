import { Router, type IRouter } from "express";
import {
  GetShiftHeatForecastBody,
  GetShiftHeatForecastResponse,
  SearchWeatherLocationsQueryParams,
  SearchWeatherLocationsResponse,
} from "@workspace/api-zod";
import {
  DEFAULT_SURFACE_ALBEDO,
  FORECAST_HOURLY_FIELDS,
  OPEN_METEO_FORECAST_URL,
  OPEN_METEO_GEOCODING_URL,
  WEATHER_TIMEZONE,
} from "../config/weather";
import { wbgt } from "../lib/wbgt.js";

const router: IRouter = Router();
const WEATHER_REQUEST_TIMEOUT_MS = 10_000;

interface OpenMeteoLocation {
  id?: number;
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: Array<number | null>;
  relative_humidity_2m: Array<number | null>;
  wind_speed_10m: Array<number | null>;
  surface_pressure: Array<number | null>;
  shortwave_radiation: Array<number | null>;
  direct_radiation: Array<number | null>;
  diffuse_radiation: Array<number | null>;
}

interface OpenMeteoForecast {
  hourly?: OpenMeteoHourly;
}

const WEATHER_VALUE_BOUNDS = {
  temperatureC: [-50, 60],
  relativeHumidity: [0, 100],
  pressureHpa: [500, 1100],
  windSpeedMs: [0, 75],
  radiationWm2: [0, 1500],
} as const;

function isWithinBounds(
  value: number | null,
  [minimum, maximum]: readonly [number, number],
): value is number {
  return value !== null && value >= minimum && value <= maximum;
}

function isPlausibleWeatherReading(
  hourly: OpenMeteoHourly,
  index: number,
): boolean {
  const temperature = hourly.temperature_2m[index];
  const humidity = hourly.relative_humidity_2m[index];
  const pressure = hourly.surface_pressure[index];
  const wind = hourly.wind_speed_10m[index];
  const shortwave = hourly.shortwave_radiation[index];
  const direct = hourly.direct_radiation[index];
  const diffuse = hourly.diffuse_radiation[index];

  if (
    (temperature !== null &&
      !isWithinBounds(temperature, WEATHER_VALUE_BOUNDS.temperatureC)) ||
    (humidity !== null &&
      !isWithinBounds(humidity, WEATHER_VALUE_BOUNDS.relativeHumidity)) ||
    (pressure !== null &&
      !isWithinBounds(pressure, WEATHER_VALUE_BOUNDS.pressureHpa)) ||
    (wind !== null && !isWithinBounds(wind, WEATHER_VALUE_BOUNDS.windSpeedMs))
  ) {
    return false;
  }

  const radiationValues = [shortwave, direct, diffuse];
  if (
    radiationValues.some(
      (value) =>
        value !== null &&
        !isWithinBounds(value, WEATHER_VALUE_BOUNDS.radiationWm2),
    )
  ) {
    return false;
  }

  return (direct ?? 0) + (diffuse ?? 0) <= WEATHER_VALUE_BOUNDS.radiationWm2[1];
}

function isValidOpenMeteoHourly(hourly: unknown): hourly is OpenMeteoHourly {
  if (typeof hourly !== "object" || hourly === null) {
    return false;
  }

  const forecast = hourly as Record<string, unknown>;
  const times = forecast.time;
  if (
    !Array.isArray(times) ||
    times.length === 0 ||
    !times.every(
      (time) =>
        typeof time === "string" &&
        /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(time),
    )
  ) {
    return false;
  }

  const numericFields = [
    forecast.temperature_2m,
    forecast.relative_humidity_2m,
    forecast.wind_speed_10m,
    forecast.surface_pressure,
    forecast.shortwave_radiation,
    forecast.direct_radiation,
    forecast.diffuse_radiation,
  ];

  return numericFields.every(
    (values) =>
      Array.isArray(values) &&
      values.length === times.length &&
      values.every(
        (value) =>
          value === null ||
          (typeof value === "number" && Number.isFinite(value)),
      ),
  );
}

function getRequiredWeatherReading(
  hourly: OpenMeteoHourly,
  index: number,
): {
  tempC: number;
  humidity: number;
  pressureHpa: number;
  wind10m: number;
} | null {
  const tempC = hourly.temperature_2m[index];
  const humidity = hourly.relative_humidity_2m[index];
  const pressureHpa = hourly.surface_pressure[index];
  const wind10m = hourly.wind_speed_10m[index];

  if (
    tempC == null ||
    humidity == null ||
    pressureHpa == null ||
    wind10m == null
  ) {
    return null;
  }

  return { tempC, humidity, pressureHpa, wind10m };
}

function phoenixDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WEATHER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nextCalendarDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (hour > 23 || minute > 59) {
    return Number.NaN;
  }
  return hour * 60 + minute;
}

// Open-Meteo reports 10 m winds; use Liljegren's urban power law to estimate 2 m winds.
function estimateWindAtTwoMeters(wind10m: number, solarWm2: number): number {
  const stabilityByWindAndSun = [
    [1, 1, 2, 4, 0, 5, 6, 0],
    [1, 2, 3, 4, 0, 5, 6, 0],
    [2, 2, 3, 4, 0, 4, 4, 0],
    [3, 3, 4, 4, 0, 0, 0, 0],
    [3, 4, 4, 4, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ];
  const windIndex =
    wind10m >= 6 ? 4 : wind10m >= 5 ? 3 : wind10m >= 3 ? 2 : wind10m >= 2 ? 1 : 0;
  const sunIndex =
    solarWm2 >= 925 ? 0 : solarWm2 >= 675 ? 1 : solarWm2 >= 175 ? 2 : 3;
  const stabilityClass = stabilityByWindAndSun[windIndex][sunIndex];
  const urbanExponents = [0.15, 0.15, 0.2, 0.25, 0.3, 0.3];
  const exponent = urbanExponents[Math.max(0, stabilityClass - 1)];
  return Math.max(0.5, wind10m * Math.pow(2 / 10, exponent));
}

// NOAA's equation-of-time and declination equations provide the sun angle at the forecast's local time.
function solarZenithAtPhoenixTime(localDateTime: string, latitude: number, longitude: number): number {
  const [date, clock] = localDateTime.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const dayNumber = Math.floor(
    (Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 0)) / 86_400_000,
  );
  const localMinutes = hour * 60 + minute;
  const fractionalYear =
    (2 * Math.PI / 365) *
    (dayNumber - 1 + (localMinutes / 60 - 12) / 24);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fractionalYear) -
      0.032077 * Math.sin(fractionalYear) -
      0.014615 * Math.cos(2 * fractionalYear) -
      0.040849 * Math.sin(2 * fractionalYear));
  const declination =
    0.006918 -
    0.399912 * Math.cos(fractionalYear) +
    0.070257 * Math.sin(fractionalYear) -
    0.006758 * Math.cos(2 * fractionalYear) +
    0.000907 * Math.sin(2 * fractionalYear) -
    0.002697 * Math.cos(3 * fractionalYear) +
    0.00148 * Math.sin(3 * fractionalYear);
  const phoenixStandardOffsetMinutes = -7 * 60;
  const solarMinutes =
    localMinutes + equationOfTime + 4 * longitude - phoenixStandardOffsetMinutes;
  const hourAngle = ((solarMinutes / 4 - 180) * Math.PI) / 180;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const cosineZenith =
    Math.sin(latitudeRadians) * Math.sin(declination) +
    Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle);

  return (
    (Math.acos(Math.min(1, Math.max(-1, cosineZenith))) * 180) /
    Math.PI
  );
}

router.get("/weather/geocode", async (req, res): Promise<void> => {
  const parsed = SearchWeatherLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const searchUrl = new URL(OPEN_METEO_GEOCODING_URL);
  searchUrl.searchParams.set("name", parsed.data.name.slice(0, 100));
  searchUrl.searchParams.set("count", "5");
  searchUrl.searchParams.set("language", "en");
  searchUrl.searchParams.set("format", "json");

  try {
    const response = await fetch(searchUrl, {
      signal: AbortSignal.timeout(WEATHER_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      req.log.error({ status: response.status }, "Open-Meteo location search failed");
      res.status(502).json({ error: "Location search is temporarily unavailable." });
      return;
    }

    const data = (await response.json()) as { results?: OpenMeteoLocation[] };
    const locations = (data.results ?? []).map((location) => ({
      id: location.id,
      name: location.name,
      admin1: location.admin1 ?? null,
      country: location.country ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
    }));
    res.json(SearchWeatherLocationsResponse.parse(locations));
  } catch (error) {
    req.log.error({ err: error }, "Unable to search Open-Meteo locations");
    res.status(502).json({ error: "Location search is temporarily unavailable." });
  }
});

router.post("/weather/shift", async (req, res): Promise<void> => {
  const parsed = GetShiftHeatForecastBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const shift = parsed.data;
  const requestedDate = (shift as typeof shift & { date: Date }).date
    .toISOString()
    .slice(0, 10);
  const startMinutes = clockMinutes(shift.startTime);
  const endMinutes = clockMinutes(shift.endTime);
  if (
    !Number.isFinite(startMinutes) ||
    !Number.isFinite(endMinutes) ||
    startMinutes === endMinutes
  ) {
    res.status(400).json({ error: "Enter a valid start and end time for the shift." });
    return;
  }

  const today = phoenixDate();
  const tomorrow = nextCalendarDate(today);
  if (requestedDate < today) {
    res.status(400).json({ error: "Past forecast dates aren't available. Choose today or tomorrow." });
    return;
  }
  if (requestedDate > tomorrow) {
    res.status(400).json({ error: "Forecasts are available for today and tomorrow only. Choose one of those dates." });
    return;
  }

  const crossesMidnight = endMinutes < startMinutes;
  if (requestedDate === tomorrow && crossesMidnight) {
    res.status(400).json({ error: "An overnight shift starting tomorrow extends beyond the available forecast. Choose an earlier shift or today." });
    return;
  }

  const forecastUrl = new URL(OPEN_METEO_FORECAST_URL);
  forecastUrl.searchParams.set("latitude", String(shift.latitude));
  forecastUrl.searchParams.set("longitude", String(shift.longitude));
  forecastUrl.searchParams.set("timezone", WEATHER_TIMEZONE);
  forecastUrl.searchParams.set("forecast_days", "2");
  forecastUrl.searchParams.set("wind_speed_unit", "ms");
  forecastUrl.searchParams.set("hourly", FORECAST_HOURLY_FIELDS.join(","));

  try {
    const response = await fetch(forecastUrl, {
      signal: AbortSignal.timeout(WEATHER_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      req.log.error({ status: response.status }, "Open-Meteo forecast failed");
      res.status(502).json({ error: "The weather forecast is temporarily unavailable." });
      return;
    }

    const data = (await response.json()) as OpenMeteoForecast;
    if (!isValidOpenMeteoHourly(data.hourly)) {
      req.log.error("Open-Meteo returned invalid hourly forecast data");
      res.status(502).json({ error: "No hourly forecast data is available right now." });
      return;
    }

    const date = requestedDate;
    if (!data.hourly.time.some((time) => time.startsWith(date))) {
      res.status(400).json({ error: "The forecast isn't available for the selected date yet. Choose today, or try again later." });
      return;
    }
    const startAt = `${date}T${shift.startTime}`;
    const endDate = crossesMidnight ? nextCalendarDate(date) : date;
    const endAt = `${endDate}T${shift.endTime}`;

    const requestedStart = Date.parse(`${startAt}:00Z`);
    const requestedEnd = Date.parse(`${endAt}:00Z`);
    const requestedHours: string[] = [];
    for (
      let timestamp = requestedStart;
      timestamp < requestedEnd;
      timestamp += 60 * 60 * 1000
    ) {
      requestedHours.push(new Date(timestamp).toISOString().slice(0, 16));
    }

    // A physically impossible reading means the provider's data is broken.
    const implausible = data.hourly.time.some(
      (time, index) => time >= startAt && time < endAt && !isPlausibleWeatherReading(data.hourly!, index),
    );
    if (implausible) {
      req.log.error("Open-Meteo returned implausible readings for the requested shift");
      res.status(502).json({ error: "The forecast came back with implausible readings, so it's temporarily unavailable. Try again soon." });
      return;
    }

    const availableTimes = new Set<string>();
    const hours = data.hourly.time.flatMap((time, index) => {
      if (time < startAt || time >= endAt) {
        return [];
      }

      const hourly = data.hourly!;
      const requiredReading = getRequiredWeatherReading(hourly, index);
      if (requiredReading === null) {
        // Keep this hour out of the response rather than estimating WBGT without required inputs.
        return [];
      }
      availableTimes.add(time);
      const { tempC, humidity, pressureHpa, wind10m } = requiredReading;

      const direct = hourly.direct_radiation[index] ?? 0;
      const diffuse = hourly.diffuse_radiation[index] ?? 0;
      const solarWm2 =
        direct + diffuse || hourly.shortwave_radiation[index] || 0;
      const directFraction =
        direct + diffuse > 0 ? direct / (direct + diffuse) : 0;
      const zenithDeg = solarZenithAtPhoenixTime(
        time,
        shift.latitude,
        shift.longitude,
      );
      const windMs = estimateWindAtTwoMeters(wind10m, solarWm2);
      const sharedInputs = {
        tempC,
        rh: humidity,
        pressureHpa,
        windMs,
        directFraction,
        zenithDeg,
        albedo: DEFAULT_SURFACE_ALBEDO,
      };
      const sun = wbgt({ ...sharedInputs, solarWm2 });
      const shade = wbgt({
        ...sharedInputs,
        solarWm2: 0,
        directFraction: 0,
      });
      const siteSolarWm2 = solarWm2 * (shift.solarMultiplier ?? 1);
      const site = wbgt({
        ...sharedInputs,
        windMs: estimateWindAtTwoMeters(wind10m, siteSolarWm2),
        solarWm2: siteSolarWm2,
        albedo: shift.siteAlbedo ?? DEFAULT_SURFACE_ALBEDO,
      });
      const wbgtToFahrenheit = (value: number) => (value * 9) / 5 + 32;
      const hour = time.slice(11, 16);

      return [
        {
          time: hour,
          airTempF: wbgtToFahrenheit(tempC),
          humidity,
          wbgtSunF: wbgtToFahrenheit(sun.wbgtC),
          wbgtShadeF: wbgtToFahrenheit(shade.wbgtC),
          wbgtSiteF: wbgtToFahrenheit(site.wbgtC),
        },
      ];
    });

    if (hours.length === 0) {
      req.log.error("Open-Meteo returned no usable hours for the requested shift");
      res.status(502).json({ error: "No hourly forecast data is available right now." });
      return;
    }

    const result = GetShiftHeatForecastResponse.parse({
      locationName: shift.locationName,
      timezone: WEATHER_TIMEZONE,
      date,
      intensity: shift.intensity,
      newToHeat: shift.newToHeat,
      missingHours: requestedHours
        .filter((time) => !availableTimes.has(time))
        .map((time) => time.slice(11, 16)),
      hours,
    });
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Unable to calculate shift heat forecast");
    res.status(502).json({ error: "The weather forecast could not be calculated." });
  }
});

export default router;
