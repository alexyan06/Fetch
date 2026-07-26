"use client";

// Trudy — the pixel-art corgi that announces coverage changes (docs/12).
//
// The path and props are frozen: this file is already mounted in
// src/app/layout.tsx, so the implementation drops in here with zero edits to
// any frozen file.
//
// The feature exists for exactly one reason: the corgi behaves DIFFERENTLY when
// it's confident than when it isn't. Auto -> wag, matter-of-fact. Pending ->
// sits down and asks for help. That contrast is the product's thesis in one
// image; if the states ever collapse into each other, cut the feature.
//
// Owns its own Supabase realtime subscription on `activity_log` inserts. It
// does not read from the Coverage Panel or the Approvals queue — it listens to
// the same table they do, independently, which is what let it be built in
// parallel with both.

import { useCallback, useEffect, useRef, useState } from "react";

import { TABLES } from "@/lib/constants";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { ActivityLogEntry, CorgiMascotProps, CorgiState } from "@/lib/types";

import {
  buildAnnouncement,
  POSE_FOR_STATE,
  type CorgiAnnouncement,
  type CorgiPose,
} from "./announcement";

const DEFAULT_DURATION_MS = 4000;

/** Beat of empty air between announcements, so two in a row don't read as one. */
const EXIT_GAP_MS = 350;

/** Sprites are 64x64 (docs/12); 2x keeps the pixels crisp and legible on stage. */
const SPRITE_PX = 128;

const POSE_SRC: Record<CorgiPose, string> = {
  idle: "/corgi/idle.png",
  wag: "/corgi/wag.png",
  "sit-tilt": "/corgi/sit-tilt.png",
  hop: "/corgi/hop.png",
};

/**
 * Motion lives in a <style> block rather than Tailwind arbitrary keyframes so
 * each pose's movement is legible in one place — and so the reduced-motion
 * cutout is a single rule instead of five conditionals.
 */
const CORGI_STYLE = `
  @keyframes corgi-idle { 0%,92%,100% { transform: translateY(0); } 96% { transform: translateY(-1px); } }
  @keyframes corgi-wag { 0%,100% { transform: rotate(-3deg) translateY(0); } 50% { transform: rotate(3deg) translateY(-2px); } }
  @keyframes corgi-tilt { 0%,100% { transform: rotate(-7deg); } 50% { transform: rotate(-3deg); } }
  @keyframes corgi-hop { 0%,100% { transform: translateY(0); } 30% { transform: translateY(-10px); } 55% { transform: translateY(0); } 70% { transform: translateY(-4px); } }
  @keyframes corgi-bubble-in { from { opacity: 0; transform: translateY(4px) scale(0.97); } to { opacity: 1; transform: none; } }

  .corgi-sprite { image-rendering: pixelated; transform-origin: 50% 100%; }
  .corgi-motion .corgi-pose-idle { animation: corgi-idle 5s ease-in-out infinite; }
  .corgi-motion .corgi-pose-wag { animation: corgi-wag 0.45s ease-in-out infinite; }
  .corgi-motion .corgi-pose-sit-tilt { animation: corgi-tilt 2.2s ease-in-out infinite; }
  .corgi-motion .corgi-pose-hop { animation: corgi-hop 0.7s ease-out infinite; }
  .corgi-motion .corgi-bubble { animation: corgi-bubble-in 220ms ease-out; }

  @media (prefers-reduced-motion: reduce) {
    .corgi-sprite, .corgi-bubble { animation: none !important; }
  }
`;

/** Bubble treatment per state. Deferring must not look like the other three. */
const BUBBLE_CLASS: Record<CorgiState, string> = {
  idle: "border-border bg-popover",
  confident: "border-border bg-popover",
  deferring:
    "border-amber-500/70 bg-amber-50 text-amber-950 dark:bg-amber-950/60 dark:text-amber-50",
  relieved:
    "border-emerald-500/60 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-50",
  neutral: "border-border bg-muted text-muted-foreground",
};

/* -------------------------------------------------------------------------- */
/* Fallback art                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Shown only if a sprite fails to load. The behaviour carries the theme; the
 * art is a multiplier, not a prerequisite (docs/12) — so a missing PNG must
 * never take the state machine down with it.
 */
function CorgiSilhouette({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      className="corgi-sprite text-orange-500 dark:text-orange-400"
      shapeRendering="crispEdges"
    >
      <g fill="currentColor">
        <rect x="3" y="3" width="2" height="3" />
        <rect x="11" y="3" width="2" height="3" />
        <rect x="3" y="5" width="10" height="5" />
        <rect x="2" y="9" width="12" height="4" />
        <rect x="3" y="13" width="2" height="1" />
        <rect x="11" y="13" width="2" height="1" />
      </g>
      <g fill="#ffffff">
        <rect x="6" y="9" width="4" height="3" />
        <rect x="7" y="6" width="2" height="2" />
      </g>
      <g fill="#2b1a12">
        <rect x="5" y="6" width="1" height="1" />
        <rect x="10" y="6" width="1" height="1" />
        <rect x="7" y="8" width="2" height="1" />
      </g>
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function CorgiMascot({
  companyId = null,
  enabled = true,
  announcementDurationMs = DEFAULT_DURATION_MS,
}: CorgiMascotProps = {}) {
  const [queue, setQueue] = useState<CorgiAnnouncement[]>([]);
  const [current, setCurrent] = useState<CorgiAnnouncement | null>(null);
  const [artFailed, setArtFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  /** company_id -> name. Prefetched once, then filled in on demand. */
  const namesRef = useRef<Map<string, string>>(new Map());
  /** Row ids already queued, so a duplicate realtime delivery can't double-speak. */
  const seenRef = useRef<Set<string>>(new Set());
  const hasShownRef = useRef(false);

  /* --- reduced motion ---------------------------------------------------- */

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  /* --- company names ----------------------------------------------------- */

  const resolveCompanyName = useCallback(async (id: string): Promise<string> => {
    const cached = namesRef.current.get(id);
    if (cached) return cached;

    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase
        .from(TABLES.companies)
        .select("id, name")
        .eq("id", id)
        .maybeSingle();
      const name = (data as { name?: string } | null)?.name;
      if (name) {
        namesRef.current.set(id, name);
        return name;
      }
    } catch {
      // Fall through — an unnamed announcement still beats a silent corgi.
    }
    return "A portfolio company";
  }, []);

  /* --- realtime subscription --------------------------------------------- */

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const supabase = getSupabaseBrowserClient();

    // Prefetch the whole (tiny — ~20 rows) name table so the first announcement
    // of the demo isn't the one that has to wait on a round trip.
    void (async () => {
      try {
        const { data } = await supabase.from(TABLES.companies).select("id, name");
        for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
          namesRef.current.set(row.id, row.name);
        }
      } catch {
        // Names resolve lazily instead.
      }
    })();

    const channel = supabase
      .channel("corgi-activity-log")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: TABLES.activityLog,
          ...(companyId ? { filter: `company_id=eq.${companyId}` } : {}),
        },
        (payload: { new?: unknown }) => {
          const entry = payload?.new as ActivityLogEntry | undefined;
          if (!entry?.id || !entry.tag) return;
          // Server-side filter is the primary guard; this is the belt to its
          // braces, since a dropped/re-established channel can replay.
          if (companyId && entry.company_id !== companyId) return;
          if (seenRef.current.has(entry.id)) return;
          seenRef.current.add(entry.id);

          void (async () => {
            const name = await resolveCompanyName(entry.company_id);
            if (cancelled) return;
            setQueue((q) => [...q, buildAnnouncement(entry, name)]);
          })();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [enabled, companyId, resolveCompanyName]);

  /* --- queue: one at a time, never stacked -------------------------------- */

  useEffect(() => {
    if (current || queue.length === 0) return;
    const delay = hasShownRef.current ? EXIT_GAP_MS : 0;
    const timer = setTimeout(() => {
      hasShownRef.current = true;
      setCurrent(queue[0]);
      setQueue((q) => q.slice(1));
    }, delay);
    return () => clearTimeout(timer);
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent(null), announcementDurationMs);
    return () => clearTimeout(timer);
  }, [current, announcementDurationMs]);

  if (!enabled) return null;

  const state: CorgiState = current?.state ?? "idle";
  const pose = current?.pose ?? POSE_FOR_STATE.idle;

  return (
    // pointer-events-none end to end: the corgi is never allowed to eat a click
    // meant for the dashboard underneath it. bottom-right and z-40 keep it
    // clear of the Coverage Panel's old->new animation, which is the money shot.
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-40 flex items-end justify-end gap-2"
      data-corgi-state={state}
    >
      <style>{CORGI_STYLE}</style>

      {/* Present in the DOM even when empty: a live region added at the same
          moment as its content often isn't announced at all. */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={cn("max-w-xs", !reducedMotion && "corgi-motion")}
      >
        {current && (
          <div
            className={cn(
              "corgi-bubble rounded-xl border px-3 py-2 text-sm leading-snug shadow-md",
              BUBBLE_CLASS[current.state],
            )}
          >
            {current.state === "deferring" && (
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide">
                Needs you
              </div>
            )}
            {current.text}
          </div>
        )}
      </div>

      <div className={cn("shrink-0", !reducedMotion && "corgi-motion")}>
        {artFailed ? (
          <CorgiSilhouette size={SPRITE_PX} />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- 64px pixel art
             from /public; next/image would resample and add no benefit. */
          <img
            src={POSE_SRC[pose]}
            alt=""
            aria-hidden
            width={SPRITE_PX}
            height={SPRITE_PX}
            className={cn("corgi-sprite", `corgi-pose-${pose}`)}
            onError={() => setArtFailed(true)}
          />
        )}
      </div>
    </div>
  );
}

export default CorgiMascot;
