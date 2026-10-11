export const LOW_CONFIDENCE_THRESHOLD = 0.4;

export function bestCategoryScore(predictions, categories) {
  if (!Array.isArray(predictions) || !categories || typeof categories !== "object") {
    throw new TypeError("Predictions and category prompts are required.");
  }

  const scoresByLabel = new Map(
    predictions
      .filter((prediction) =>
        prediction &&
        typeof prediction.label === "string" &&
        Number.isFinite(prediction.score)
      )
      .map((prediction) => [prediction.label, prediction.score]),
  );

  const grouped = Object.entries(categories).map(([key, prompts]) => {
    let score = 0;
    let matchedPrompt = null;
    for (const prompt of prompts) {
      const candidateScore = scoresByLabel.get(prompt);
      if (Number.isFinite(candidateScore) && candidateScore > score) {
        score = candidateScore;
        matchedPrompt = prompt;
      }
    }
    return { key, score, matchedPrompt };
  });

  grouped.sort((a, b) => b.score - a.score);
  return grouped[0] ?? null;
}

export function resolveSiteFactors(config, surface, shade) {
  const siteAlbedo = config?.albedo?.[surface] ?? config?.albedo?.default;
  const solarMultiplier = config?.solar_multiplier?.[shade];
  if (!Number.isFinite(siteAlbedo) || siteAlbedo < 0 || siteAlbedo > 1) {
    throw new TypeError("Choose a valid surface before adjusting the forecast.");
  }
  if (
    !Number.isFinite(solarMultiplier) ||
    solarMultiplier < 0 ||
    solarMultiplier > 1
  ) {
    throw new TypeError("Choose a valid shade level before adjusting the forecast.");
  }
  return { siteAlbedo, solarMultiplier };
}

export function isHighConfidence(prediction) {
  return Boolean(
    prediction &&
      Number.isFinite(prediction.score) &&
      prediction.score >= LOW_CONFIDENCE_THRESHOLD,
  );
}
