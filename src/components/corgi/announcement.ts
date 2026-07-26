// Turning one `activity_log` row into one thing the corgi says.
//
// Pure, so the copy is testable without a DOM or a database — and so the four
// tags can be proven to produce four visibly different results, which is the
// only requirement that makes this feature worth shipping (docs/12).
//
// Voice rules, enforced here rather than left to whoever edits the JSX later:
//   - Name the real company, the real signal, the real number.
//   - One or two sentences. Never more.
//   - The corgi ANNOUNCES; it never explains its own reasoning. The "why" lives
//     in the Activity Feed and the feature-importance chart, where it's
//     inspectable. Anything resembling "my model detected..." is out of bounds.

import { COVERAGE_LINE_LABELS } from "@/lib/constants";
import { formatLimit } from "@/lib/engine/recommendation";
import type { ActivityLogEntry, ActivityTag, CorgiState } from "@/lib/types";

/** The four sprites in `public/corgi/`. Filenames are `${pose}.png`. */
export type CorgiPose = "idle" | "wag" | "sit-tilt" | "hop";

export interface CorgiAnnouncement {
  /** The activity_log row id — also the React key and the dedupe key. */
  id: string;
  tag: ActivityTag;
  state: CorgiState;
  pose: CorgiPose;
  /** What the speech bubble says, and what aria-live reads out. */
  text: string;
}

export const STATE_FOR_TAG: Record<ActivityTag, CorgiState> = {
  auto: "confident",
  pending: "deferring",
  approved: "relieved",
  dismissed: "neutral",
};

export const POSE_FOR_STATE: Record<CorgiState, CorgiPose> = {
  idle: "idle",
  confident: "wag",
  deferring: "sit-tilt",
  relieved: "hop",
  neutral: "idle",
};

/**
 * Longest signal clause we'll repeat verbatim. Past this the bubble stops being
 * a glance and starts being a paragraph, which is the Activity Feed's job.
 */
const MAX_SIGNAL_CLAUSE = 140;

/**
 * The first sentence of every engine-written explanation is exactly the clause
 * we want — "{Company} hired 3 people this month, growing headcount 12.0%." —
 * so we reuse it rather than re-deriving the signal from fields the
 * `activity_log` row doesn't carry (it has no trigger_type).
 *
 * Split on ". " specifically: money and percentages ("$1.5M", "12.0%") put a
 * period next to a digit, never next to a space, so they survive intact.
 * Returns null for anything that doesn't look like a usable sentence — a row
 * hand-inserted during testing, say — and the caller falls back.
 */
export function extractSignalClause(explanation: string): string | null {
  const trimmed = explanation.trim();
  if (!trimmed) return null;

  const end = trimmed.indexOf(". ");
  const sentence = end === -1 ? trimmed : trimmed.slice(0, end + 1);
  if (sentence.length > MAX_SIGNAL_CLAUSE) return null;
  return sentence;
}

function lineLabel(entry: ActivityLogEntry): string | null {
  return entry.coverage_line ? COVERAGE_LINE_LABELS[entry.coverage_line] : null;
}

/** "raised" only when the number actually went up — otherwise say something true. */
function verbFor(oldValue: number | null, newValue: number): string {
  if (oldValue == null) return "set";
  if (newValue > oldValue) return "raised";
  if (newValue < oldValue) return "lowered";
  return "held";
}

function autoText(entry: ActivityLogEntry, companyName: string): string {
  const signal =
    extractSignalClause(entry.explanation) ?? `${companyName} sent a routine signal.`;
  const line = lineLabel(entry);

  if (entry.new_value != null && line) {
    const verb = verbFor(entry.old_value, entry.new_value);
    return `${signal} I ${verb} ${line} to ${formatLimit(entry.new_value)}.`;
  }
  // new_value null on an auto row means the limit genuinely didn't move — the
  // line was already at its ceiling, or the change was under the rounding step.
  // Claiming a raise here would put a false number on screen.
  return line
    ? `${signal} Routine — ${line} stays where it is.`
    : `${signal} Routine — nothing needed changing.`;
}

function pendingText(entry: ActivityLogEntry, companyName: string): string {
  const signal =
    extractSignalClause(entry.explanation) ?? `${companyName} sent a big signal.`;
  const line = lineLabel(entry);
  return line
    ? `${signal} That's a big one — can you take a look at ${line}?`
    : `${signal} That's a big one — can you take a look?`;
}

function approvedText(entry: ActivityLogEntry, companyName: string): string {
  const line = lineLabel(entry);
  if (line && entry.new_value != null) {
    return `Thanks — ${companyName}'s ${line} is set to ${formatLimit(entry.new_value)}.`;
  }
  return line
    ? `Thanks — ${companyName}'s ${line} is updated.`
    : `Thanks — ${companyName} is updated.`;
}

function dismissedText(entry: ActivityLogEntry, companyName: string): string {
  const line = lineLabel(entry);
  return line
    ? `Got it — leaving ${companyName}'s ${line} alone.`
    : `Got it — leaving ${companyName} alone.`;
}

/**
 * One activity_log row -> one announcement. `companyName` is resolved by the
 * caller, because the row only carries `company_id` and the corgi refuses to
 * say "a portfolio company" when it can say "Northwind".
 */
export function buildAnnouncement(
  entry: ActivityLogEntry,
  companyName: string,
): CorgiAnnouncement {
  const state = STATE_FOR_TAG[entry.tag] ?? "neutral";

  const text =
    entry.tag === "auto"
      ? autoText(entry, companyName)
      : entry.tag === "pending"
        ? pendingText(entry, companyName)
        : entry.tag === "approved"
          ? approvedText(entry, companyName)
          : dismissedText(entry, companyName);

  return { id: entry.id, tag: entry.tag, state, pose: POSE_FOR_STATE[state], text };
}
