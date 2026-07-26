# Documentation Links

Central index of every external doc referenced during planning. Agents: fetch these directly rather than relying on memory or guessing field names/endpoints — several real bugs this week (BambooHR disabled model sync, the fabricated creati.ai quote, the broken cash_inflow_spike_ratio feature) came from not checking a primary source first.

## Merge Unified — core reference
- Docs home: https://docs.merge.dev/home
- Unified API overview: https://docs.merge.dev/merge-unified/overview
- Concepts (Merge Link, Linked Account, Common Model, Unified API): https://docs.merge.dev/merge-unified/concepts
- Quickstart (first API call): https://docs.merge.dev/merge-unified/quickstart
- Merge Link implementation: https://docs.merge.dev/merge-unified/merge-link
- Architecture reference: https://docs.merge.dev/merge-unified/architecture-reference
- Use cases index: https://docs.merge.dev/merge-unified/use-cases
- Install Claude Code skills: https://docs.merge.dev/merge-unified/install-skills
- SDKs (Node, Python, Java, Go, Ruby, C#): https://docs.merge.dev/merge-unified/hris/merge-api-basics/sdks
- Sandboxes guide: https://docs.merge.dev/merge-unified/hris/integrations/sandboxes
- Syncing best practices: https://docs.merge.dev/merge-unified/reading-data/syncing-best-practices
- Linked Accounts reference: https://docs.merge.dev/merge-unified/platform-and-account-metadata/linked-accounts
- Testing via Postman: https://docs.merge.dev/merge-unified/testing/testing-merges-unified-api-via-postman
- `/llms.txt` at the root of any docs.merge.dev page, or append `.md` to any page URL, for AI-agent-friendly versions.

## Merge Unified — category API references
- HRIS: https://docs.merge.dev/merge-unified/hris/overview
- Accounting: https://docs.merge.dev/merge-unified/accounting/overview
- CRM: https://docs.merge.dev/merge-unified/crm/overview
- Ticketing: https://docs.merge.dev/merge-unified/ticketing/overview
- ATS: https://docs.merge.dev/merge-unified/ats/overview
- File Storage: https://docs.merge.dev/merge-unified/filestorage/overview
- Knowledge Base: https://docs.merge.dev/merge-unified/knowledge-base/overview
- Chat: https://docs.merge.dev/merge-unified/chat/overview

## Merge Unified — writing data (used by the Simulate Event tool's live-write mode)
- Writing data overview: https://docs.merge.dev/merge-unified/writing-data/overview
- Making writes (POST/PATCH introduction): https://docs.merge.dev/merge-unified/writing-data/writes/introduction
- Related and nested objects: https://docs.merge.dev/merge-unified/writing-data/writes/nested
- Programmatic writes with `/meta` (discover required fields before writing): https://docs.merge.dev/merge-unified/writing-data/programmatic-writes-with-meta/introduction
- Troubleshooting writes / error reference: https://docs.merge.dev/merge-unified/writing-data/troubleshooting-writes/warnings-and-errors-reference
- Custom objects: https://docs.merge.dev/merge-unified/supplemental-data/custom-objects
- Supplemental data overview: https://docs.merge.dev/merge-unified/supplemental-data/overview

## Merge's own MCP server (for the Tier 2 explainability chat)
- Spec page: https://docs.merge.dev/merge-unified/specifications/model-context-protocol-mcp
- Setup/usage guide: https://docs.merge.dev/basics/mcp/
- Source code: https://github.com/merge-api/merge-mcp
- Background blog post on MCP generally: https://www.merge.dev/blog/model-context-protocol

## Merge Agent Handler & Gateway (reference only — not core to current scope, see file 03)
- Agent Handler overview: https://docs.merge.dev/merge-agent-handler/overview
- Agent Handler MCP integration: https://docs.merge.dev/merge-agent-handler/implementation-guides/mcp-integration

## Merge account & billing
- Dashboard: https://app.merge.dev
- API keys: https://app.merge.dev/keys
- Pricing (Unified): https://www.merge.dev/pricing/unified
- Help Center: https://help.merge.dev

## Corgi reference (for authentic copy/coverage-line names in mocked output)
- Startup insurance product page / dashboard link used in "Send to Corgi": https://www.corgi.insure/startup-insurance
- See `/docs/02-corgi-company-product-reference.md` for the FAQ quotes and coverage-line list already pulled from their site.

## Third-party sandbox platforms (for setting up Test Linked Accounts)
- Intuit Developer (for the Accounting slot, if using QuickBooks): https://developer.intuit.com
- Zoho Books signup (current Accounting pick — free tier, no CC required): https://www.zoho.com/us/books/signup/
- Zoho API console (only needed if something requires manual app config): https://api-console.zoho.com
- HubSpot developer account (CRM): https://developers.hubspot.com

## Claude Code / execution tooling (for file 07's workflow)
- Docs map (index of all Claude Code docs): https://code.claude.com/docs/en/claude_code_docs_map.md
- Agent Teams: https://code.claude.com/docs/en/agent-teams.md
- Worktrees: https://code.claude.com/docs/en/worktrees.md
- Headless mode: https://code.claude.com/docs/en/headless.md

## Infra
- Supabase new project: https://supabase.com/dashboard/new
- Vercel: https://vercel.com
