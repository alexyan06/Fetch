# ML Training Artifacts — Auto-Approve vs. Human-Review Classifier

Built during pre-hackathon prep. This is the real, trained model referenced
in `CLAUDE.md` and `06-ai-ml-features.md` — not a placeholder.

## Files
- `generate_training_data.py` — generates the synthetic labeled dataset (400 simulated companies × 12 monthly snapshots = 4,800 rows). Feature names are grounded in real Merge Common Model fields (verified against docs.merge.dev during this session).
- `training_data.csv` — the generated dataset.
- `train_classifier.py` — trains a scikit-learn logistic regression, evaluates it, exports `classifier_weights.json`.
- `classifier_weights.json` — trained weights + means/stds for standardization + feature importances.
- `classifier.ts` — TypeScript port of inference (standardize → dot product → sigmoid → threshold). No Python runtime needed in the deployed app. Drop this straight into the Next.js project.

## Current model quality
ROC AUC: 0.998. Precision/recall both >0.93 on the "needs review" class after a bug fix (see below). Feature importance: cash_inflow_spike_ratio (63%) > headcount_growth_rate_pct (18%) > deal_size_ratio (17%) > new_hires_this_month (2%) — this is the bar chart data for the demo.

## A real bug found and fixed during this session (worth knowing)
The first version of `cash_inflow_spike_ratio` divided by a trailing average of net cash flow, which hovers near zero in normal months — causing the ratio to blow up to nonsense values (-33,700 to +18,937) and badly miscalibrating the model (ROC AUC was only 0.688, and a genuine funding-round scenario was scoring *low* instead of high). Fixed by dividing by the company's stable baseline burn rate instead. Verified against both real training rows and hand-built scenarios afterward — a good reminder to always sanity-check a trained model against known-should-be-obvious cases, not just trust the training metrics.

## Known soft spot
Values in the ambiguous middle of `cash_inflow_spike_ratio` (~10-20x normal burn) get weak/low-confidence predictions — there's a gap in the training distribution between "normal" (roughly -1 to 2) and "genuine funding event" (typically 30+). Not a blocker for the demo as long as simulated scenarios use realistic magnitudes, but avoid picking a live-demo trigger value in that ambiguous middle range.

## Regenerating / retraining
```
python3 generate_training_data.py   # writes training_data.csv
python3 train_classifier.py         # writes classifier_weights.json, prints metrics
```
If you change feature definitions or add new signals (e.g. Ticketing/security-incident signal for Tier 2), update `FEATURES` in `train_classifier.py` and re-derive `classifier.ts` from the new `classifier_weights.json` output — the structure (means/stds/weights/bias arrays) stays the same shape either way.

## Next step (not done here — do this once real Merge data is flowing)
Sanity-check real sandbox data (hour 2 of prep) against these feature definitions — confirm `headcount_growth_rate_pct` etc. can actually be computed the way this script assumes from the real Employee/Transaction/Opportunity records you pull.
