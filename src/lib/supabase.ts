// FROZEN CONTRACT — do not edit after Phase 0.
//
// Two singletons, both created lazily so that importing this module during
// `next build` (when env vars may be absent) never throws.
//
//   getSupabaseBrowserClient() — anon key, safe in client components, this is
//     what the realtime subscriptions on coverage_state / activity_log /
//     pending_approvals use.
//   getSupabaseServerClient()  — service-role key, API routes only. Never
//     import this from a "use client" file.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;
let serverClient: SupabaseClient | null = null;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Set it in .env.local (gitignored) and in the Vercel project settings.`,
    );
  }
  return value;
}

/** Anon-key client for the browser. Realtime subscriptions attach to this one. */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const anonKey = requireEnv(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  browserClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return browserClient;
}

/**
 * Service-role client for API routes. Bypasses RLS — server-side only.
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (serverClient) return serverClient;

  const url = requireEnv(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
  const serviceKey = requireEnv(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  serverClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serverClient;
}
