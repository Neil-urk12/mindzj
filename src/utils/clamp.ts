import { ZOOM_MIN, ZOOM_MAX, AUTO_SAVE_MIN_MS, AUTO_SAVE_MAX_MS } from "../constants/timeouts";

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return value > 0 ? max : min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clampZoom(value: number): number {
  return clampValue(value, ZOOM_MIN, ZOOM_MAX);
}

export function clampAutoSaveInterval(value: number): number {
  return clampValue(value, AUTO_SAVE_MIN_MS, AUTO_SAVE_MAX_MS);
}
