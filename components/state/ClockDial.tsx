"use client";

import { cn } from "@/lib/utils";

interface ClockDialProps {
  segments: number;
  filled: number;
  name?: string;
  status?: string;
  size?: number;
  className?: string;
}

// Rounded to avoid last-bit float differences between Math.cos/Math.sin on the
// server and in the browser, which otherwise trip a React hydration mismatch
// on the generated path `d` string.
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [round(cx + r * Math.cos(rad)), round(cy + r * Math.sin(rad))];
}

/**
 * Segmented progress arc. Urgency colour is an accent on top of the numeral,
 * never the only signal: the `filled/segments` label is always rendered, and the
 * whole dial carries an aria-label for screen readers.
 */
export function ClockDial({ segments, filled, name, status, size = 56, className }: ClockDialProps) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = Math.max(4, Math.round(size * 0.12));
  const r = cx - stroke;
  const gapDeg = segments > 8 ? 3 : 5;
  const step = 360 / segments;

  const ratio = segments === 0 ? 0 : filled / segments;
  const tone =
    status === "complete" || ratio >= 1
      ? "text-destructive"
      : ratio >= 0.75
        ? "text-orange-500"
        : ratio >= 0.5
          ? "text-amber-500"
          : "text-primary";

  const arcs = Array.from({ length: segments }, (_, i) => {
    const start = i * step + gapDeg / 2;
    const end = (i + 1) * step - gapDeg / 2;
    const [x1, y1] = polar(cx, cy, r, start);
    const [x2, y2] = polar(cx, cy, r, end);
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`, on: i < filled };
  });

  return (
    <div className={cn("inline-flex flex-col items-center gap-1", className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          role="img"
          aria-label={`${name ? `${name}: ` : ""}${filled} of ${segments} segments filled${status === "complete" ? ", complete" : ""}`}
          className={tone}
        >
          {arcs.map((arc, i) => (
            <path
              key={i}
              d={arc.d}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="butt"
              className={arc.on ? "stroke-current" : "stroke-border"}
            />
          ))}
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums"
          aria-hidden="true"
        >
          {filled}/{segments}
        </span>
      </div>
      {name && <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{name}</span>}
    </div>
  );
}
