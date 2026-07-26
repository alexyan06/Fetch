"use client";

// The Coverage Panel — the demo's money shot.
//
// When a signal lands and the limit moves, realtime pushes new props in and
// this animates the old value to the new one, then holds an "Auto-updated just
// now" badge. That transition IS the product claim made visible: the number
// changed by itself, correctly, while you were watching.
//
// Only the lines the company's stage package actually carries are rendered —
// not all nine. A seed-stage startup showing a Rep & Warranties limit would be
// a tell that the data is decorative.

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COVERAGE_LINE_FULL_NAMES,
  COVERAGE_LINE_LABELS,
  STAGE_PACKAGE_LABELS,
  STAGE_PACKAGE_LINES,
} from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import { cn } from "@/lib/utils";
import type { CoverageLine, CoverageState, StagePackage } from "@/lib/types";

/** How long the "just changed" highlight stays up after a value moves. */
const HIGHLIGHT_MS = 6000;

/** Counting duration. Long enough to read, short enough not to feel staged. */
const COUNT_MS = 900;

function useAnimatedNumber(target: number): { value: number; moved: boolean } {
  const [value, setValue] = useState(target);
  const [moved, setMoved] = useState(false);
  const previous = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = previous.current;
    previous.current = target;

    if (from === target) return;

    setMoved(true);
    const start = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      // Ease-out: fast at first, settling into the final figure.
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + (target - from) * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        setValue(target);
      }
    };
    frame.current = requestAnimationFrame(step);

    const timeout = setTimeout(() => setMoved(false), HIGHLIGHT_MS);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      clearTimeout(timeout);
    };
  }, [target]);

  return { value, moved };
}

function CoverageRow({ line, limit }: { line: CoverageLine; limit: number }) {
  const { value, moved } = useAnimatedNumber(limit);

  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 rounded-md px-3 py-2.5 transition-colors duration-500",
        moved && "bg-emerald-500/10",
      )}
    >
      <div className="min-w-0">
        <div className="font-medium">{COVERAGE_LINE_LABELS[line]}</div>
        <div className="truncate text-xs text-muted-foreground">
          {COVERAGE_LINE_FULL_NAMES[line]}
        </div>
      </div>
      <div className="flex items-center gap-2 whitespace-nowrap">
        {moved && (
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
            Auto-updated just now
          </Badge>
        )}
        <span
          className={cn(
            "text-lg font-semibold tabular-nums transition-colors duration-500",
            moved && "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {formatLimit(Math.round(value))}
        </span>
      </div>
    </div>
  );
}

export interface CoveragePanelProps {
  coverage: CoverageState[];
  stage: StagePackage;
}

export function CoveragePanel({ coverage, stage }: CoveragePanelProps) {
  const byLine = new Map(coverage.map((row) => [row.coverage_line, row]));
  const lines = STAGE_PACKAGE_LINES[stage];
  const total = coverage.reduce((sum, row) => sum + Number(row.current_limit), 0);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Coverage</CardTitle>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">
            {STAGE_PACKAGE_LABELS[stage]} package
          </div>
          <div className="text-sm font-medium tabular-nums">
            {formatLimit(total)} total
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {lines.map((line) => {
          const row = byLine.get(line);
          if (!row) return null;
          return (
            <CoverageRow
              key={line}
              line={line}
              limit={Number(row.current_limit)}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
