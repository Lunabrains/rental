import { shortHash } from "@/lib/data/ids";
import { cn } from "@/lib/utils";
import type { Property } from "@/types";

/**
 * Deterministic elevation drawing of a building: floors × units-per-floor
 * windows on a tinted sky. No external images, so the demo never depends on
 * the network.
 */
export function BuildingArt({ property, className }: { property: Property; className?: string }) {
  const seed = parseInt(shortHash(property.code), 36);
  const hue = 200 + (seed % 40); // cool blue-greys
  const sky = `oklch(0.94 0.02 ${hue})`;
  const skyDeep = `oklch(0.86 0.04 ${hue})`;
  const wall = `oklch(0.42 0.02 ${hue})`;
  const wallLight = `oklch(0.52 0.02 ${hue})`;
  const glass = `oklch(0.9 0.03 ${hue + 40})`;

  const floors = Math.min(property.floors, 12);
  const cols = Math.min(property.unitsPerFloor, 6);
  const W = 240;
  const H = 150;
  const bw = Math.min(150, 34 + cols * 22);
  const bh = Math.min(118, 22 + floors * 9);
  const bx = (W - bw) / 2;
  const by = H - 14 - bh;
  const winW = (bw - 12) / cols - 6;
  const winH = Math.max(3, (bh - 10) / floors - 4);

  const windows: React.ReactNode[] = [];
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const lit = (seed >> ((f * cols + c) % 24)) & 1;
      windows.push(
        <rect
          key={`${f}-${c}`}
          x={bx + 6 + c * (winW + 6)}
          y={by + 6 + f * (winH + 4)}
          width={winW}
          height={winH}
          rx={1}
          fill={lit ? glass : wallLight}
          opacity={lit ? 0.95 : 0.7}
        />,
      );
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("block h-full w-full", className)} role="img" aria-label={property.name}>
      <defs>
        <linearGradient id={`sky-${property.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={sky} />
          <stop offset="1" stopColor={skyDeep} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#sky-${property.id})`} />
      {/* neighbours */}
      <rect x={bx - 46} y={by + bh * 0.35} width={40} height={bh * 0.65} fill={wallLight} opacity={0.35} />
      <rect x={bx + bw + 6} y={by + bh * 0.5} width={36} height={bh * 0.5} fill={wallLight} opacity={0.3} />
      {/* building */}
      <rect x={bx} y={by} width={bw} height={bh} rx={2} fill={wall} />
      <rect x={bx + 4} y={by - 4} width={bw - 8} height={4} fill={wallLight} />
      {windows}
      {/* ground */}
      <rect x={0} y={H - 14} width={W} height={14} fill={`oklch(0.7 0.02 ${hue})`} opacity={0.6} />
    </svg>
  );
}
