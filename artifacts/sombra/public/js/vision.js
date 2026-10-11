import clipLabels from "../config/clip_labels.json";
import { bestCategoryScore } from "../../lib/site-classification.js";

const TRANSFORMERS_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
const MODEL_ID = "Xenova/clip-vit-base-patch32";
const MAX_IMAGE_EDGE = 512;

export async function createSiteImageClassifier(progressCallback = () => {}) {
  const { env, pipeline } = await import(/* @vite-ignore */ TRANSFORMERS_MODULE_URL);
  env.useBrowserCache = true;
  return pipeline("zero-shot-image-classification", MODEL_ID, {
    dtype: "q8",
    progress_callback: progressCallback,
  });
}

async function resizeImageLocally(file) {
  if (!(file instanceof Blob) || !file.type.startsWith("image/")) {
    throw new TypeError("Choose a supported image file.");
  }

  let source;
  let releaseSource = () => {};
  if (typeof createImageBitmap === "function") {
    source = await createImageBitmap(file);
    releaseSource = () => source.close();
  } else {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    try {
      await image.decode();
      source = image;
      releaseSource = () => URL.revokeObjectURL(objectUrl);
    } catch (error) {
      URL.revokeObjectURL(objectUrl);
      throw error;
    }
  }

  try {
    const scale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(source.width, source.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not prepare the photo.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    releaseSource();
  }
}

export async function classifySitePhoto(file, classifier) {
  if (typeof classifier !== "function") {
    throw new TypeError("The on-device photo model is not ready.");
  }

  const image = await resizeImageLocally(file);
  try {
    const surfacePrompts = Object.values(clipLabels.surface).flat();
    const shadePrompts = Object.values(clipLabels.shade).flat();

    const surfaceScores = await classifier(image, surfacePrompts);
    const shadeScores = await classifier(image, shadePrompts);

    return {
      surface: bestCategoryScore(surfaceScores, clipLabels.surface),
      shade: bestCategoryScore(shadeScores, clipLabels.shade),
    };
  } finally {
    image.width = 0;
    image.height = 0;
  }
}
