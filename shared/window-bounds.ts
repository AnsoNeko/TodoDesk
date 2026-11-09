import type { Bounds } from './model';
export function visibleBounds(
  saved: Bounds | undefined,
  areas: Bounds[],
  compact: boolean,
): Bounds {
  const primary = areas[0] ?? { x: 0, y: 0, width: 1280, height: 800 };
  const candidate = saved ?? {
    x: primary.x + (compact ? primary.width - 390 : 80),
    y: primary.y + 60,
    width: compact ? 360 : 1140,
    height: compact ? 560 : 780,
  };
  const area =
    areas.find(
      (a) =>
        candidate.x < a.x + a.width &&
        candidate.x + candidate.width > a.x &&
        candidate.y < a.y + a.height &&
        candidate.y + candidate.height > a.y,
    ) ?? primary;
  const width = Math.min(area.width, Math.max(compact ? 320 : 760, candidate.width));
  const height = Math.min(area.height, Math.max(compact ? 360 : 540, candidate.height));
  return {
    width,
    height,
    x: Math.round(Math.max(area.x, Math.min(candidate.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(candidate.y, area.y + area.height - height))),
  };
}
