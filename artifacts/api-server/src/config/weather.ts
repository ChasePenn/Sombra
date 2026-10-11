export const WEATHER_TIMEZONE = "America/Phoenix";
export const OPEN_METEO_FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_GEOCODING_URL =
  "https://geocoding-api.open-meteo.com/v1/search";

export const FORECAST_HOURLY_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "wind_speed_10m",
  "surface_pressure",
  "shortwave_radiation",
  "direct_radiation",
  "diffuse_radiation",
  "cloud_cover",
] as const;

// With no local ground data, keep the Argonne model's default ground reflectivity.
export const DEFAULT_SURFACE_ALBEDO = 0.45;
