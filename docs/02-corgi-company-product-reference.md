# Corgi — Company & Product Reference

## Company basics
- **AI-native, full-stack insurance carrier for startups.** Not a broker — underwrites, binds, and administers claims directly, on their own paper.
- Founded 2024 by **Nico Laqua** (CEO/CTO) and **Emily Yuan** (COO). YC **Summer 2024 (S24)** batch. This is the company that IS YC-backed (correcting our earlier mix-up with Merge).
- Received full regulatory approval as a licensed carrier July 2025 (acquired a decades-old licensed carrier, ~$35M, ~18 months of regulatory work).
- HQ San Francisco (9 Claude Lane, Financial District — has a 24-hour cafe as a marketing/community stunt). Also offices in Salt Lake City, Dallas, Chicago, Atlanta.
- Culture notes (probably not pitch-relevant, but useful context): known for intense work culture, mascot corgi named Trudy.

## Funding trajectory
- Series A: $108M at $630M valuation (Jan 2026), co-led by Y Combinator, Kindred Ventures, Oliver Jung, Leblon Capital, Contrary, Glade Brook.
- Series B: $160M at $1.3B valuation (May 2026).
- Series B1: $106M at $2.6B valuation (May 2026, ~3 weeks after Series B). **Note**: this rapid step-up drew real scrutiny from LPs about "internal markup" practices — per TechCrunch, not a universally celebrated moment, worth knowing in case it comes up.
- Total raised: $378M+. ARR reportedly ~$40M as of Dec 2025 (per Sacra).
- Customers include Deel and Artisan (named in TechCrunch reporting).

## Product / what they actually sell
- Instant online quoting, same-day binding, no broker. "Quote in under 10 minutes."
- Coverage lines: **CGL** (General Liability), **D&O** (Directors & Officers), **Tech E&O**, **Cyber**, **EPLI** (Employment Practices), **Media Liability**, **HNOA** (Hired & Non-Owned Auto), **Fiduciary Liability**, **Rep & Warranties**, plus a newer **AI liability** module (integrates into existing Tech E&O policies — covers biased algorithms, harmful generated content, training data misuse, adversarial attacks, autonomous system failures).
- Stage-based packages: Pre-Seed & Seed / Series A / Growth Stage, each with different included lines.
- **Corgi Claims** (launched June 29, 2026): AI-native third-party claims administrator, 5,000+ licensed adjusters, automatic severity/coverage-issue/missing-doc triage at first notice of loss.

## The underwriting automation pattern (confirmed, important)
At **initial quote/bind time only**: if a company's risk profile falls within automated binding limits, founders complete purchase instantly (ACH/credit card). More complex cases route to a human underwriter with ML-generated recommendations. **This exact "auto for simple, human for complex" pattern is the direct inspiration for our project's core mechanic** — we're extending it to ongoing policy monitoring, which they don't currently do.

## The 3 named upgrade triggers (from their own FAQ — this is gold, direct primary source)
> "Coverage grows with you. Raise a new round, hire the first non-founder, or sign a bigger enterprise contract. You can add or upgrade policies in minutes from your Corgi dashboard, all in one place."
Confirmed **manual, dashboard-driven, founder-initiated** — verified independently across their FAQ page and their fast-setup page ("you can add or remove policy types, adjust coverage limits... at any time through your Corgi dashboard. Changes take effect immediately with updated pricing.") **No automatic detection exists.**

## API / developer access
- No public developer portal or public API docs found (checked thoroughly — no `docs.corgi.insure` or equivalent).
- They do have a GraphQL API for policy metadata sync, but it appears to be **partner/enterprise-gated** (same model as Vouch's embedded partnerships with Carta/Brex/WeWork) — not self-serve.
- **Action item**: ask hackathon organizers day-of whether an event-specific sandbox/mock endpoint exists. Don't assume there is one — build the mocked-output architecture as the default plan.

## Direct competitor (important for differentiation — see file 03)
Vouch is explicitly named as Corgi's most direct competitor.
