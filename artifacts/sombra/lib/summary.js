function getLocalDateAndHour(value, timezone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      hour: Number(values.hour),
    };
  } catch (_error) {
    return null;
  }
}

function hourNumber(value) {
  const match = String(value ?? "").match(/^(\d{1,2}):\d{2}$/);
  return match ? Number(match[1]) : null;
}

function nextHour(value) {
  const hour = hourNumber(value);
  return hour === null ? value : `${String((hour + 1) % 24).padStart(2, "0")}:00`;
}

function findCurrentHourIndex(hours, date, now, timezone) {
  const localNow = getLocalDateAndHour(now, timezone);
  if (!localNow) return -1;
  let hourDate = date;
  let previousHour = null;
  return hours.findIndex((hour) => {
    const number = hourNumber(hour.time);
    if (previousHour !== null && number < previousHour) {
      const next = new Date(`${hourDate}T12:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      hourDate = next.toISOString().slice(0, 10);
    }
    previousHour = number;
    return hourDate === localNow.date && number === localNow.hour;
  });
}

function findRestGroup(hours, startIndex) {
  const first = hours.findIndex(
    (hour, index) => index >= startIndex && hour.restMinutes > 0,
  );
  if (first < 0) return null;
  const restMinutes = hours[first].restMinutes;
  let last = first;
  while (
    last + 1 < hours.length &&
    nextHour(hours[last].time) === hours[last + 1].time &&
    hours[last + 1].restMinutes === restMinutes &&
    hours[last + 1].category === hours[first].category
  ) {
    last += 1;
  }
  return { first, last, restMinutes };
}

export function buildShiftSummary({
  hours,
  workerName,
  date,
  now = new Date(),
  timezone = "America/Phoenix",
  intensity = "moderate",
  strings,
  formatTime,
}) {
  if (!Array.isArray(hours) || hours.length === 0) {
    throw new TypeError("A shift summary needs at least one scheduled hour.");
  }
  if (!strings || typeof strings !== "object" || typeof formatTime !== "function") {
    throw new TypeError("Shift summary strings and a time formatter are required.");
  }

  const currentHourIndex = findCurrentHourIndex(hours, date, now, timezone);
  const activeIndex = currentHourIndex >= 0 ? currentHourIndex : 0;
  const activeHour = hours[activeIndex];
  const localNow = getLocalDateAndHour(now, timezone);
  const greetingKey = localNow
    ? localNow.hour < 12
      ? "greetingMorning"
      : localNow.hour < 17
        ? "greetingAfternoon"
        : "greetingEvening"
    : "greetingMorning";
  const hottestHour = hours.reduce(
    (hottest, hour) => hour.wbgtF > hottest.wbgtF ? hour : hottest,
    hours[0],
  );

  let message;
  const stopIndex = intensity === "hard"
    ? hours.findIndex((hour) => hour.stopWork)
    : -1;
  if (stopIndex >= 0) {
    message = strings.summary.tooHot.replace(
      "{time}",
      formatTime(hours[stopIndex].time),
    );
  } else {
    const restGroup = findRestGroup(hours, activeIndex);
    if (restGroup && restGroup.first > activeIndex && activeHour.restMinutes === 0) {
      message = strings.summary.normalUntil.replace(
        "{time}",
        formatTime(hours[restGroup.first].time),
      );
    } else if (restGroup) {
      message = strings.summary.breaks
        .replace("{minutes}", String(restGroup.restMinutes))
        .replace("{start}", formatTime(hours[restGroup.first].time))
        .replace("{end}", formatTime(nextHour(hours[restGroup.last].time)));
    } else {
      message = strings.summary.normalShift;
    }
  }

  return {
    currentHourIndex,
    activeCategory: activeHour.category,
    activeRisk: strings.risk[String(activeHour.category)] ?? activeHour.label,
    greeting: strings.summary[greetingKey].replace("{name}", workerName),
    message,
    hottest: strings.summary.hottest
      .replace("{time}", formatTime(hottestHour.time))
      .replace("{risk}", strings.risk[String(hottestHour.category)] ?? hottestHour.label),
    hottestHour,
    isToday: Boolean(currentHourIndex >= 0 || (localNow && localNow.date === date)),
  };
}

export function groupScheduleHours(hours) {
  const groups = [];
  for (const hour of hours) {
    const previous = groups.at(-1);
    if (
      previous &&
      previous.category === hour.category &&
      nextHour(previous.hours.at(-1).time) === hour.time
    ) {
      previous.hours.push(hour);
    } else {
      groups.push({ category: hour.category, hours: [hour] });
    }
  }
  return groups;
}

