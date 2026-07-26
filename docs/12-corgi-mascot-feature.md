# Corgi Mascot — "Make It Human" Theme Feature

The hackathon theme is **"make it human."** This file specs the pixel-art corgi that announces coverage changes on the dashboard, and — more importantly — the argument for why it's on-theme rather than decorative.

## Why this is actually on-theme (read this before building it)

A cute mascot alone is decoration, and judges see through decoration. The real argument is that **this product's entire thesis is already about knowing when to defer to a human.** The tiered mechanic — auto-apply the routine, stop and ask a person for anything big — is a statement that automation should know its own limits. The corgi is the *emotional surface* of that thesis, not a sticker on top of it.

Which means the single most important design requirement is this:

> **The corgi must behave differently when it's confident versus when it isn't.**

- On an **AUTO** change it's happy and matter-of-fact: it handled something small, here's what it did.
- On a **PENDING** change it stops, sits, and asks for help: this one's too big for me, will you look at it?
- On an **APPROVED** change it's relieved and closes the loop.

That PENDING moment is the whole pitch in one image — a system that's *eager* but knows when to get a person. If the corgi behaves identically in all three states, cut the feature; it's added nothing but noise.

## Naming

Corgi's real company mascot is a corgi named **Trudy** (see `02-corgi-company-product-reference.md`). Naming ours after her is the same class of detail as using their real coverage-line names — it signals we read their material rather than skimming a landing page. Worth a single line in the pitch.

**Guardrail:** this is an homage inside our own tool's UI, not official Corgi branding. Don't render it in a way that implies Corgi built or endorsed it, and don't reproduce their actual logo or artwork.

## Behavioral spec

| Trigger | State | Posture | Copy pattern |
|---|---|---|---|
| `activity_log` insert, tag `auto` | **Confident** | tail wag, upright | "Acme hired 3 people — I raised EPLI to $2M." |
| `activity_log` insert, tag `pending` | **Deferring** | sits, head tilt, ears up | "Northwind closed a $1.2M deal. That's a big one — can you take a look?" |
| `activity_log` insert, tag `approved` | **Relieved** | happy hop | "Thanks — Cyber's set to $5M." |
| `activity_log` insert, tag `dismissed` | **Neutral** | shrug/sit | "Got it, leaving that one alone." |
| nothing happening | **Idle** | occasional blink or ear twitch | — |

### Voice
Short, warm, and factual. **Nudge, not baby talk.** This is insurance — copy that's too cutesy actively undermines the credibility the rest of the demo is building. Every line should name the real company, the real signal, and the real number. One or two sentences, never more.

Do **not** have the corgi narrate its own reasoning ("my neural network detected..."). The explanation lives in the Activity Feed and the feature-importance chart, where it's honest and inspectable. The corgi announces; it doesn't explain.

## Asset spec

Keep this small — assets are the part most likely to eat time.

- **Frame size:** 64×64 px, transparent PNG.
- **Minimum viable set:** 4 static poses (idle, wag, sit-tilt, hop) + a 2-frame tail-wag cycle. That's enough to read as animated without building a real sprite sheet.
- **Rendering:** `image-rendering: pixelated` so it stays crisp when scaled up 2–3×.
- **Palette:** classic corgi — orange/tan body, white chest and blaze, dark eyes. Keep it to ~6 colors; that's what makes it read as pixel art rather than a shrunk photo.
- **Location:** `public/corgi/*.png`.

**Fallback if assets aren't ready:** ship a simple inline SVG corgi silhouette or even an emoji with the same state machine and copy. The *behavior* carries the theme; the art quality is a multiplier on it, not a prerequisite. Do not let asset polish block the state machine landing.

## Technical implementation

**Ownership:** `src/components/corgi/**` — a fully self-contained component that no other lane touches.

**Mount point:** a single `<CorgiMascot />` slot added to `src/app/layout.tsx` during Phase 0, pointing at a stub that renders `null`. Because the mount lands while `layout.tsx` is being written anyway, the real implementation later drops into `src/components/corgi/` with **zero edits to any frozen file**. This is deliberate — it's what keeps the feature off the merge-conflict surface entirely.

**Data source:** its own Supabase realtime subscription on `activity_log` inserts. It does not read from, or depend on, the Coverage Panel or the Approvals queue — it listens to the same table they do, independently. That's what lets it be built in parallel with both.

**Queue behavior:** events can arrive in bursts (a sync can produce several at once). Show **one announcement at a time**, queue the rest, ~4 seconds each. A pile-up of overlapping speech bubbles is the most likely way this feature turns into a liability on stage.

**Position:** fixed, bottom-right, above other content but never covering the Coverage Panel — the panel's old→new animation is the money shot and the corgi must not step on it. Test this specifically at demo resolution.

**Accessibility:**
- Announcement text goes in an `aria-live="polite"` region, so it isn't purely visual.
- Respect `prefers-reduced-motion` — hold a static pose and show the text without animation.
- Never trap focus or block interaction with anything underneath.

## Where this sits in the build

**Priority: above Tier 2, below Tier 1.** A hackathon theme is usually scored, which makes this closer to a requirement than to polish — it should be built *before* the explainability chat or any other Tier 2 item. But it ships only once the core loop genuinely works; a charming mascot announcing a broken pipeline is worse than no mascot.

- **Phase 0** — add the `<CorgiMascot />` mount point + stub (2 minutes, inside the scaffold task).
- **Any blocked moment** — draw the assets. This is off the critical path entirely and needs no code to exist yet.
- **After Sync 2** — build the state machine and realtime subscription, once real events are actually flowing.
- **Hard cutoff:** if Tier 1 isn't solid by 4:30 AM, ship the stub and move on.

## Pitch framing

Don't present it as "we added a mascot." Present it as the answer to the theme:

> "The theme was make it human. Our system automates what it should and stops when it shouldn't — so we gave that judgment a face. When Trudy's confident, she just tells you what she did. When she isn't, she sits down and asks you to look. That's the product in one picture."
