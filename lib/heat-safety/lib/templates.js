import templates from "../config/checkin_templates.json" with { type: "json" };
import firstAid from "../config/first_aid.json" with { type: "json" };
export { templates, firstAid };
export function fillTemplate(level, context, language = "en", mode = "workers") {
  const locale = templates[language === "es" ? "es" : "en"];
  const source = (locale.modes[mode] ?? locale.modes.workers)?.[level];
  if (!source) throw new Error("Unsupported audience mode or safety level");
  const fmt = (value) => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
  const values = {
    name: context.firstName || context.workerName?.split(/\s+/)[0] || "",
    hours: fmt(context.hoursWorked ?? 0),
    water: fmt(context.waterCups ?? 0),
    recommended: fmt(context.recommendedCups ?? 0),
  };
  const fill = (text) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
  values.recommendation = fill(context.recommendedCups === null || context.recommendedCups === undefined ? locale.noPlan : locale.recommendation);
  const {unavailable_message, fresh_message, ...result} = source;
  // Nothing logged yet (no time outside, no water): "0 hours and 0 cups" would only be noise.
  const nothingLogged = !(context.hoursWorked > 0) && !(context.waterCups > 0);
  const message = context.activityAvailable === false && unavailable_message ? unavailable_message
    : nothingLogged && fresh_message ? fresh_message
    : source.message;
  return { ...result, message: fill(message), actions: [...source.actions] };
}
