import { describe, expect, it } from "vitest";

import type { ActivityLogEntry, ActivityTag } from "@/lib/types";

import { buildAnnouncement, extractSignalClause } from "./announcement";

function entry(over: Partial<ActivityLogEntry> & { tag: ActivityTag }): ActivityLogEntry {
  return {
    id: "log-1",
    company_id: "co-1",
    signal_event_id: "ev-1",
    coverage_line: "EPLI",
    old_value: 1_000_000,
    new_value: 2_000_000,
    explanation:
      "Acme hired 3 people this month, growing headcount 12.0%. Routine for this company, so EPLI moved automatically from $1M to $2M.",
    created_at: "2026-07-26T00:00:00.000Z",
    ...over,
  };
}

describe("extractSignalClause", () => {
  it("keeps decimals in money and percentages intact", () => {
    const clause = extractSignalClause(
      "Northwind closed a deal 4.5x larger than its typical won deal. Flagged for review — Tech E&O would go from $1.5M to $3M, pending approval.",
    );
    expect(clause).toBe(
      "Northwind closed a deal 4.5x larger than its typical won deal.",
    );
  });

  it("returns null for text that isn't a usable short sentence", () => {
    expect(extractSignalClause("   ")).toBeNull();
    expect(extractSignalClause("x".repeat(200))).toBeNull();
  });
});

describe("buildAnnouncement", () => {
  it("auto: states what it did, with the real number", () => {
    const a = buildAnnouncement(entry({ tag: "auto" }), "Acme");
    expect(a.state).toBe("confident");
    expect(a.pose).toBe("wag");
    expect(a.text).toBe(
      "Acme hired 3 people this month, growing headcount 12.0%. I raised EPLI to $2M.",
    );
  });

  it("auto: doesn't claim a raise when the limit didn't move", () => {
    const a = buildAnnouncement(
      entry({ tag: "auto", old_value: null, new_value: null }),
      "Acme",
    );
    expect(a.text).toContain("EPLI stays where it is");
    expect(a.text).not.toMatch(/raised/);
  });

  it("pending: asks for help instead of announcing a change", () => {
    const a = buildAnnouncement(
      entry({
        tag: "pending",
        coverage_line: "TECH_EO",
        old_value: null,
        new_value: null,
        explanation:
          "Northwind closed a deal 4.5x larger than its typical won deal. Flagged for review — Tech E&O would go from $1.5M to $3M, pending approval.",
      }),
      "Northwind",
    );
    expect(a.state).toBe("deferring");
    expect(a.pose).toBe("sit-tilt");
    expect(a.text).toBe(
      "Northwind closed a deal 4.5x larger than its typical won deal. That's a big one — can you take a look at Tech E&O?",
    );
  });

  it("approved: closes the loop with the applied number", () => {
    const a = buildAnnouncement(
      entry({ tag: "approved", coverage_line: "CYBER", new_value: 5_000_000 }),
      "Northwind",
    );
    expect(a.state).toBe("relieved");
    expect(a.pose).toBe("hop");
    expect(a.text).toBe("Thanks — Northwind's Cyber is set to $5M.");
  });

  it("dismissed: neutral, no number", () => {
    const a = buildAnnouncement(
      entry({ tag: "dismissed", old_value: null, new_value: null }),
      "Acme",
    );
    expect(a.state).toBe("neutral");
    expect(a.pose).toBe("idle");
    expect(a.text).toBe("Got it — leaving Acme's EPLI alone.");
  });

  it("the four tags are visibly distinct — the whole point of the feature", () => {
    const tags: ActivityTag[] = ["auto", "pending", "approved", "dismissed"];
    const built = tags.map((tag) => buildAnnouncement(entry({ tag }), "Acme"));
    expect(new Set(built.map((b) => b.state)).size).toBe(4);
    expect(new Set(built.map((b) => b.pose)).size).toBe(4);
    expect(new Set(built.map((b) => b.text)).size).toBe(4);
  });

  it("never narrates its own reasoning", () => {
    const tags: ActivityTag[] = ["auto", "pending", "approved", "dismissed"];
    for (const tag of tags) {
      const { text } = buildAnnouncement(entry({ tag }), "Acme");
      expect(text).not.toMatch(/model|classifier|confidence|probability|neural/i);
    }
  });
});
