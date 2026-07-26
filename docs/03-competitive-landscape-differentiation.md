# Competitive Landscape & Differentiation

## The key finding: Vouch already did a version of this (2024)
Vouch — Corgi's most direct named competitor (formerly an MGA, now a licensed carrier; recently divested its Corix underwriting arm to Hiscox) — announced a partnership with **Carta** (cap table software) in 2024:
- Startups link their Carta account.
- Vouch stays "in the loop on key developments (such as a new round of financing)."
- Vouch **recommends** a coverage update when a trigger is detected.
- Called "an industry first" by Carta's own blog post.
- Confirmed by named execs: Sam Hodges (Vouch CEO), Rajat Kongovi (Vouch CPO), Reed McBride (Carta VP). Multiple independent outlets (Carta blog, Coverager, Startup Weekly) — this is real, not fabricated.

### Why we're still meaningfully differentiated
|                | Vouch × Carta (2024)                                                                       | Our project                                                                         |
| -------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Data sources   | One (Carta only)                                                                           | Multiple (any Merge-connected HRIS/Accounting/CRM/Ticketing)                        |
| Trigger types  | One (funding rounds)                                                                       | Three+ (hiring, funding, contracts, expandable to burn rate/security/concentration) |
| Action taken   | Recommends only                                                                            | **Automatically executes** small changes; recommends + drafts for large changes     |
| Decision logic | Unknown/unclear, likely simple rules                                                       | Real trained ML model (classifier + anomaly detection)                              |
| Current status | Announced 2026-current marketing is vague about it; unclear how prominent/live it is today | N/A — new build                                                                     |

### Pitch implication
Don't claim to have invented the category. Own the comparison proactively: **"Vouch proved this pattern works in 2024 with one data source and a notification. We built the general version — any data source, real automatic action, real ML."** This preempts a judge who knows the history instead of getting caught off guard.

## Adjacent space: cyber insurers doing "continuous monitoring"
Coalition (Active Cyber Insurance / Coalition Control) and At-Bay both do real continuous risk monitoring — but via **external security scanning** (vulnerability scans, dark-web monitoring, phishing/email-fraud detection), not via connecting to a company's actual business software (HRIS/accounting/CRM). Different mechanism, same general "continuous risk → adjust insurance" theme. Confirms the *category* (dynamic/continuous underwriting) is well-established in insurtech broadly, but our specific mechanism (unified business-software API → trigger detection → tiered auto/human action) doesn't appear to exist anywhere, including at Corgi.

## IMPORTANT source-reliability lesson (keep this front of mind for any further research)
Initially cited a quote from **creati.ai** claiming Corgi already does "dynamic, real-time feedback loop" underwriting with "real-time cybersecurity health checks and market sentiment analysis." **This was fabricated.** Traced back to the actual primary source (TechCrunch, the article creati.ai claimed to summarize) — that real article contains none of those claims; it's actually about LP skepticism over Corgi's fast valuation markups. creati.ai is an AI-tool-directory content-farm site, not a real news outlet — treat anything from it as unreliable.
A second quote (SiliconANGLE, "coverage adjusted in something closer to real time") is from a legitimate outlet but is explicitly the **reporter's paraphrase** ("Corgi argues that...") not a direct Corgi quote — softer evidence, treat accordingly.
**Lesson**: always trace secondary/aggregator sources back to their claimed primary source before treating a specific technical claim as fact.

## Bottom-line verdict
General category ("watch company data, adjust insurance") = not virgin territory (Vouch, 2024). Our specific combination (multi-source Merge integration + tiered auto/human execution + real ML triage) = no evidence of existing anywhere, including at Corgi itself. Safe to build, with honest positioning in the pitch.
