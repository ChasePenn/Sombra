const INTENSITIES = new Set(["easy", "moderate", "hard"]);

function validateScheduleInput({ hours, intensity, newToHeat, table, categoryIncrease, stopAtExtreme }) {
  if (!Array.isArray(hours)) {
    throw new TypeError("Schedule hours must be an array.");
  }
  if (!INTENSITIES.has(intensity)) {
    throw new TypeError("Schedule intensity must be easy, moderate, or hard.");
  }
  if (typeof newToHeat !== "boolean") {
    throw new TypeError("newToHeat must be a boolean.");
  }
  if (![0, 1].includes(categoryIncrease) || typeof stopAtExtreme !== "boolean") {
    throw new TypeError("Audience safety adjustments are invalid.");
  }
  if (!table || !Array.isArray(table.categories) || table.categories.length === 0) {
    throw new TypeError("A work/rest table with categories is required.");
  }
  if (
    !Number.isFinite(table.max_water_qt_per_hour) ||
    table.max_water_qt_per_hour < 0 ||
    !Number.isFinite(table.max_water_qt_per_day) ||
    table.max_water_qt_per_day < 0
  ) {
    throw new TypeError("The work/rest table has invalid water limits.");
  }
  for (const [index, hour] of hours.entries()) {
    if (!hour || !Number.isFinite(hour.wbgtF)) {
      throw new TypeError(`Hour ${index + 1} must include a finite wbgtF value.`);
    }
  }
}

function categoryFor(wbgtF, categories) {
  const ordered = [...categories].sort((a, b) => a.category - b.category);
  let selected = ordered[0];
  for (const category of ordered) {
    if (category.min_f == null || wbgtF >= category.min_f) {
      selected = category;
    } else {
      break;
    }
  }
  return selected;
}

/**
 * One work, rest and water recommendation per forecast hour.
 * Each hour needs wbgtF, already adjusted for sun and the site.
 */
export function buildWorkRestSchedule({
  hours, intensity, newToHeat, table, categoryIncrease = 0, stopAtExtreme = false,
}) {
  validateScheduleInput({ hours, intensity, newToHeat, table, categoryIncrease, stopAtExtreme });

  let remainingWaterQt = table.max_water_qt_per_day;
  const scheduledHours = hours.map((hour, index) => {
    const baseCategory = categoryFor(hour.wbgtF, table.categories);
    const maximumCategory = Math.max(...table.categories.map((entry) => entry.category));
    const category = Math.min(
      baseCategory.category + (newToHeat || categoryIncrease > 0 ? 1 : 0),
      maximumCategory,
    );
    const selectedCategory = table.categories.find(
      (entry) => entry.category === category,
    );
    if (!selectedCategory) {
      throw new TypeError(`The work/rest table is missing category ${category}.`);
    }

    const recommendation = selectedCategory[intensity];
    if (
      !recommendation ||
      !Number.isFinite(recommendation.rest) ||
      recommendation.rest < 0 ||
      !Number.isFinite(recommendation.water_qt) ||
      recommendation.water_qt < 0 ||
      !(recommendation.work === "NL" ||
        (Number.isFinite(recommendation.work) && recommendation.work >= 0))
    ) {
      throw new TypeError(`The work/rest table has invalid values for hour ${index + 1}.`);
    }

    const waterQt = Math.min(
      recommendation.water_qt,
      table.max_water_qt_per_hour,
      remainingWaterQt,
    );
    remainingWaterQt = Math.max(0, remainingWaterQt - waterQt);

    return {
      time: hour.time ?? "",
      wbgtF: hour.wbgtF,
      category,
      label: selectedCategory.label,
      color: selectedCategory.color,
      work: recommendation.work,
      restMinutes: recommendation.rest,
      waterQt,
      waterCups: Math.round(waterQt * 4),
      stopWork: category === maximumCategory && (stopAtExtreme || intensity === "hard"),
    };
  });

  return {
    hours: scheduledHours,
    totalWaterCups: scheduledHours.reduce((sum, hour) => sum + hour.waterCups, 0),
    maxWaterCupsPerHour: table.max_water_qt_per_hour * 4,
    maxWaterCupsPerDay: table.max_water_qt_per_day * 4,
  };
}
