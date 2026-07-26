# Merge — Product & Technical Reference

## Company

- Unified API company, founded 2020 by Shensi Ding & Gil Feig (Columbia grads).
- Backed by Accel, NEA, Addition (~$75M raised as of last public figure). **Not YC-backed** — this was an initial wrong assumption, corrected early on. (Corgi _is_ YC, S24 batch — don't mix these up.)
- HQ San Francisco + NYC.

## Three products

1. **Merge Unified** — the flagship. One API, ~220 integrations across 8 categories. This is what we're using.
2. **Merge Agent Handler** — newer (~Oct 2025). MCP-based tool-calling layer for AI agents to take actions across connectors, with a Security Gateway (PII/PHI scanning) and audit logging. Not core to our build, but worth knowing it exists — possible stretch-goal angle for the "agent" framing.
3. **Merge Gateway** — LLM routing/gateway product. Not relevant to this project.

## Core concepts (the 5 things to understand)

- **Merge Link** — drop-in hosted UI where end users connect their third-party account (handles OAuth).
- **Linked Account** — the resulting connection; has an `account_token` sent on every API call.
- **Unified API** — one API surface (e.g. `GET /hris/v1/employees`) that works regardless of underlying platform.
- **Common Model** — normalized data shape, same fields regardless of source platform (e.g. `Employee.first_name` looks the same whether it came from BambooHR or Workday).
- **Dashboard** (app.merge.dev) — manage API keys, view Linked Accounts, and (critically for us) create **test Linked Accounts** with mock/sandbox data.

## Auth flow (production)

1. Backend requests a `link_token`.
2. Frontend opens Merge Link with it; user connects.
3. Merge Link returns a `public_token`.
4. Backend exchanges it for a permanent `account_token`. All requests include `Authorization: Bearer <API_KEY>` + `X-Account-Token: <ACCOUNT_TOKEN>`.

**For the hackathon**: skip most of this — just create a test Linked Account in the Dashboard and grab its token directly.

## Quickstart call

```
curl https://api.merge.dev/api/hris/v1/employees \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "X-Account-Token: YOUR_ACCOUNT_TOKEN"
```

## The 8 categories

HRIS, ATS, Accounting, Ticketing, CRM, File Storage, Knowledge Base, Chat.

**Most relevant to our project:**

- **HRIS** → Employee, Employment, Company, Location models. Detects: new hires (esp. first non-founder hire).
- **Accounting** → Transaction, Invoice, Expense, CompanyInfo, BalanceSheet models. Detects: funding injections, burn rate, revenue changes.
- **CRM** → Opportunity, Deal, Account models. Detects: large new contracts closing.
- **Ticketing** → Ticket models (Jira, GitHub Issues, etc.). Detects: security-incident signal via ticket volume/labels (Tier 2 stretch).

## Confirmed field-level detail (don't guess — these are verified, not assumed)

- **HRIS `Employee`** — confirmed against real pulled BambooHR data: `id`, `remote_id`, `first_name`, `last_name`, `display_full_name`, `work_email`, `employment_status` (ACTIVE/PENDING/INACTIVE — PENDING with a near-term `start_date` counts as a hire signal, don't wait for ACTIVE), `start_date` (populated), `hire_date` (deprecated, usually null), `termination_date`, `manager`, `employee_number`.
- **CRM `Opportunity`** — confirmed against Merge's own API reference (consistent across HubSpot, Salesforce, Salesflare endpoint docs): `id`, `remote_id`, `name`, `description`, `amount` (integer), `status` (enum: `OPEN` | `WON` | `LOST` — **not** a boolean `is_won` field, correcting an earlier wrong assumption baked into the synthetic data generator's comments), `stage` (references a separate `Stage` object with its own `name`), `owner`, `account`, `close_date`, `last_activity_at`, `remote_created_at`. A closed-won deal is `status == "WON"`, not `is_won == true`.
- **Accounting** — `Transaction` (`total_amount`, `transaction_date`, `transaction_type`, `currency`), `Invoice`, `CompanyInfo`, plus `BalanceSheet` and `CashFlowStatement` (the latter's `financing_activities` figure is a better funding-round signal than a derived transaction ratio, if the sandbox populates it — check once Zoho Books data is flowing).

## Validated against real Zoho Books data (hour-2 sandbox testing)

- **`/api/accounting/v1/invoices` is the proven, working endpoint** for the real company — confirmed via CSV-imported test invoices, all 8 came back with exact matching amounts, correct dates, and properly resolved `contact` references. Fields confirmed real: `number`, `total_amount`, `status` (e.g. `DRAFT`), `issue_date`, `due_date`, `paid_on_date`, `contact`, `line_items`.
- **Important limit this surfaced:** an Invoice is a good real-world stand-in for the "big new contract" trigger (a large invoice ≈ a big new customer), but it structurally **cannot** represent the "funding round" trigger — an invoice is billed receivables, not an equity/debt cash injection. These are economically different events.
- **Practical consequence:** for the real company, the "big new contract" trigger can be demonstrated with genuine live Invoice data. The "funding round" trigger for the real company should use the **Simulate Event tool (dry-run mode)** instead of trying to force an invoice to represent something it isn't — forcing it would be a dishonest signal even in our own demo. Synthetic companies simulate the funding trigger directly, same as before.

## Sandbox platforms for test Linked Accounts

|Category|Platform|
|---|---|
|HRIS|BambooHR|
|Accounting|Zoho Books (swapped from QuickBooks, which never appeared in the integration picker)|
|Ticketing|Jira|
|CRM|HubSpot|
|File Storage|Google Drive|

## SDKs

Node, Java (Kotlin/JVM), Python, Go, Ruby, C#/.NET — all "complete category" SDKs.

```python
from merge.client import Merge
merge_client = Merge(api_key="<KEY>", account_token="TEST_ACCOUNT_TOKEN")
employees = merge_client.hris.employees.list()
```

## Pricing / free tier (relevant for hackathon)

- **Launch (free) tier**: 3 free production Linked Accounts, up to 3 test Linked Accounts, daily sync, 100 req/min rate limit, 60-day sandbox access to third-party dev platforms.
- **Confirmed for this hackathon specifically**: Merge is providing public API access + free credits to participants. No signup/budget blocker.

## Claude Code integration (use this)

Merge ships an actual Claude Code plugin:

```
claude plugin marketplace add merge-api/merge-unified-skills
claude plugin install merge-unified
```

Then slash commands: `/merge-unified:onboarding`, `/merge-unified:implementing-link`, `/merge-unified:implementing-sync`, `/merge-unified:implementing-post-connection`, `/merge-unified:integration-validator`. Also: docs.merge.dev exposes `/llms.txt` and per-page `.md` versions for feeding into AI tools directly.

## Key doc URLs

- Overview: docs.merge.dev/merge-unified/overview
- Concepts: docs.merge.dev/merge-unified/concepts
- Quickstart: docs.merge.dev/merge-unified/quickstart
- Install skills: docs.merge.dev/merge-unified/install-skills
- Pricing: merge.dev/pricing