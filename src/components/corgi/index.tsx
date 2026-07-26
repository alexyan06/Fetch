"use client";

// STUB — Lane B fills this in. The path and props are frozen: this file is
// already mounted in src/app/layout.tsx, so the real implementation drops in
// here with zero edits to any frozen file. That's the whole point of the stub.
//
// Behaviour spec: docs/12-corgi-mascot-feature.md. The one requirement that
// matters is that the corgi looks *different* when it's confident (auto) than
// when it's deferring (pending) — if all states look alike, cut the feature.
//
// Owns its own Supabase realtime subscription on `activity_log` inserts. It
// does not read from the Coverage Panel or the Approvals queue.

import type { CorgiMascotProps } from "@/lib/types";

export function CorgiMascot(props: CorgiMascotProps) {
  void props;
  return null;
}

export default CorgiMascot;
