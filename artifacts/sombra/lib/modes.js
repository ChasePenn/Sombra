export function resolveAudienceMode(modeModules, modeId) {
  if (!/^[a-z0-9-]+$/.test(modeId)) {
    throw new TypeError("Audience mode IDs may contain lowercase letters, numbers, and hyphens.");
  }
  const modulePath = `../config/modes/${modeId}.json`;
  const base = modeModules["../config/modes/workers.json"];
  const selected = modeModules[modulePath];
  if (!selected || selected.id !== modeId || !selected.locales || !selected.locales.en) {
    throw new RangeError(`Audience mode "${modeId}" is not configured.`);
  }
  const mergeLocale = (language) => {
    const original = base?.locales?.[language] ?? {};
    const override = selected.locales[language] ?? {};
    // Sections merge key by key, so a mode lists only the words it changes.
    const merged = { ...original, ...override };
    for (const [section, value] of Object.entries(override)) {
      const from = original[section];
      if (value && typeof value === "object" && !Array.isArray(value) && from && typeof from === "object" && !Array.isArray(from)) {
        merged[section] = { ...from, ...value };
      }
    }
    return merged;
  };
  const mode = selected.id === "workers"
    ? selected
    : {
        ...base,
        ...selected,
        id: selected.id,
        locales: { en: mergeLocale("en"), es: mergeLocale("es") },
      };
  if (!mode || !mode.locales || !mode.locales.en || !mode.locales.es) {
    throw new TypeError(`Audience mode "${modeId}" needs English and Spanish copy.`);
  }
  const referenceIntensities = mode.locales.en.taskIntensities;
  if (!Array.isArray(referenceIntensities) || referenceIntensities.length === 0) {
    throw new TypeError(`Audience mode "${modeId}" needs at least one configured task intensity.`);
  }
  const referenceValues = referenceIntensities.map(({ value }) => value);
  if (new Set(referenceValues).size !== referenceValues.length) {
    throw new TypeError(`Audience mode "${modeId}" has duplicate task intensity values.`);
  }
  for (const [locale, copy] of Object.entries(mode.locales)) {
    if (!Array.isArray(copy.taskIntensities) || !copy.checkIn || !Array.isArray(copy.checkIn.questions)) {
      throw new TypeError(`Audience mode "${modeId}" has an invalid content configuration for "${locale}".`);
    }
    const values = copy.taskIntensities.map(({ value }) => value);
    if (values.some((value, index) => value !== referenceValues[index]) || values.length !== referenceValues.length) {
      throw new TypeError(`Audience mode "${modeId}" has different task intensity values for "${locale}".`);
    }
    for (const intensity of copy.taskIntensities) {
      if (!intensity.label?.trim() || !intensity.forecastLabel?.trim() || !intensity.example?.trim()) {
        throw new TypeError(`Audience mode "${modeId}" has incomplete task intensity copy for "${locale}".`);
      }
    }
  }
  return mode;
}
