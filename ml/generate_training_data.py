"""
Generate synthetic labeled training examples for the auto-approve vs.
needs-human-review classifier.

Why synthetic: we have no real historical claim/underwriting-change data to
learn from. Instead we simulate plausible startup "monthly snapshots" and
label each one using explicit heuristic rules that encode the same judgment
CLAUDE.md describes (routine growth = auto, big/risky swings = human review).
The model then learns to approximate and generalize those rules from the
engineered features -- which is also what gives us an honest feature-importance
chart for the demo, instead of a black box.

Feature fields are named to mirror real Merge Common Model fields where
possible, so porting this to the live app later doesn't require renaming:
- employee-level fields mirror the real HRIS Employee object (employment_status,
  start_date) -- verified against docs.merge.dev/hris/employees.
- transaction-level fields mirror the real Accounting Transaction object
  (transaction_date, total_amount, transaction_type) -- verified against
  docs.merge.dev/accounting/transactions.
- CRM opportunity fields (amount, is_won, close_date) are modeled on the
  standard Merge CRM Opportunity shape -- double check exact field names
  against docs.merge.dev/crm/opportunities during hour 2 sandbox pull and
  adjust here if anything differs.
"""

import csv
import random
import math

random.seed(42)  # reproducible dataset

N_COMPANIES = 400          # synthetic companies
MONTHS_PER_COMPANY = 12    # monthly snapshots per company
OUTPUT_PATH = "training_data.csv"


def simulate_company():
    """Simulate one company's 12-month history of monthly snapshots."""
    rows = []

    # Baseline company characteristics (randomized per company)
    starting_headcount = random.randint(2, 40)
    baseline_monthly_hire_rate = random.uniform(0.0, 0.15)  # % headcount growth/month, normal times
    baseline_cash_balance = random.uniform(50_000, 3_000_000)
    baseline_monthly_burn = baseline_cash_balance * random.uniform(0.03, 0.12)
    typical_deal_size = random.uniform(2_000, 50_000)

    headcount = starting_headcount
    cash_balance = baseline_cash_balance
    trailing_inflows = [baseline_monthly_burn * random.uniform(0.7, 1.3) for _ in range(3)]

    # Decide if/when this company has a "big event" this year (or none)
    has_funding_event = random.random() < 0.35
    funding_month = random.randint(1, MONTHS_PER_COMPANY) if has_funding_event else None
    has_hiring_spike = random.random() < 0.30
    hiring_spike_month = random.randint(1, MONTHS_PER_COMPANY) if has_hiring_spike else None
    has_big_contract = random.random() < 0.25
    big_contract_month = random.randint(1, MONTHS_PER_COMPANY) if has_big_contract else None

    for month in range(1, MONTHS_PER_COMPANY + 1):
        # --- HRIS-derived signal: new hires this month ---
        if month == hiring_spike_month:
            new_hires = max(1, round(headcount * random.uniform(0.35, 0.9)))  # sudden spike
        else:
            new_hires = max(0, round(headcount * baseline_monthly_hire_rate * random.uniform(0.3, 1.7)))
        headcount += new_hires
        headcount_growth_rate_pct = (new_hires / max(headcount - new_hires, 1)) * 100

        # --- Accounting-derived signal: net cash inflow this month ---
        normal_inflow = baseline_monthly_burn * random.uniform(0.6, 1.1)  # revenue/ops inflow, roughly tracks burn
        if month == funding_month:
            funding_amount = cash_balance * random.uniform(1.0, 4.0) + random.uniform(200_000, 5_000_000)
            net_inflow = normal_inflow + funding_amount
        else:
            net_inflow = normal_inflow - baseline_monthly_burn * random.uniform(0.8, 1.2)
        cash_balance = max(cash_balance + net_inflow, 1000)
        # NOTE: deliberately dividing by the company's stable baseline burn rate,
        # not a trailing average of net_inflow -- the latter hovers near zero in
        # normal months and makes the ratio blow up/flip sign for no real reason.
        # baseline_monthly_burn is always a solid positive number, so this stays
        # well-behaved: ~ -1 to 1.5 in normal months, spikes sharply on a real
        # funding event.
        cash_inflow_spike_ratio = net_inflow / baseline_monthly_burn
        trailing_inflows.pop(0)
        trailing_inflows.append(net_inflow)

        # --- CRM-derived signal: largest new won deal this month ---
        if month == big_contract_month:
            new_deal_value = typical_deal_size * random.uniform(4, 15)
        else:
            new_deal_value = typical_deal_size * random.uniform(0.2, 1.5) if random.random() < 0.6 else 0
        deal_size_ratio = new_deal_value / typical_deal_size if typical_deal_size > 0 else 0

        # --- Ground-truth label (heuristic rules a human underwriter would apply) ---
        needs_human_review = int(
            cash_inflow_spike_ratio > 5.0          # looks like a funding round (net inflow >5x normal monthly burn)
            or headcount_growth_rate_pct > 25.0    # big hiring spike relative to current size
            or deal_size_ratio > 5.0                # unusually large new contract
        )

        rows.append({
            "company_id": id(simulate_company) if False else None,  # placeholder, set by caller
            "month": month,
            "headcount": headcount,
            "new_hires_this_month": new_hires,
            "headcount_growth_rate_pct": round(headcount_growth_rate_pct, 2),
            "cash_balance": round(cash_balance, 2),
            "net_cash_inflow": round(net_inflow, 2),
            "cash_inflow_spike_ratio": round(cash_inflow_spike_ratio, 2),
            "new_deal_value": round(new_deal_value, 2),
            "deal_size_ratio": round(deal_size_ratio, 2),
            "needs_human_review": needs_human_review,
        })

    return rows


def main():
    all_rows = []
    for company_idx in range(N_COMPANIES):
        company_rows = simulate_company()
        for row in company_rows:
            row["company_id"] = company_idx
            all_rows.append(row)

    fieldnames = [
        "company_id", "month", "headcount", "new_hires_this_month",
        "headcount_growth_rate_pct", "cash_balance", "net_cash_inflow",
        "cash_inflow_spike_ratio", "new_deal_value", "deal_size_ratio",
        "needs_human_review",
    ]
    with open(OUTPUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    positive_rate = sum(r["needs_human_review"] for r in all_rows) / len(all_rows)
    print(f"Wrote {len(all_rows)} rows to {OUTPUT_PATH}")
    print(f"needs_human_review positive rate: {positive_rate:.1%}")


if __name__ == "__main__":
    main()
