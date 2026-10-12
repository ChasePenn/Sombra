import { buildWorkRestSchedule } from "../lib/schedule.js";
import { buildShiftSummary, groupScheduleHours } from "../lib/summary.js";
import { resolveAudienceMode } from "../lib/modes.js";
import {
  isHighConfidence,
  resolveSiteFactors,
} from "../lib/site-classification.js";
import workRestTable from "../config/work_rest_table.json" with { type: "json" };
import siteAdjustments from "../config/site_adjustments.json";
import { getProfile, getShifts, getCrew, getCheckins, saveShift, setAccountSession } from "./js/store.js";
import { GeoError, locate, platform, roundedQuery } from "./js/geo.js";

const modeModules = import.meta.glob("../config/modes/*.json", { eager: true, import: "default" });
const requestedModeId = new URLSearchParams(window.location.search).get("mode") || "work";
const selectedModeId = requestedModeId === "workers" ? "work" : requestedModeId;
const selectedMode = resolveAudienceMode(modeModules, selectedModeId);

// Forecast hours and the sun angle use Arizona time (no daylight saving). Outside Arizona that
// can differ from local time, so the planner says so instead of quietly showing shifted hours.
const isInArizona = (lat, lon) => lat >= 31.3 && lat <= 37.0 && lon >= -114.9 && lon <= -109.0;

(() => {
  "use strict";

  const form = document.querySelector("#shift-form");
  const savedPlanNotice = document.createElement("p");
  savedPlanNotice.className = "saved-plan-notice";
  savedPlanNotice.setAttribute("role", "status");
  savedPlanNotice.hidden = true;
  form.prepend(savedPlanNotice);
  let restoredShift = null;
  let loadedStorageSession = null;
  let formTouched = false;
  form.addEventListener("input", () => { formTouched = true; });
  const locationInput = document.querySelector("#location-search");
  const locationNameInput = document.querySelector("#location-name");
  const latitudeInput = document.querySelector("#latitude");
  const longitudeInput = document.querySelector("#longitude");
  const suggestions = document.querySelector("#location-options");
  const locationStatus = document.querySelector("#location-status");
  const clearLocation = document.querySelector("#clear-location");
  const useLocation = document.querySelector("#use-location");
  const submitButton = document.querySelector("#submit-shift");
  const formError = document.querySelector("#form-error");
  const todayDateInput = document.querySelector("#shift-date-today");
  const tomorrowDateInput = document.querySelector("#shift-date-tomorrow");
  const dateInputs = [todayDateInput, tomorrowDateInput];
  const results = document.querySelector("#results");
  const forecastRows = document.querySelector("#forecast-rows");
  const forecastStatus = document.querySelector("#forecast-status");

  const forecastPartialNotice = document.querySelector("#forecast-partial-notice");
  const workRestSection = document.querySelector("#work-rest-schedule");
  const stopWorkBanner = document.querySelector("#stop-work-banner");
  const scheduleCards = document.querySelector("#schedule-cards");
  const scheduleStatus = document.querySelector("#schedule-status");
  const schedulePolicyCopy = document.querySelector("#schedule-policy-copy");
  const workRestSource = document.querySelector("#work-rest-source");
  const summaryPanel = document.querySelector("#shift-summary");
  const summaryTitle = document.querySelector("#shift-summary-title");
  const summaryGreeting = document.querySelector("#summary-greeting");
  const summaryRisk = document.querySelector("#summary-risk");
  const summaryRiskLabel = document.querySelector("#summary-risk-label");
  const summaryWbgt = document.querySelector("#summary-wbgt");
  const summaryAdvice = document.querySelector("#summary-advice");
  const summaryHottest = document.querySelector("#summary-hottest");
  const todayMeta = document.querySelector("#today-meta");
  const heatGauge = document.querySelector("#heat-gauge");
  const crewStatus = document.querySelector("#crew-status");
  const hourStrip = document.querySelector("#hour-strip");
  const hourStripTitle = document.querySelector("#hour-strip-title");
  const languageButtons = [...document.querySelectorAll("[data-locale]")];
  const siteEditAdjustment = document.querySelector("#site-edit-adjustment");
  const siteCheck = document.querySelector("#site-check");
  const sitePhotoOpen = document.querySelector("#site-photo-open");
  const siteManualOpen = document.querySelector("#site-manual-open");
  const sitePhotoPanel = document.querySelector("#site-photo-panel");
  const sitePhotoInput = document.querySelector("#site-photo-input");
  const siteModelProgress = document.querySelector("#site-model-progress");
  const siteModelStatus = document.querySelector("#site-model-status");
  const siteAdjustmentPanel = document.querySelector("#site-adjustment-panel");
  const sitePredictionNote = document.querySelector("#site-prediction-note");
  const sitePredictionChips = document.querySelector("#site-prediction-chips");
  const siteHotSurfaceWarning = document.querySelector("#site-hot-surface-warning");
  const siteApplyButton = document.querySelector("#site-apply-adjustment");
  const siteAdjustmentStatus = document.querySelector("#site-adjustment-status");
  const siteAdjustedResults = document.querySelector("#site-adjusted-results");
  const siteComparisonRows = document.querySelector("#site-comparison-rows");
  const siteAdjustmentDescription = document.querySelector("#site-adjustment-description");
  const scheduleSiteBadge = document.querySelector("#schedule-site-badge");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let selectedLocation = null;
  let searchTimer = null;
  let searchController = null;
  let renderedLocations = [];
  let highlightedIndex = -1;
  let activeShiftPayload = null;
  let baseForecast = null;
  let activeForecast = null;
  let latestSitePredictions = null;
  let siteComparison = null;
  const availableLocales = Object.keys(selectedMode.locales);
  let savedLocale = null;
  try {
    savedLocale = localStorage.getItem("sombra.locale");
  } catch {
    // If storage is blocked, guests can still plan.
  }
  let activeLocale = availableLocales.includes(savedLocale) ? savedLocale :
    navigator.language?.toLowerCase().startsWith("es") && availableLocales.includes("es") ? "es" :
      availableLocales.includes("en") ? "en" : availableLocales[0];
  const activeModeLocale = () => selectedMode.locales[activeLocale];
  let visionModule = null;
  let siteClassifier = null;
  let siteClassifierPromise = null;
  let siteAdjustmentApplied = false;
  let appliedSiteSelection = null;

  const localizedMessages = new Map();
  const translate = (key, values = {}) => {
    const message = key.split(".").reduce((value, segment) => value?.[segment], activeModeLocale());
    if (typeof message !== "string") return key;
    return Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      message,
    );
  };
  const setLocalizedText = (element, key, values = {}) => {
    localizedMessages.set(element, { key, values });
    element.textContent = key ? translate(key, values) : "";
  };
  // Personal heat risk factors are saved on this device only (Tools > My heat profile).
  const personalRiskFactors = () => {
    try {
      const value = JSON.parse(localStorage.getItem("sombra.risk-profile") || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
  const effectiveCategoryIncrease = () =>
    Math.max(selectedMode.rules?.categoryIncrease ?? 0, personalRiskFactors().length > 0 ? 1 : 0);
  const renderIntensityOptions = () => {
    const container = document.querySelector("#intensity-options");
    const selectedValue = container.querySelector('input[name="intensity"]:checked')?.value;
    container.replaceChildren();
    activeModeLocale().taskIntensities.forEach((intensity, index) => {
      const label = document.createElement("label");
      label.className = "intensity-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "intensity";
      input.value = intensity.value;
      input.required = index === 0;
      input.checked = intensity.value === selectedValue;
      const card = document.createElement("span");
      card.className = "intensity-card";
      const mark = document.createElement("span");
      mark.className = "radio-mark";
      const name = document.createElement("span");
      name.className = "intensity-name";
      name.textContent = intensity.label;
      const example = document.createElement("span");
      example.className = "intensity-example";
      example.textContent = intensity.example;
      card.append(mark, name, example);
      label.append(input, card);
      container.append(label);
    });
  };
  const applyTranslations = () => {
    document.documentElement.lang = activeLocale;
    document.title = translate("ui.documentTitle");
    document.querySelectorAll("[data-mode-meta]").forEach((element) => {
      element.setAttribute("content", translate(`ui.${element.dataset.modeMeta}`));
    });
    results.lang = activeLocale;
    document.querySelectorAll("[data-mode-copy]").forEach((element) => {
      element.textContent = translate(`ui.${element.dataset.modeCopy}`);
    });
    document.querySelectorAll("[data-mode-aria]").forEach((element) => {
      element.setAttribute("aria-label", translate(`ui.${element.dataset.modeAria}`));
    });
    document.querySelectorAll("[data-mode-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", translate(`ui.${element.dataset.modePlaceholder}`));
    });
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = translate(element.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", translate(element.dataset.i18nAriaLabel));
    });
    for (const button of languageButtons) {
      button.hidden = !availableLocales.includes(button.dataset.locale);
      button.setAttribute("aria-pressed", String(button.dataset.locale === activeLocale));
    }
    renderIntensityOptions();
    if (restoredShift) renderSavedPlanNotice();
    for (const [element, { key, values }] of localizedMessages) {
      element.textContent = key ? translate(key, values) : "";
    }
    // Only reformat the existing dates: a language switch must not change the
    // user's chosen date (including when the page has stayed open overnight).
    for (const input of dateInputs) {
      if (input.value) {
        document.querySelector(`#${input.id}-label`).textContent = formatDate(input.value);
      }
    }
    if (submitButton.disabled) setLoading(true);
    if (!forecastStatus.hidden) {
      const { key, kind } = forecastMessage;
      setForecastMessage(key, kind);
    }
    if (activeForecast && activeShiftPayload) {
      renderForecast(activeForecast, activeShiftPayload);
      renderScheduleFromForecast(activeForecast, siteAdjustmentApplied);
    }
    if (siteComparison) {
      renderSiteComparison(siteComparison.before, siteComparison.after, siteComparison.selection);
    }
    if (latestSitePredictions && !siteAdjustmentPanel.hidden) {
      renderSitePredictions(latestSitePredictions, false);
    }
    if (siteApplyButton.getAttribute("aria-busy") === "true") {
      siteApplyButton.textContent = translate("results.siteApplying");
    }
  };
  applyTranslations();
  const applySavedProfile = (profile) => {
    if (!profile) return;
    if (availableLocales.includes(profile.language)) {
      activeLocale = profile.language;
      applyTranslations();
    }
    document.querySelector("#worker-name").value = profile.name ?? "";
    // The name is already in the profile, so don't ask for it again.
    document.querySelector(".worker-field").hidden = Boolean(profile.name?.trim());
    const intensity = form.querySelector(`input[name="intensity"][value="${profile.usualIntensity}"]`);
    if (intensity) intensity.checked = true;
    const acclimation = form.querySelector(`input[name="newToHeat"][value="${profile.newToHeat ? "yes" : "no"}"]`);
    if (acclimation) acclimation.checked = true;
    applyPrefill();
  };
  // "Plan this" from Best time opens the planner with ?lat&lon&place&date&start&end&intensity.
  const prefillParams = new URLSearchParams(window.location.search);
  const prefill = (() => {
    const lat = Number(prefillParams.get("lat"));
    const lon = Number(prefillParams.get("lon"));
    const clock = /^\d{2}:\d{2}$/;
    const start = prefillParams.get("start");
    const end = prefillParams.get("end");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !clock.test(start ?? "") || !clock.test(end ?? "")) return null;
    return {
      lat, lon, start, end,
      place: (prefillParams.get("place") || "").slice(0, 120),
      date: prefillParams.get("date") || "",
      intensity: prefillParams.get("intensity") || "",
    };
  })();
  let prefillSubmitted = false;
  function applyPrefill() {
    if (!prefill) return;
    setSelectedLocation({ name: prefill.place || `${prefill.lat.toFixed(3)}, ${prefill.lon.toFixed(3)}`, latitude: prefill.lat, longitude: prefill.lon });
    document.querySelector("#start-time").value = prefill.start;
    document.querySelector("#end-time").value = prefill.end;
    const date = dateInputs.find((field) => field.value === prefill.date);
    if (date) date.checked = true;
    const intensity = form.querySelector(`input[name="intensity"][value="${prefill.intensity}"]`);
    if (intensity) intensity.checked = true;
    // Plan right away once we know who it's for.
    if (!prefillSubmitted && document.querySelector("#worker-name").value.trim()) {
      prefillSubmitted = true;
      if (!form.querySelector('input[name="newToHeat"]:checked')) {
        form.querySelector('input[name="newToHeat"][value="no"]').checked = true;
      }
      setTimeout(() => form.requestSubmit(), 0);
    }
  }
  function renderSavedPlanNotice() {
    savedPlanNotice.textContent = translate("results.savedPlanNotice")
      .replace("{location}", restoredShift.location)
      .replace("{date}", restoredShift.date);
    savedPlanNotice.hidden = false;
  }
  const restoreLatestShift = async (profile, storageSession) => {
    try {
      const saved = await getShifts();
      if (storageSession !== loadedStorageSession) return;
      restoredShift = saved[0] ?? null;
      if (!restoredShift) return;
      const input = restoredShift.planJson?.input;
      if (!formTouched && !prefill && input && Number.isFinite(input.latitude) && Number.isFinite(input.longitude)) {
        setSelectedLocation({ name: input.locationName ?? restoredShift.location, latitude: input.latitude, longitude: input.longitude });
        document.querySelector("#worker-name").value = profile?.name || input.workerName || "";
        for (const name of ["startTime", "endTime"]) {
          const field = form.querySelector(`[name="${name}"]`);
          if (field && typeof input[name] === "string") field.value = input[name];
        }
        const date = dateInputs.find((field) => field.value === input.date);
        if (date) date.checked = true;
        const intensity = form.querySelector(`input[name="intensity"][value="${input.intensity}"]`);
        if (intensity) intensity.checked = true;
        const acclimation = form.querySelector(`input[name="newToHeat"][value="${input.newToHeat ? "yes" : "no"}"]`);
        if (acclimation) acclimation.checked = true;
      }
      // Never show an old forecast as today's heat advice.
      renderSavedPlanNotice();
    } catch {
      setLocalizedText(formError, "results.savedPlanLoadFailed");
      formError.hidden = false;
    }
  };
  if (window.parent === window) {
    loadedStorageSession = "guest";
    getProfile().then((profile) => {
      applySavedProfile(profile);
      return restoreLatestShift(profile, "guest");
    }).catch(() => {
      setLocalizedText(formError, "results.savedPlanLoadFailed");
      formError.hidden = false;
    });
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.source !== window.parent) return;
    if (event.data?.type === "sombra:session") {
      setAccountSession(event.data.userId);
      if (availableLocales.includes(event.data.language)) {
        activeLocale = event.data.language;
        applyTranslations();
      }
      const storageSession = event.data.userId || "guest";
      if (storageSession !== loadedStorageSession) {
        loadedStorageSession = storageSession;
        if (!formTouched) applySavedProfile(event.data.profile);
        restoreLatestShift(event.data.profile, storageSession);
      }
    }
  });
  const persistPlan = async (payload, forecast) => {
    try {
      await saveShift({
        date: payload.date,
        location: payload.locationName,
        planJson: {
          input: {
            ...payload,
            mode: selectedModeId,
            categoryIncrease: effectiveCategoryIncrease(),
            stopAtExtreme: selectedMode.rules?.stopAtExtreme === true,
          },
          forecast,
          siteSelection: appliedSiteSelection,
        },
      });
      restoredShift = null;
      savedPlanNotice.hidden = true;
      if (window.parent !== window) {
        window.parent.postMessage({ type: "sombra:planned" }, window.location.origin);
      }
    } catch (error) {
      setLocalizedText(formError, "results.savedPlanSaveFailed");
      formError.hidden = false;
    }
  };

  const safeText = (value) => String(value ?? "").trim();
  const locationDisplayName = (item) => {
    const parts = [item.name, item.admin1, item.country].filter(Boolean);
    return [...new Set(parts)].join(", ");
  };
  const setLocationMessage = (key, isError = false, values = {}) => {
    setLocalizedText(locationStatus, key, values);
    locationStatus.dataset.error = isError ? "true" : "false";
  };
  const setSelectedLocation = (item) => {
    selectedLocation = item;
    locationInput.value = locationDisplayName(item);
    locationNameInput.value = locationDisplayName(item);
    latitudeInput.value = String(item.latitude);
    longitudeInput.value = String(item.longitude);
    clearLocation.hidden = false;
    suggestions.hidden = true;
    suggestions.replaceChildren();
    setLocationMessage("location.selected");
    document.querySelector("#arizona-note").hidden = isInArizona(item.latitude, item.longitude);
  };
  const clearSelectedLocation = (keepText = false) => {
    document.querySelector("#arizona-note").hidden = true;
    selectedLocation = null;
    locationNameInput.value = "";
    latitudeInput.value = "";
    longitudeInput.value = "";
    clearLocation.hidden = !locationInput.value;
    if (!keepText) locationInput.value = "";
    setLocationMessage("");
  };
  const hideSuggestions = () => {
    suggestions.hidden = true;
    highlightedIndex = -1;
    locationInput.removeAttribute("aria-activedescendant");
  };
  const renderSuggestions = (items) => {
    renderedLocations = items;
    highlightedIndex = -1;
    suggestions.replaceChildren();
    if (!items.length) {
      hideSuggestions();
      return;
    }
    items.forEach((item, index) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.id = `location-option-${index}`;
      button.className = "suggestion-option";
      button.role = "option";
      button.setAttribute("aria-selected", "false");
      const name = document.createElement("span");
      name.className = "suggestion-name";
      name.textContent = item.name;
      const region = document.createElement("span");
      region.className = "suggestion-region";
      region.textContent = [item.admin1, item.country].filter(Boolean).join(", ");
      button.append(name, region);
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", () => setSelectedLocation(item));
      li.append(button);
      suggestions.append(li);
    });
    suggestions.hidden = false;
  };
  const setHighlightedOption = (next) => {
    if (!renderedLocations.length) return;
    highlightedIndex = (next + renderedLocations.length) % renderedLocations.length;
    suggestions.querySelectorAll('[role="option"]').forEach((option, index) => {
      option.setAttribute("aria-selected", index === highlightedIndex ? "true" : "false");
    });
    const active = suggestions.querySelector(`#location-option-${highlightedIndex}`);
    if (active) {
      locationInput.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    }
  };

  async function searchLocations(query) {
    if (searchController) searchController.abort();
    searchController = new AbortController();
    setLocationMessage("location.searching");
    try {
      const response = await fetch(`/api/weather/geocode?name=${encodeURIComponent(query)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: searchController.signal
      });
      if (!response.ok) throw new Error(translate("location.searchUnavailable"));
      const data = await response.json();
      const items = Array.isArray(data) ? data.filter((item) =>
        item && typeof item.name === "string" &&
        Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude))
      ) : [];
      if (locationInput.value.trim() !== query) return;
      if (!items.length) {
        hideSuggestions();
        setLocationMessage("location.noneFound");
        return;
      }
      renderSuggestions(items);
      setLocationMessage(
        items.length === 1 ? "location.oneFound" : "location.manyFound",
        false,
        { count: items.length },
      );
    } catch (error) {
      if (error.name === "AbortError") return;
      hideSuggestions();
      setLocationMessage("location.searchFailed", true);
    }
  }

  locationInput.addEventListener("input", () => {
    clearLocation.hidden = !locationInput.value;
    if (selectedLocation && locationInput.value.trim() !== locationDisplayName(selectedLocation)) {
      clearSelectedLocation(true);
    }
    const query = locationInput.value.trim();
    hideSuggestions();
    if (searchTimer) clearTimeout(searchTimer);
    if (query.length < 2) {
      setLocationMessage(query ? "location.minimumCharacters" : "");
      return;
    }
    searchTimer = setTimeout(() => searchLocations(query), 280);
  });
  locationInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && renderedLocations.length) {
      event.preventDefault();
      setHighlightedOption(highlightedIndex + 1);
    } else if (event.key === "ArrowUp" && renderedLocations.length) {
      event.preventDefault();
      setHighlightedOption(highlightedIndex < 0 ? renderedLocations.length - 1 : highlightedIndex - 1);
    } else if (event.key === "Enter" && highlightedIndex >= 0 && renderedLocations[highlightedIndex]) {
      event.preventDefault();
      setSelectedLocation(renderedLocations[highlightedIndex]);
    } else if (event.key === "Escape") {
      hideSuggestions();
    }
  });
  locationInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!suggestions.contains(document.activeElement)) hideSuggestions();
    }, 120);
  });
  clearLocation.addEventListener("click", () => {
    clearSelectedLocation();
    locationInput.focus();
  });

  useLocation.addEventListener("click", async () => {
    useLocation.disabled = true;
    useLocation.setAttribute("aria-busy", "true");
    setLocationMessage("location.finding");
    try {
      const fix = await locate({ onRetry: () => setLocationMessage("location.retrying") });
      setSelectedLocation({
        name: translate("ui.currentLocation"),
        admin1: "",
        country: "",
        // About 1 km is plenty for a forecast, and the exact spot stays on the phone.
        latitude: Math.round(fix.lat * 100) / 100,
        longitude: Math.round(fix.lon * 100) / 100
      });
      if (fix.stale) setLocationMessage("location.stale", false, { minutes: Math.max(1, Math.round((Date.now() - fix.at) / 60000)) });
    } catch (error) {
      const problem = error instanceof GeoError ? error.problem : "unavailable";
      const blocked = { ios: "location.permissionDeclinedIos", android: "location.permissionDeclinedAndroid", desktop: "location.permissionDeclinedDesktop" };
      const message = problem === "denied" ? blocked[platform()]
        : problem === "timeout" ? "location.timeout"
          : problem === "unsupported" ? "location.unavailable"
            : problem === "insecure" ? "location.insecure"
              : "location.failed";
      setLocationMessage(message, true);
    } finally {
      useLocation.disabled = false;
      useLocation.removeAttribute("aria-busy");
    }
  });

  const formatTime = (value, timezone = "America/Phoenix") => {
    const raw = safeText(value);
    if (!raw) return "—";
    const clock = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (clock) {
      try {
        return new Intl.DateTimeFormat(activeLocale, {
          hour: "numeric",
          minute: Number(clock[2]) === 0 ? undefined : "2-digit",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2020, 0, 1, Number(clock[1]), Number(clock[2]))));
      } catch (_error) {
        return raw;
      }
    }
    const parsedDate = new Date(raw);
    if (!Number.isNaN(parsedDate.getTime()) && /T|Z|GMT|UTC/.test(raw)) {
      try {
        return new Intl.DateTimeFormat(activeLocale, { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(parsedDate);
      } catch (_error) {
        return new Intl.DateTimeFormat(activeLocale, { hour: "numeric", minute: "2-digit" }).format(parsedDate);
      }
    }
    return raw;
  };
  const formatDate = (value, timezone) => {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return safeText(value);
    try {
      return new Intl.DateTimeFormat(activeLocale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
    } catch (_error) {
      return new Intl.DateTimeFormat(activeLocale, { weekday: "long", month: "long", day: "numeric" }).format(date);
    }
  };
  const getPhoenixDate = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Phoenix",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const nextCalendarDate = (value) => {
    const [year, month, day] = value.split("-").map(Number);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  };
  const getSelectedShiftDate = () => dateInputs.find((input) => input.checked)?.value ?? "";
  const refreshShiftDates = () => {
    const today = getPhoenixDate();
    const tomorrow = nextCalendarDate(today);
    const selected = getSelectedShiftDate();
    todayDateInput.value = today;
    tomorrowDateInput.value = tomorrow;
    document.querySelector("#shift-date-today-label").textContent = formatDate(today);
    document.querySelector("#shift-date-tomorrow-label").textContent = formatDate(tomorrow);
    const selectedInput = dateInputs.find((input) => input.value === selected);
    (selectedInput ?? todayDateInput).checked = true;
  };
  refreshShiftDates();
  applyPrefill();
  const formatValue = (value, suffix = "") => {
    const number = Number(value);
    return Number.isFinite(number) ? `${Math.round(number)}${suffix}` : "—";
  };
  const formatWbgt = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return `${Number.isInteger(number) ? number : number.toFixed(1)}°F`;
  };

  let forecastMessage = { key: "", kind: "" };
  const setForecastMessage = (key, kind = "") => {
    forecastMessage = { key, kind };
    const message = key ? translate(key) : "";
    forecastStatus.replaceChildren();
    const text = document.createElement("span");
    text.textContent = message;
    forecastStatus.append(text);
    if (kind === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "retry-button";
      retry.textContent = translate("results.forecastTryAgain");
      retry.addEventListener("click", () => form.requestSubmit());
      forecastStatus.append(document.createElement("br"), retry);
    }
    forecastStatus.dataset.kind = kind;
    forecastStatus.hidden = !message;
  };
  const renderForecastSkeleton = () => {
    forecastRows.replaceChildren();
    for (let index = 0; index < 4; index += 1) {
      const row = document.createElement("tr");
      for (let column = 0; column < 5; column += 1) {
        const cell = document.createElement("td");
        cell.dataset.label = ["hour", "airTemperature", "humidity", "forecastSun", "forecastShade"]
          .map((key) => translate(`results.${key}`))[column];
        const skeleton = document.createElement("span");
        skeleton.className = "skeleton-cell";
        skeleton.setAttribute("aria-hidden", "true");
        cell.append(skeleton);
        row.append(cell);
      }
      forecastRows.append(row);
    }
  };
  const appendCell = (row, label, value, isTemperature = false) => {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (isTemperature) cell.className = "temperature-value";
    cell.textContent = value;
    row.append(cell);
  };
  const renderForecast = (forecast, shiftDetails) => {
    forecastRows.replaceChildren();
    const hours = Array.isArray(forecast.hours) ? forecast.hours : [];
    hours.forEach((hour) => {
      const row = document.createElement("tr");
      appendCell(row, translate("results.hour"), formatTime(hour.time, forecast.timezone));
      appendCell(row, translate("results.airTemperature"), formatValue(hour.airTempF, "°F"), true);
      appendCell(row, translate("results.humidity"), formatValue(hour.humidity, "%"));
      appendCell(row, translate("results.forecastSun"), formatValue(hour.wbgtSunF, "°F"), true);
      appendCell(row, translate("results.forecastShade"), formatValue(hour.wbgtShadeF, "°F"), true);
      forecastRows.append(row);
    });
    document.querySelector("#forecast-location-name").textContent = forecast.locationName || locationNameInput.value;
    document.querySelector("#forecast-date").textContent = translate("results.dateInPhoenix", {
      date: formatDate(forecast.date, forecast.timezone),
    });
    const startTime = formatTime(shiftDetails.startTime);
    const endTime = formatTime(shiftDetails.endTime);
    const isOvernight = shiftDetails.endTime < shiftDetails.startTime;
    document.querySelector("#forecast-shift-hours").textContent = translate("results.shiftHours", {
      start: startTime,
      end: endTime,
      nextDay: isOvernight ? translate("results.nextDay") : "",
    });
    const selectedIntensity = activeModeLocale().taskIntensities.find(({ value }) => value === forecast.intensity);
    if (!selectedIntensity) throw new TypeError(`Intensity "${forecast.intensity}" is not configured for mode "${selectedMode.id}".`);
    document.querySelector("#forecast-intensity").textContent = selectedIntensity.forecastLabel;
    document.querySelector("#forecast-acclimation").textContent = translate(
      forecast.newToHeat ? "results.newToHeat" : "results.heatExperienced",
    );
    const missingHours = Array.isArray(forecast.missingHours)
      ? forecast.missingHours.filter((time) => typeof time === "string" && /^\d{2}:\d{2}$/.test(time))
      : [];
    if (missingHours.length) {
      const readableTimes = missingHours.map((time) => formatTime(time, forecast.timezone));
      forecastPartialNotice.textContent = translate(
        missingHours.length === 1 ? "results.partialForecastSingular" : "results.partialForecastPlural",
        { count: missingHours.length, times: readableTimes.join(", ") },
      );
      forecastPartialNotice.hidden = false;
    } else {
      forecastPartialNotice.textContent = "";
      forecastPartialNotice.hidden = true;
    }
    if (!hours.length) setForecastMessage("results.forecastMissingHours", "error");
    else setForecastMessage("");
  };
  const appendScheduleMetric = (list, label, value) => {
    const metric = document.createElement("div");
    metric.className = "schedule-card-metric";
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    metric.append(term, detail);
    list.append(metric);
  };
  const setScheduleMessage = (key) => {
    setLocalizedText(scheduleStatus, key);
    scheduleStatus.dataset.kind = key ? "error" : "";
    scheduleStatus.hidden = !key;
  };
  const hourEndTime = (time) => {
    const [hour] = time.split(":").map(Number);
    return `${String((hour + 1) % 24).padStart(2, "0")}:00`;
  };
  const appendWaterLine = (parent, cups, varied = false, dailyCapReached = false) => {
    const water = document.createElement("p");
    water.className = "schedule-water";
    const icons = document.createElement("span");
    icons.className = "water-drops";
    icons.setAttribute("aria-hidden", "true");
    for (let count = 0; count < Math.min(cups, 6); count += 1) {
      const drop = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      drop.setAttribute("viewBox", "0 0 24 24");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M12 2C10 6 5 10 5 15a7 7 0 0 0 14 0c0-5-5-9-7-13Z");
      drop.append(path);
      icons.append(drop);
    }
    const text = document.createElement("span");
    text.textContent = translate(
      dailyCapReached && cups === 0 ? "extras.waterDayCap" : cups === 0 ? "results.noWater" : varied ? "results.waterUpTo" : "results.waterPerHour",
      { amount: cups },
    );
    water.append(icons, text);
    parent.append(water);
  };
  const appendWorkAction = (parent, hour) => {
    const action = document.createElement("p");
    action.className = "schedule-action";
    // Hours flagged as stop-work say so plainly instead of showing a work/rest split.
    if (hour.stopWork) {
      action.classList.add("schedule-action-stop");
      action.textContent = activeModeLocale().ui.stopBanner || translate("results.stopWork");
      parent.append(action);
      return;
    }
    action.textContent = hour.work === "NL"
      ? translate("results.workNormally")
      : translate("results.workMinutes", { minutes: hour.work });
    if (hour.restMinutes > 0) {
      action.textContent += ` / ${translate("results.restMinutes", { minutes: hour.restMinutes })}`;
    }
    parent.append(action);
  };
  const renderWorkRestSchedule = (schedule, table, timezone, siteAdjusted = false) => {
    const summary = buildShiftSummary({
      hours: schedule.hours,
      workerName: activeShiftPayload?.workerName || document.querySelector("#worker-name").value.trim(),
      date: activeForecast?.date,
      timezone,
      intensity: activeForecast?.intensity,
      strings: activeModeLocale(),
      formatTime: (time) => formatTime(time, timezone),
    });
    summaryPanel.dataset.category = String(summary.activeCategory);
    summaryTitle.textContent = translate(summary.isToday ? "results.today" : "results.shift");
    summaryGreeting.textContent = summary.greeting;
    summaryRisk.textContent = translate("summary.riskWord", { risk: summary.activeRisk });
    summaryRiskLabel.textContent = translate(summary.currentHourIndex >= 0 ? "results.heatLevel" : "results.startingHeatLevel");
    const coolerAdvice = summary.isToday &&
      selectedMode.rules?.coolerAdviceCategory !== undefined &&
      Math.max(...schedule.hours.map((hour) => hour.category)) >= selectedMode.rules.coolerAdviceCategory
      ? activeModeLocale().ui.coolerAdvice
      : null;
    summaryAdvice.textContent = [summary.message, coolerAdvice].filter(Boolean).join(" ");
    summaryHottest.textContent = summary.hottest;
    const activeHour = schedule.hours[summary.currentHourIndex >= 0 ? summary.currentHourIndex : 0];
    // Show the air temperature people know next to the heat-stress number, so 84°F isn't read as the weather.
    const activeWeather = activeForecast?.hours?.find((weather) => weather.time === activeHour.time);
    const wbgtRounded = Math.round(Number(activeHour.wbgtF));
    summaryWbgt.textContent = Number.isFinite(activeWeather?.airTempF)
      ? translate("extras.readingLine", { air: Math.round(activeWeather.airTempF), wbgt: wbgtRounded })
      : translate("extras.readingWbgt", { wbgt: wbgtRounded });
    todayMeta.textContent = translate(
      summary.currentHourIndex >= 0 ? "results.currentAt" : "results.startingAt",
      {
        time: formatTime(activeHour.time, timezone),
        location: activeForecast?.locationName || activeShiftPayload?.locationName || "",
      },
    );
    hourStripTitle.textContent = translate(summary.isToday ? "results.restOfToday" : "results.restOfShift");
    heatGauge.dataset.category = String(summary.activeCategory);
    heatGauge.setAttribute("aria-label", translate("results.heatGauge", { risk: summary.activeRisk }));
    [...heatGauge.children].forEach((segment, index) => {
      segment.classList.toggle("active", index <= summary.activeCategory);
    });
    summaryPanel.hidden = false;
    void renderCrewStatus(activeShiftPayload?.workerName || document.querySelector("#worker-name").value.trim());
    scheduleCards.replaceChildren();
    let firstHourIndex = 0;
    groupScheduleHours(schedule.hours).forEach((group) => {
      const hour = group.hours[0];
      const card = document.createElement("li");
      card.className = "schedule-card";
      card.dataset.category = String(hour.category);
      card.dataset.startIndex = String(firstHourIndex);
      const isCurrent = summary.currentHourIndex >= firstHourIndex &&
        summary.currentHourIndex < firstHourIndex + group.hours.length;
      card.dataset.current = String(isCurrent);
      // A one-hour block has nothing more to show, so it isn't expandable.
      const single = group.hours.length === 1;
      const expander = document.createElement(single ? "div" : "details");
      expander.className = "schedule-block";
      const blockSummary = document.createElement(single ? "div" : "summary");
      blockSummary.className = "schedule-block-summary";
      const header = document.createElement("div");
      header.className = "schedule-card-header";
      const time = document.createElement("span");
      time.className = "schedule-card-time";
      time.textContent = `${formatTime(hour.time, timezone)}–${formatTime(hourEndTime(group.hours.at(-1).time), timezone)}`;
      const risk = document.createElement("span");
      risk.className = "schedule-card-risk";
      risk.textContent = translate(`risk.${hour.category}`);
      header.append(time, risk);
      if (isCurrent) {
        const nowLabel = document.createElement("span");
        nowLabel.className = "schedule-now";
        nowLabel.textContent = translate("results.now");
        header.append(nowLabel);
      }
      blockSummary.append(header);
      appendWorkAction(blockSummary, hour);
      if (hour.restMinutes > 0 && hour.work !== "NL" && !hour.stopWork) {
        const bar = document.createElement("div");
        bar.className = "work-rest-bar";
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", `${translate("results.workMinutes", { minutes: hour.work })}, ${translate("results.restMinutes", { minutes: hour.restMinutes })}`);
        const work = document.createElement("span");
        work.className = "work-part";
        work.style.width = `${hour.work / (hour.work + hour.restMinutes) * 100}%`;
        const rest = document.createElement("span");
        rest.className = "rest-part";
        rest.style.flex = "1";
        bar.append(work, rest);
        blockSummary.append(bar);
      }
      const waterCups = Math.max(...group.hours.map((item) => item.waterCups));
      appendWaterLine(blockSummary, waterCups, group.hours.some((item) => item.waterCups !== waterCups), group.hours.every((item) => item.dailyCapReached));
      if (single) {
        expander.append(blockSummary);
        card.append(expander);
        scheduleCards.append(card);
        firstHourIndex += 1;
        return;
      }
      const expandHint = document.createElement("span");
      expandHint.className = "schedule-expand-hint";
      expandHint.textContent = translate("results.expandHours");
      blockSummary.append(expandHint);
      const hourList = document.createElement("div");
      hourList.className = "schedule-hour-list";
      group.hours.forEach((item) => {
        const hourRow = document.createElement("section");
        hourRow.className = "schedule-hour";
        const hourTitle = document.createElement("h4");
        hourTitle.textContent = formatTime(item.time, timezone);
        hourRow.append(hourTitle);
        appendWorkAction(hourRow, item);
        appendWaterLine(hourRow, item.waterCups, false, item.dailyCapReached);
        const technical = document.createElement("details");
        technical.className = "hour-technical-details";
        const technicalSummary = document.createElement("summary");
        technicalSummary.textContent = translate("results.details");
        const metrics = document.createElement("dl");
        metrics.className = "schedule-card-metrics";
        appendScheduleMetric(metrics, translate("results.forecastSite"), formatWbgt(item.wbgtF));
        appendScheduleMetric(metrics, translate("results.category"), String(item.category));
        const weatherHour = activeForecast?.hours.find((weather) => weather.time === item.time);
        if (weatherHour) {
          appendScheduleMetric(metrics, translate("results.airTemperature"), formatValue(weatherHour.airTempF, "°F"));
        }
        technical.append(technicalSummary, metrics);
        hourRow.append(technical);
        hourList.append(hourRow);
      });
      expander.addEventListener("toggle", () => {
        expandHint.textContent = translate(expander.open ? "results.hideHours" : "results.expandHours");
      });
      expander.append(blockSummary, hourList);
      card.append(expander);
      scheduleCards.append(card);
      firstHourIndex += group.hours.length;
    });
    renderHourStrip(schedule.hours, timezone, summary);

    // Say exactly when to stop, not just that it's hot at some point.
    const firstStop = schedule.hours.findIndex((hour) => hour.stopWork);
    stopWorkBanner.hidden = firstStop < 0;
    if (firstStop >= 0) {
      let lastStop = firstStop;
      while (schedule.hours[lastStop + 1]?.stopWork) lastStop += 1;
      const span = `${formatTime(schedule.hours[firstStop].time, timezone)}–${formatTime(hourEndTime(schedule.hours[lastStop].time), timezone)}`;
      stopWorkBanner.textContent = `${span}: ${activeModeLocale().ui.stopBanner || translate("results.stopWork")}`;
    }
    schedulePolicyCopy.textContent = translate("results.schedulePolicy");
    document.querySelector("#schedule-technical-policy").textContent = translate("results.scheduleTechnicalPolicy", {
      hourly: schedule.maxWaterCupsPerHour,
      daily: schedule.maxWaterCupsPerDay,
    });
    workRestSource.href = "https://hprc-online.org/resources/tb-med-507-heat-stress-control-and-heat-casualty-management-pdf";
    workRestSection.hidden = false;
    scheduleSiteBadge.hidden = !siteAdjusted;
    setScheduleMessage("");
  };
  const renderHourStrip = (hours, timezone, summary) => {
    hourStrip.replaceChildren();
    hours.forEach((hour, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hour-chip";
      button.dataset.category = String(hour.category);
      const current = index === summary.currentHourIndex;
      button.setAttribute("aria-pressed", String(current));
      const time = document.createElement("strong");
      time.textContent = current ? translate("results.now") : formatTime(hour.time, timezone);
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      const risk = document.createElement("span");
      risk.textContent = translate(`risk.${hour.category}`);
      button.append(time, dot, risk);
      button.addEventListener("click", () => {
        const group = [...scheduleCards.children].find((card) => {
          const start = Number(card.dataset.startIndex);
          const count = card.querySelectorAll(".schedule-hour").length || 1;
          return index >= start && index < start + count;
        });
        if (!group) return;
        const details = group.querySelector(".schedule-block");
        if (details) details.open = true;
        const selectedHour = group.querySelectorAll(".schedule-hour")[index - Number(group.dataset.startIndex)];
        (selectedHour || group).scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
      });
      hourStrip.append(button);
    });
  };
  const renderCrewStatus = async (workerName) => {
    crewStatus.replaceChildren();
    try {
      const [crew, checkins] = await Promise.all([getCrew(), getCheckins()]);
      const ownName = workerName || (await getProfile())?.name || "";
      const people = [
        ...(ownName ? [{ name: ownName, self: true }] : []),
        ...crew.filter((member) => member.name && member.name.toLocaleLowerCase() !== ownName.toLocaleLowerCase())
          .map((member) => ({ name: member.name, self: false })),
      ];
      const checkedInToday = new Set(
        checkins.filter((entry) => getPhoenixDateFor(entry.time) === getPhoenixDate())
          .map((entry) => entry.workerName.toLocaleLowerCase()),
      );
      const latest = new Map();
      [...checkins].sort((a,b)=>b.time.localeCompare(a.time)).filter((entry)=>getPhoenixDateFor(entry.time) === getPhoenixDate()).forEach((entry)=>{
        const key = entry.workerName.toLocaleLowerCase();
        if (!latest.has(key)) latest.set(key,entry.level);
      });
      people.sort((a,b)=>Number(latest.get(b.name.toLocaleLowerCase()) === "DANGER")-Number(latest.get(a.name.toLocaleLowerCase()) === "DANGER")).forEach((person) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "crew-person";
        item.dataset.safety = latest.get(person.name.toLocaleLowerCase()) || "";
        item.dataset.checkedIn = String(checkedInToday.has(person.name.toLocaleLowerCase()));
        item.addEventListener("click",()=>{
          if (window.parent !== window) window.parent.postMessage({type:"sombra:check-in",workerName:person.name},window.location.origin);
          else window.location.assign(`${import.meta.env.BASE_URL}app/check-in?worker=${encodeURIComponent(person.name)}`);
        });
        const ring = document.createElement("span");
        ring.className = "crew-ring";
        const initials = document.createElement("span");
        initials.textContent = person.name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
        ring.append(initials);
        const label = document.createElement("small");
        label.textContent = person.self ? translate("ui.you") : person.name;
        item.append(ring, label);
        const level = latest.get(person.name.toLocaleLowerCase());
        if (["OK","CAUTION","DANGER"].includes(level)) {
          const status = document.createElement("small");
          status.textContent = translate(`checkIn.level_${level}`);
          item.append(status);
        }
        crewStatus.append(item);
      });
      // Solo users never see group rings; they appear once someone else is added.
      crewStatus.hidden = !people.some((person) => !person.self);
    } catch {
      crewStatus.hidden = false;
      crewStatus.textContent = translate("ui.crewStatusUnavailable");
    }
  };
  const getPhoenixDateFor = (value) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Phoenix",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const getSiteSelection = () => ({
    surface: siteCheck.querySelector('input[name="site-surface"]:checked')?.value ?? null,
    shade: siteCheck.querySelector('input[name="site-shade"]:checked')?.value ?? null,
  });
  const setSiteAdjustmentStatus = (key, kind = "") => {
    setLocalizedText(siteAdjustmentStatus, key);
    siteAdjustmentStatus.dataset.kind = kind;
    siteAdjustmentStatus.hidden = !key;
  };
  const renderScheduleFromForecast = (forecast, siteAdjusted = false) => {
    if (!forecast) return;
    activeForecast = forecast;
    const schedule = buildWorkRestSchedule({
      hours: forecast.hours.map((hour) => ({
        time: hour.time,
        wbgtF: hour.wbgtSiteF ?? hour.wbgtSunF,
      })),
      intensity: forecast.intensity,
      newToHeat: forecast.newToHeat,
      categoryIncrease: effectiveCategoryIncrease(),
      stopAtExtreme: selectedMode.rules?.stopAtExtreme === true,
      table: workRestTable,
    });
    latestSchedule = schedule;
    if (window.parent !== window) {
      // Lets the Today screen suggest the right tool (for example, Best time when it gets very hot).
      window.parent.postMessage({ type: "sombra:summary", maxCategory: Math.max(...schedule.hours.map((hour) => hour.category)) }, window.location.origin);
    }
    profileCaution.hidden = personalRiskFactors().length === 0;
    renderWorkRestSchedule(schedule, workRestTable, forecast.timezone, siteAdjusted);
    renderBringList();
  };

  // --- Outdoor conditions (official alerts, UV, air quality) and what to bring ---
  let latestSchedule = null;
  let latestConditions = null;
  let conditionsRequest = 0;
  const conditionsPanel = document.querySelector("#conditions-panel");
  const conditionsAlerts = document.querySelector("#conditions-alerts");
  const conditionsDust = document.querySelector("#conditions-dust");
  const bringPanel = document.querySelector("#bring-panel");
  const bringList = document.querySelector("#bring-list");
  const profileCaution = document.querySelector("#profile-caution");
  const formatAlertEnd = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(activeLocale, {
      weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix",
    }).format(date);
  };
  const renderConditions = () => {
    const data = latestConditions;
    if (!data) {
      conditionsPanel.hidden = true;
      return;
    }
    conditionsAlerts.replaceChildren();
    // Inside the app, heat warnings already have their own card at the top of Today; don't repeat them here.
    const embedded = window.parent !== window;
    const alerts = Array.isArray(data.alerts) ? data.alerts.filter((alert) => !(embedded && alert.kind === "heat")) : null;
    const heatShownAbove = Array.isArray(data.alerts) && alerts.length < data.alerts.length;
    if (alerts && alerts.length) {
      alerts.forEach((alert) => {
        const item = document.createElement("div");
        item.className = `alert-item alert-${alert.kind}`;
        const title = document.createElement("strong");
        title.textContent = alert.event;
        const meta = document.createElement("small");
        meta.textContent = [translate("extras.alertSource"), alert.ends ? translate("extras.until", { time: formatAlertEnd(alert.ends) }) : ""]
          .filter(Boolean).join(" · ");
        item.append(title, meta);
        conditionsAlerts.append(item);
      });
    } else if (!heatShownAbove) {
      const none = document.createElement("p");
      none.className = "alerts-none";
      none.textContent = translate(Array.isArray(data.alerts) ? "extras.alertsNone" : "extras.alertsUnavailable");
      conditionsAlerts.append(none);
    }
    const air = data.air;
    const uvTile = document.querySelector("#uv-tile");
    const aqiTile = document.querySelector("#aqi-tile");
    uvTile.hidden = !(air && air.uv && air.uv.level);
    aqiTile.hidden = !(air && air.aqi && air.aqi.level);
    if (!uvTile.hidden) {
      uvTile.dataset.level = air.uv.level;
      document.querySelector("#uv-level").textContent = translate(`extras.uv_${air.uv.level}`);
      document.querySelector("#uv-peak").textContent = translate("extras.uvPeak", { value: Math.round(air.uv.peak), time: formatTime(air.uv.peakTime) });
    }
    if (!aqiTile.hidden) {
      aqiTile.dataset.level = air.aqi.level;
      document.querySelector("#aqi-level").textContent = translate(`extras.aqi_${air.aqi.level}`);
      document.querySelector("#aqi-peak").textContent = translate("extras.aqiPeak", { value: Math.round(air.aqi.peak), time: formatTime(air.aqi.peakTime) });
    }
    conditionsDust.hidden = !(air && Number.isFinite(air.dustPeak) && air.dustPeak >= 100);
    // Alerts explain themselves when tapped too.
    conditionsAlerts.querySelectorAll(".alert-item").forEach((item) => {
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      const show = () => showConditionMeaning(item, translate("extras.alertMean"));
      item.addEventListener("click", show);
      item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); show(); } });
    });
    conditionMeaning.hidden = true;
    conditionHint.hidden = uvTile.hidden && aqiTile.hidden;
    conditionsPanel.hidden = false;
  };
  const conditionMeaning = document.querySelector("#condition-meaning");
  const conditionHint = document.querySelector("#condition-hint");
  let meaningOwner = null;
  const showConditionMeaning = (owner, text) => {
    const closing = meaningOwner === owner && !conditionMeaning.hidden;
    document.querySelectorAll(".condition-tile").forEach((tile) => tile.setAttribute("aria-expanded", "false"));
    if (closing) {
      conditionMeaning.hidden = true;
      meaningOwner = null;
      return;
    }
    if (owner.classList.contains("condition-tile")) owner.setAttribute("aria-expanded", "true");
    conditionMeaning.textContent = text;
    conditionMeaning.hidden = false;
    conditionHint.hidden = true;
    meaningOwner = owner;
  };
  document.querySelector("#uv-tile").addEventListener("click", (event) => {
    const level = latestConditions?.air?.uv?.level;
    if (level) showConditionMeaning(event.currentTarget, translate(`extras.uvMean_${level}`));
  });
  document.querySelector("#aqi-tile").addEventListener("click", (event) => {
    const level = latestConditions?.air?.aqi?.level;
    if (level) showConditionMeaning(event.currentTarget, translate(`extras.aqiMean_${level}`));
  });
  const loadConditions = async (latitude, longitude) => {
    const request = ++conditionsRequest;
    latestConditions = null;
    conditionsPanel.hidden = true;
    try {
      const response = await fetch(`/api/conditions?${roundedQuery({ lat: latitude, lon: longitude })}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("conditions");
      const data = await response.json();
      if (request !== conditionsRequest) return;
      latestConditions = data;
    } catch {
      if (request !== conditionsRequest) return;
      latestConditions = null;
    }
    renderConditions();
    renderBringList();
  };
  let latestBringItems = [];
  const bringStatus = document.querySelector("#bring-status");
  document.querySelector("#bring-share").addEventListener("click", async () => {
    if (!latestBringItems.length) return;
    const place = activeShiftPayload?.locationName ? ` (${activeShiftPayload.locationName})` : "";
    const text = `${translate("extras.shareTitle")}${place}\n${latestBringItems.map((item) => `• ${item}`).join("\n")}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: translate("extras.shareTitle"), text });
        return;
      }
      await navigator.clipboard.writeText(text);
      bringStatus.textContent = translate("extras.copied");
      bringStatus.hidden = false;
    } catch {
      // Sharing was cancelled; nothing to do.
    }
  });
  const renderBringList = () => {
    if (!latestSchedule || !latestSchedule.hours.length) {
      bringPanel.hidden = true;
      return;
    }
    const hours = latestSchedule.hours;
    const maxCategory = Math.max(...hours.map((hour) => hour.category));
    const cups = latestSchedule.totalWaterCups;
    const air = latestConditions?.air;
    const uvPeak = air?.uv?.peak;
    const site = appliedSiteSelection;
    const liters = Math.round(cups * 0.2366 * 2) / 2;
    const gallons = Math.max(0.5, Math.round((liters / 3.785) * 2) / 2);
    // Only items this plan actually calls for; generic advice lives elsewhere.
    const items = [
      translate("extras.bringWater", { liters: liters.toLocaleString(activeLocale), gallons: gallons.toLocaleString(activeLocale) }),
    ];
    if (hours.length >= 2 && maxCategory >= 2) items.push(translate("extras.bringElectrolytes"));
    if (uvPeak == null ? maxCategory >= 1 : uvPeak >= 6) items.push(translate("extras.bringHat"));
    if (uvPeak == null || uvPeak >= 3) items.push(translate("extras.bringSunscreen"));
    if (maxCategory >= 3) items.push(translate("extras.bringTowel"));
    if (site ? site.shade === "full_sun" : maxCategory >= 3) items.push(translate("extras.bringShade"));
    if (site && ["dark_roof", "asphalt"].includes(site.surface)) items.push(translate("extras.bringGloves"));
    if (air && ((air.aqi?.peak ?? 0) > 100 || (air.dustPeak ?? 0) >= 100)) items.push(translate("extras.bringMask"));
    // Tap an item to tick it off while packing. Ticks are remembered for this plan on this device.
    const planKey = `sombra.bring:${activeShiftPayload?.date ?? ""}:${activeShiftPayload?.latitude ?? ""},${activeShiftPayload?.longitude ?? ""}`;
    let ticked = [];
    try { ticked = JSON.parse(localStorage.getItem(planKey) || "[]"); } catch { ticked = []; }
    latestBringItems = items;
    bringList.replaceChildren(...items.map((text, index) => {
      const item = document.createElement("li");
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.setAttribute("aria-pressed", String(ticked.includes(index)));
      toggle.textContent = text;
      toggle.addEventListener("click", () => {
        const on = toggle.getAttribute("aria-pressed") !== "true";
        toggle.setAttribute("aria-pressed", String(on));
        ticked = on ? [...new Set([...ticked, index])] : ticked.filter((value) => value !== index);
        try { localStorage.setItem(planKey, JSON.stringify(ticked)); } catch { /* ticks just won't be remembered */ }
      });
      item.append(toggle);
      return item;
    }));
    bringPanel.hidden = false;
  };
  const resetSiteAdjustment = () => {
    siteCheck.hidden = true;
    sitePhotoPanel.hidden = true;
    sitePhotoInput.value = "";
    siteModelProgress.hidden = true;
    siteModelProgress.value = 0;
    siteModelStatus.hidden = true;
    setLocalizedText(siteModelStatus, "");
    siteAdjustmentPanel.hidden = true;
    setLocalizedText(sitePredictionNote, "results.siteChooseStart");
    sitePredictionChips.replaceChildren();
    siteCheck.querySelectorAll('input[name="site-surface"], input[name="site-shade"]').forEach((input) => {
      input.checked = false;
    });
    siteHotSurfaceWarning.hidden = true;
    siteApplyButton.disabled = true;
    siteApplyButton.textContent = translate("results.siteApply");
    setSiteAdjustmentStatus("");
    siteAdjustedResults.hidden = true;
    siteComparisonRows.replaceChildren();
    siteAdjustmentDescription.textContent = "";
    scheduleSiteBadge.hidden = true;
    siteAdjustmentApplied = false;
    appliedSiteSelection = null;
    siteComparison = null;
    latestSitePredictions = null;
  };
  const siteCategoryLabel = (key) => {
    if (Object.hasOwn(activeModeLocale().surface, key)) return translate(`surface.${key}`);
    if (Object.hasOwn(activeModeLocale().shade, key)) return translate(`shade.${key}`);
    return translate("results.siteNoMatch");
  };
  const refreshSiteChoices = () => {
    const { surface, shade } = getSiteSelection();
    siteHotSurfaceWarning.hidden = !siteAdjustments.hot_surface_warning.includes(surface);
    siteApplyButton.disabled = !surface || !shade || siteApplyButton.getAttribute("aria-busy") === "true";
    if (
      siteAdjustmentApplied &&
      (!appliedSiteSelection ||
        appliedSiteSelection.surface !== surface ||
        appliedSiteSelection.shade !== shade)
    ) {
      siteAdjustmentApplied = false;
      appliedSiteSelection = null;
      siteAdjustedResults.hidden = true;
      siteComparison = null;
      if (baseForecast) renderScheduleFromForecast(baseForecast);
    }
  };
  const updateSiteModelProgress = (progress) => {
    siteModelProgress.hidden = false;
    const status = progress?.status || "";
    const percentage = Number(progress?.progress);
    if (Number.isFinite(percentage)) {
      const normalized = percentage >= 0 && percentage <= 1 ? percentage * 100 : percentage;
      siteModelProgress.value = Math.max(0, Math.min(100, normalized));
      setLocalizedText(siteModelStatus, "results.siteDownload", { percent: Math.round(siteModelProgress.value) });
    } else if (status === "done") {
      setLocalizedText(siteModelStatus, "results.siteModelReady");
    } else {
      setLocalizedText(siteModelStatus, "results.sitePreparing");
    }
    siteModelStatus.hidden = false;
  };
  const ensureSiteClassifier = async () => {
    if (siteClassifier) return siteClassifier;
    if (!siteClassifierPromise) {
      siteModelProgress.hidden = false;
      siteModelProgress.value = 0;
      setLocalizedText(siteModelStatus, "results.siteStarting");
      siteModelStatus.hidden = false;
      siteClassifierPromise = (async () => {
        if (!visionModule) visionModule = await import("./js/vision.js");
        return visionModule.createSiteImageClassifier(updateSiteModelProgress);
      })()
        .then((classifier) => {
          siteClassifier = classifier;
          siteModelProgress.hidden = true;
          setLocalizedText(siteModelStatus, "results.sitePhotoReady");
          siteModelStatus.hidden = false;
          return classifier;
        })
        .catch((error) => {
          siteClassifierPromise = null;
          throw error;
        });
    }
    return siteClassifierPromise;
  };
  const renderSitePredictions = (predictions, selectGuesses = true) => {
    latestSitePredictions = predictions;
    sitePredictionChips.replaceChildren();
    const dimensions = [
      ["surface", predictions.surface],
      ["shade", predictions.shade],
    ];
    const uncertain = [];
    for (const [dimension, prediction] of dimensions) {
      const confident = isHighConfidence(prediction);
      const chip = document.createElement("span");
      chip.className = "site-prediction-chip";
      const label = siteCategoryLabel(prediction?.key);
      const score = Math.round((prediction?.score || 0) * 100);
      const dimensionLabel = translate(dimension === "surface" ? "results.siteSurface" : "results.siteShade");
      chip.textContent = `${dimensionLabel}: ${label} (${score}%)`;
      sitePredictionChips.append(chip);
      if (confident && selectGuesses) {
        const radio = siteCheck.querySelector(
          `input[name="site-${dimension}"][value="${prediction.key}"]`,
        );
        if (radio) radio.checked = true;
      } else if (!confident) {
        uncertain.push(dimension);
      }
    }
    siteAdjustmentPanel.hidden = false;
    const localizedDimensions = uncertain.map((item) =>
      translate(`results.site${item === "surface" ? "Surface" : "Shade"}`),
    ).join(` ${activeModeLocale().ui.listSeparator} `);
    setLocalizedText(sitePredictionNote,
      uncertain.length
        ? uncertain.length === 1 ? "results.siteChooseLowConfidence" : "results.siteChooseLowConfidencePlural"
        : "results.siteReviewGuesses",
      { dimensions: localizedDimensions },
    );
    refreshSiteChoices();
  };
  const renderSiteComparison = (before, after, selection) => {
    const beforeByTime = new Map(
      before.hours.map((hour) => [hour.time, hour.wbgtSiteF ?? hour.wbgtSunF]),
    );
    const comparableHours = after.hours.filter(
      (hour) => beforeByTime.has(hour.time) && Number.isFinite(hour.wbgtSiteF),
    );
    if (!comparableHours.length) {
      throw new Error(translate("results.invalidSiteForecast"));
    }
    siteComparisonRows.replaceChildren();
    for (const hour of comparableHours) {
      const row = document.createElement("tr");
      appendCell(row, translate("results.siteCompareHour"), formatTime(hour.time, after.timezone));
      appendCell(row, translate("results.siteBefore"), formatWbgt(beforeByTime.get(hour.time)));
      appendCell(row, translate("results.siteAtWorkArea"), formatWbgt(hour.wbgtSiteF));
      siteComparisonRows.append(row);
    }
    const feelsHotter = comparableHours.some(
      (hour) => hour.wbgtSiteF > beforeByTime.get(hour.time) + 0.1,
    );
    siteAdjustmentDescription.textContent = translate(
      feelsHotter ? "results.siteAdjustedSentence" : "results.siteAdjustedNeutralSentence",
      {
        surface: siteCategoryLabel(selection.surface),
        shade: siteCategoryLabel(selection.shade),
      },
    );
    siteComparison = { before, after, selection: { ...selection } };
    siteAdjustedResults.hidden = false;
  };
  const applySiteAdjustment = async () => {
    if (!activeShiftPayload || !baseForecast) {
      setSiteAdjustmentStatus("results.sitePlanFirst", "error");
      return;
    }
    const selection = getSiteSelection();
    let factors;
    try {
      factors = resolveSiteFactors(siteAdjustments, selection.surface, selection.shade);
    } catch (error) {
      setSiteAdjustmentStatus("results.siteChooseStart", "error");
      return;
    }
    siteApplyButton.disabled = true;
    siteApplyButton.setAttribute("aria-busy", "true");
    siteApplyButton.textContent = translate("results.siteApplying");
    setSiteAdjustmentStatus("results.siteRecalculating");
    try {
      const response = await fetch("/api/weather/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...activeShiftPayload, ...factors }),
      });
      let data;
      try {
        data = await response.json();
      } catch (_error) {
        data = null;
      }
      if (!response.ok) {
        throw new Error(translate("results.siteApplyFailed"));
      }
      if (
        !data ||
        !Array.isArray(data.hours) ||
        data.hours.some((hour) => !Number.isFinite(hour.wbgtSiteF))
      ) {
        throw new Error(translate("results.siteIncomplete"));
      }
      renderSiteComparison(baseForecast, data, selection);
      renderForecast(data, activeShiftPayload);
      renderScheduleFromForecast(data, true);
      siteAdjustmentApplied = true;
      appliedSiteSelection = { ...selection };
      renderBringList();
      siteCheck.hidden = true;
      setSiteAdjustmentStatus("results.siteAppliedStatus");
      await persistPlan({ ...activeShiftPayload, ...factors }, data);
    } catch (error) {
      setSiteAdjustmentStatus("results.siteApplyFailed", "error");
    } finally {
      siteApplyButton.removeAttribute("aria-busy");
      siteApplyButton.textContent = translate("results.siteApply");
      refreshSiteChoices();
    }
  };
  const setLoading = (loading) => {
    submitButton.disabled = loading;
    submitButton.setAttribute("aria-busy", String(loading));
    submitButton.querySelector(".button-label").textContent = translate(loading ? "results.forecastLoading" : "results.planMyShift");
  };
  const validate = () => {
    const workerName = document.querySelector("#worker-name").value.trim();
    const intensity = form.querySelector('input[name="intensity"]:checked')?.value;
    const newToHeatValue = form.querySelector('input[name="newToHeat"]:checked')?.value;
    const startTime = document.querySelector("#start-time").value;
    const endTime = document.querySelector("#end-time").value;
    const date = getSelectedShiftDate();
    if (!selectedLocation) return "validation.location";
    if (!workerName) return "validation.workerName";
    if (!intensity) return "validation.intensity";
    if (!startTime || !endTime) return "validation.shiftTimes";
    if (startTime === endTime) return "validation.sameTime";
    if (!date) return "validation.shiftDate";
    if (!newToHeatValue) return "validation.newToHeat";
    return null;
  };

  const openSitePhotoStep = async () => {
    sitePhotoPanel.hidden = false;
    if (siteClassifier) {
      siteModelProgress.hidden = true;
      setLocalizedText(siteModelStatus, "results.sitePhotoReady");
      siteModelStatus.hidden = false;
      return;
    }
    siteModelStatus.hidden = false;
    siteModelProgress.hidden = false;
    try {
      await ensureSiteClassifier();
    } catch (_error) {
      siteModelProgress.hidden = true;
      setLocalizedText(siteModelStatus, "results.sitePhotoStartFailed");
      siteModelStatus.hidden = false;
      siteAdjustmentPanel.hidden = false;
      setLocalizedText(sitePredictionNote, "results.sitePhotoUnavailable");
    }
  };
  const analyzeSitePhoto = async (file) => {
    if (!file) return;
    siteAdjustmentPanel.hidden = true;
    sitePredictionChips.replaceChildren();
    siteCheck.querySelectorAll('input[name="site-surface"], input[name="site-shade"]').forEach((input) => {
      input.checked = false;
    });
    refreshSiteChoices();
    setLocalizedText(siteModelStatus, "results.siteAnalyze");
    siteModelStatus.hidden = false;
    try {
      const classifier = await ensureSiteClassifier();
      const predictions = await visionModule.classifySitePhoto(file, classifier);
      renderSitePredictions(predictions);
      setLocalizedText(siteModelStatus, "results.sitePhotoComplete");
      siteModelStatus.hidden = false;
    } catch (_error) {
      siteModelProgress.hidden = true;
      setLocalizedText(siteModelStatus, "results.sitePhotoFailed");
      siteModelStatus.hidden = false;
      siteAdjustmentPanel.hidden = false;
      setLocalizedText(sitePredictionNote, "results.sitePhotoCouldNotRead");
      refreshSiteChoices();
    }
  };

  sitePhotoOpen.addEventListener("click", () => {
    openSitePhotoStep();
    sitePhotoInput.click();
  });
  siteManualOpen.addEventListener("click", () => {
    siteAdjustmentPanel.hidden = false;
    setLocalizedText(sitePredictionNote, "results.siteChooseStart");
    refreshSiteChoices();
  });
  sitePhotoInput.addEventListener("change", () => {
    const file = sitePhotoInput.files?.[0];
    sitePhotoInput.value = "";
    if (file) analyzeSitePhoto(file);
  });
  siteCheck.querySelectorAll('input[name="site-surface"], input[name="site-shade"]').forEach((input) => {
    input.addEventListener("change", refreshSiteChoices);
  });
  siteApplyButton.addEventListener("click", applySiteAdjustment);
  siteEditAdjustment.addEventListener("click", () => {
    siteCheck.hidden = false;
    siteAdjustmentPanel.hidden = false;
    siteCheck.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
    siteCheck.querySelector('input[name="site-surface"]:checked')?.focus({ preventScroll: true });
  });
  languageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeLocale = button.dataset.locale;
      try {
        localStorage.setItem("sombra.locale", activeLocale);
      } catch {
        // Language selection still works for this session.
      }
      applyTranslations();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.hidden = true;
    refreshShiftDates();
    activeShiftPayload = null;
    baseForecast = null;
    activeForecast = null;
    summaryPanel.hidden = true;
    resetSiteAdjustment();
    workRestSection.hidden = true;
    stopWorkBanner.hidden = true;
    scheduleCards.replaceChildren();
    setScheduleMessage("");
    const error = validate();
    if (error) {
      setLocalizedText(formError, error);
      formError.hidden = false;
      const firstMissing = !selectedLocation ? locationInput :
        !document.querySelector("#worker-name").value.trim() ? document.querySelector("#worker-name") :
        !form.querySelector('input[name="intensity"]:checked') ? form.querySelector('input[name="intensity"]') :
        !form.querySelector('input[name="newToHeat"]:checked') ? form.querySelector('input[name="newToHeat"]') : document.querySelector("#start-time");
      firstMissing.focus();
      return;
    }
    const payload = {
      workerName: document.querySelector("#worker-name").value.trim(),
      locationName: locationNameInput.value,
      latitude: Number(latitudeInput.value),
      longitude: Number(longitudeInput.value),
      intensity: form.querySelector('input[name="intensity"]:checked').value,
      startTime: document.querySelector("#start-time").value,
      endTime: document.querySelector("#end-time").value,
      date: getSelectedShiftDate(),
      newToHeat: form.querySelector('input[name="newToHeat"]:checked').value === "yes"
    };
    // Remember the place so Tools (best time, cool spots) can start from it.
    try {
      localStorage.setItem("sombra.last-place", JSON.stringify({ lat: payload.latitude, lon: payload.longitude, name: payload.locationName }));
    } catch {
      // Tools will simply ask for a location.
    }
    setLoading(true);
    results.hidden = false;
    renderForecastSkeleton();
    forecastPartialNotice.textContent = "";
    forecastPartialNotice.hidden = true;
    setForecastMessage("results.forecastLoading", "loading");
    if (!reduceMotion.matches) results.scrollIntoView({ behavior: "smooth", block: "start" });
    let forecastErrorKey = "results.forecastConnectionError";
    try {
      const response = await fetch("/api/weather/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      let data;
      try {
        data = await response.json();
      } catch (_error) {
        data = null;
      }
      if (!response.ok) {
        forecastErrorKey = "results.forecastLoadedError";
        throw new Error(forecastErrorKey);
      }
      if (!data || !Array.isArray(data.hours)) {
        forecastErrorKey = "results.forecastIncomplete";
        throw new Error(forecastErrorKey);
      }
      activeShiftPayload = payload;
      baseForecast = data;
      document.body.classList.add("has-plan");
      siteCheck.hidden = false;
      renderForecast(data, payload);
      void loadConditions(payload.latitude, payload.longitude);
      try {
        renderScheduleFromForecast(data);
      } catch (scheduleError) {
        workRestSection.hidden = false;
        setScheduleMessage("results.scheduleUnavailable");
      }
      await persistPlan(payload, data);
    } catch (error) {
      setForecastMessage(forecastErrorKey, "error");
    } finally {
      setLoading(false);
    }
  });
  document.querySelector("#edit-shift").addEventListener("click", () => {
    document.body.classList.remove("has-plan");
    if (!reduceMotion.matches) window.scrollTo({ top: 0, behavior: "smooth" });
    locationInput.focus({ preventScroll: true });
  });
  document.querySelector("#print-brief").addEventListener("click", () => window.print());
  let printDetailsState = [];
  window.addEventListener("beforeprint", () => {
    if (printDetailsState.length) return;
    printDetailsState = ["#forecast-details", "#site-comparison-details"].map((selector) => {
      const disclosure = document.querySelector(selector);
      const wasOpen = disclosure.open;
      disclosure.open = true;
      return { disclosure, wasOpen };
    });
  });
  window.addEventListener("afterprint", () => {
    printDetailsState.forEach(({ disclosure, wasOpen }) => {
      disclosure.open = wasOpen;
    });
    printDetailsState = [];
  });
  const summaryClockKey = () => `${getPhoenixDate()}-${new Intl.DateTimeFormat("en", {
      timeZone: "America/Phoenix",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date())}`;
  let lastSummaryHour = summaryClockKey();
  window.setInterval(() => {
    const currentHour = summaryClockKey();
    if (currentHour !== lastSummaryHour && activeForecast && activeShiftPayload) {
      renderScheduleFromForecast(activeForecast, siteAdjustmentApplied);
    }
    lastSummaryHour = currentHour;
  }, 60000);
  if (window.parent !== window) {
    const reportHeight = () => {
      window.parent.postMessage(
        { type: "sombra:planner-height", height: document.querySelector(".page-shell").scrollHeight + 24 },
        window.location.origin,
      );
    };
    new ResizeObserver(reportHeight).observe(document.querySelector(".page-shell"));
    window.parent.postMessage({ type: "sombra:planner-ready" }, window.location.origin);
    reportHeight();
  }
})();
