function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return value > 0 ? max : min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function clampZoom(value: number): number {
  return Math.max(50, Math.min(200, Number.isFinite(value) ? value : value > 0 ? 200 : 50));
}

export function clampAutoSaveInterval(value: number): number {
  return clampValue(value, 500, 30000);
}
