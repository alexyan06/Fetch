"use client";

// The mechanism behind "watch it react live".
//
// Supabase realtime is enabled on coverage_state, activity_log, and
// pending_approvals (migration 001). This component subscribes to those tables
// and calls router.refresh() when a row changes, which re-runs the server
// components above it and streams fresh HTML in — no polling, no manual reload,
// and no duplicated fetching logic on the client.
//
// Mounted once per page that needs to stay live. Renders nothing.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getSupabaseBrowserClient } from "@/lib/supabase";
import { TABLES } from "@/lib/constants";

const LIVE_TABLES = [
  TABLES.coverageState,
  TABLES.activityLog,
  TABLES.pendingApprovals,
] as const;

/**
 * Refreshes are coalesced: one sync can land a coverage update, a feed entry,
 * and an approval within milliseconds, and three simultaneous refreshes would
 * fight each other. Waiting a beat collapses them into one.
 */
const REFRESH_DEBOUNCE_MS = 150;

export interface RealtimeRefreshProps {
  /** Limit the subscription to one company. Omit for portfolio-wide. */
  companyId?: string;
  /** Surfaces a small "live" indicator. Off for pages where it'd be noise. */
  showIndicator?: boolean;
}

export function RealtimeRefresh({
  companyId,
  showIndicator = false,
}: RealtimeRefreshProps) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      // Missing anon key: the page still works, it just won't self-update.
      // Better a static dashboard than a crashed one mid-demo.
      return;
    }

    const channel = supabase.channel(
      companyId ? `fetch-live-${companyId}` : "fetch-live-portfolio",
    );

    for (const table of LIVE_TABLES) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          ...(companyId ? { filter: `company_id=eq.${companyId}` } : {}),
        },
        () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            router.refresh();
          }, REFRESH_DEBOUNCE_MS);
        },
      );
    }

    channel.subscribe((status) => {
      setConnected(status === "SUBSCRIBED");
    });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [companyId, router]);

  if (!showIndicator) return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      title={
        connected
          ? "Subscribed to coverage, activity, and approval changes"
          : "Not connected — the page will not update on its own"
      }
    >
      <span
        aria-hidden
        className={
          connected
            ? "size-1.5 rounded-full bg-emerald-500"
            : "size-1.5 rounded-full bg-muted-foreground/40"
        }
      />
      {connected ? "Live" : "Offline"}
    </span>
  );
}
