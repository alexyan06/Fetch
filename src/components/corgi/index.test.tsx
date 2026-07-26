import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityLogEntry, ActivityTag } from "@/lib/types";

import { CorgiMascot } from "./index";

// vitest.config.ts doesn't set test.globals, so testing-library's automatic
// afterEach(cleanup) never registers.
afterEach(cleanup);

const COMPANIES = [
  { id: "co-1", name: "Acme" },
  { id: "co-2", name: "Northwind" },
];

/** Captured realtime handler + the mock client, hoisted above the vi.mock factory. */
const supa = vi.hoisted(() => ({
  handler: null as ((payload: { new: unknown }) => void) | null,
  removed: 0,
}));

vi.mock("@/lib/supabase", () => {
  const rows = [
    { id: "co-1", name: "Acme" },
    { id: "co-2", name: "Northwind" },
  ];

  const channel = {
    on(_event: string, _cfg: unknown, handler: (p: { new: unknown }) => void) {
      supa.handler = handler;
      return channel;
    },
    subscribe() {
      return channel;
    },
  };

  const client = {
    channel: () => channel,
    removeChannel: () => {
      supa.removed += 1;
      return Promise.resolve("ok");
    },
    from: () => ({
      // Thenable for the prefetch (`await ...select("id, name")`) and chainable
      // for the per-id lookup (`.select().eq().maybeSingle()`).
      select: () => ({
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(resolve),
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({
            data: rows.find((r) => r.id === id) ?? null,
            error: null,
          }),
        }),
      }),
    }),
  };

  return { getSupabaseBrowserClient: () => client };
});

function makeEntry(
  id: string,
  tag: ActivityTag,
  over: Partial<ActivityLogEntry> = {},
): ActivityLogEntry {
  return {
    id,
    company_id: "co-1",
    signal_event_id: `ev-${id}`,
    coverage_line: "EPLI",
    old_value: 1_000_000,
    new_value: 2_000_000,
    tag,
    explanation:
      "Acme hired 3 people this month, growing headcount 12.0%. Routine for this company, so EPLI moved automatically from $1M to $2M.",
    created_at: "2026-07-26T00:00:00.000Z",
    ...over,
  };
}

/** Deliver a realtime INSERT and let the name lookup's microtasks settle. */
async function emit(entry: ActivityLogEntry) {
  await act(async () => {
    supa.handler?.({ new: entry });
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/** Mount and flush the initial company-name prefetch. */
async function mount(props: Parameters<typeof CorgiMascot>[0] = {}) {
  const result = render(<CorgiMascot {...props} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  supa.handler = null;
  supa.removed = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CorgiMascot", () => {
  it("sits idle with a live region and no speech until something happens", async () => {
    const { container } = await mount();
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
    expect(container.querySelector("[data-corgi-state]")).toHaveAttribute(
      "data-corgi-state",
      "idle",
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/corgi/idle.png",
    );
  });

  it("reacts differently to each of the four tags", async () => {
    const cases: Array<[ActivityTag, string, string, RegExp]> = [
      ["auto", "confident", "/corgi/wag.png", /I raised EPLI to \$2M\./],
      ["pending", "deferring", "/corgi/sit-tilt.png", /can you take a look at EPLI\?/],
      ["approved", "relieved", "/corgi/hop.png", /Thanks — Acme's EPLI is set to \$2M\./],
      ["dismissed", "neutral", "/corgi/idle.png", /leaving Acme's EPLI alone\./],
    ];

    for (const [i, [tag, state, src, copy]] of cases.entries()) {
      const { container, unmount } = await mount();
      await emit(makeEntry(`log-${i}`, tag));
      await advance(1);

      expect(container.querySelector("[data-corgi-state]")).toHaveAttribute(
        "data-corgi-state",
        state,
      );
      expect(container.querySelector("img")).toHaveAttribute("src", src);
      expect(screen.getByText(copy)).toBeInTheDocument();
      // Only the deferring state wears the "Needs you" chip.
      expect(!!screen.queryByText("Needs you")).toBe(tag === "pending");

      unmount();
      cleanup();
    }
  });

  it("queues a burst instead of stacking bubbles", async () => {
    const { container } = await mount();

    await emit(makeEntry("log-a", "auto"));
    await emit(
      makeEntry("log-b", "pending", {
        company_id: "co-2",
        coverage_line: "TECH_EO",
        old_value: null,
        new_value: null,
        explanation:
          "Northwind closed a deal 4.5x larger than its typical won deal. Flagged for review — Tech E&O would go from $1.5M to $3M, pending approval.",
      }),
    );
    await advance(1);

    // Exactly one bubble on screen, and it's the first event.
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(1);
    expect(screen.getByText(/I raised EPLI to \$2M\./)).toBeInTheDocument();
    expect(screen.queryByText(/Northwind/)).not.toBeInTheDocument();

    // First expires, then the queued one takes its turn — still one at a time.
    await advance(4000);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(0);

    await advance(400);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(1);
    expect(screen.getByText(/Northwind/)).toBeInTheDocument();
    expect(screen.queryByText(/I raised EPLI/)).not.toBeInTheDocument();
  });

  it("honours announcementDurationMs", async () => {
    const { container } = await mount({ announcementDurationMs: 1000 });
    await emit(makeEntry("log-c", "auto"));
    await advance(1);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(1);

    await advance(999);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(1);
    await advance(2);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(0);
  });

  it("ignores other companies when scoped to one", async () => {
    const { container } = await mount({ companyId: "co-1" });
    await emit(makeEntry("log-d", "auto", { company_id: "co-2" }));
    await advance(1);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(0);
  });

  it("never speaks twice for the same row", async () => {
    const { container } = await mount();
    const row = makeEntry("log-e", "auto");
    await emit(row);
    await emit(row);
    await advance(1);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(1);

    await advance(4000 + 400);
    expect(container.querySelectorAll(".corgi-bubble")).toHaveLength(0);
  });

  it("renders nothing and never subscribes when disabled", async () => {
    const { container } = await mount({ enabled: false });
    expect(container).toBeEmptyDOMElement();
    expect(supa.handler).toBeNull();
  });

  it("falls back to an inline silhouette if a sprite fails to load", async () => {
    const { container } = await mount();
    const img = container.querySelector("img");
    await act(async () => {
      img?.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("never blocks clicks on the dashboard underneath", async () => {
    const { container } = await mount();
    expect(container.querySelector("[data-corgi-state]")).toHaveClass(
      "pointer-events-none",
    );
  });
});

describe("company name resolution", () => {
  it("names the real company, not a placeholder", async () => {
    await mount();
    await emit(
      makeEntry("log-f", "approved", { company_id: "co-2", coverage_line: "CYBER" }),
    );
    await advance(1);
    expect(screen.getByText(/Northwind's Cyber/)).toBeInTheDocument();
    expect(COMPANIES.map((c) => c.name)).toContain("Northwind");
  });
});
