# Evidence standard and report conventions

Diagnose, Rethink and Verify report findings the same way. Read this once per session before writing a report.

## Three levels of claim

Every statement in a report is one of three things. Label it, and never let one pass for another.

- **Discovered**: something looks wrong. A static signal, an anomaly from an exploratory journey, a pattern seen in one file. It may be real or intended. Say what would confirm it.
- **Verified**: you reproduced it in the browser, or you read the code and the outcome is certain. Only verified items are stated as facts.
- **Recommended**: a change you have enough evidence to propose, with the user benefit, what it costs, and the alternative you rejected.

A journey verdict of EXPLORATORY (no stated checks) or an anomaly you did not rerun is discovered, not verified. A recommendation built on discovered items says so.

## Classify every finding

| Class | Meaning | Required evidence |
|---|---|---|
| **Defect: reproduced** | Observed in the running app | Journey repro (start, action, expected, observed) plus the code cause |
| **Defect: code-certain** | Not run, but the code makes the outcome unavoidable | File and line, and the exact sequence that triggers it |
| **Likely defect** | Code strongly suggests it; one assumption unverified | File and line, plus what would confirm it |
| **Design judgment** | Works as built; the structure itself is the problem | The user-facing consequence and who it hurts |
| **Opportunity** | Nothing wrong; a better model exists | What it would enable |

Static signals from `ea map` are candidates, not findings. Promote a signal only after reading the code it points at, or reproducing it. Say plainly when you could not run the app.

Never present a design judgment as a defect. "Tabs push history entries" is a judgment unless you can show the Back behavior contradicts what users of this screen expect, or what similar screens in the same product do.

A journey that stopped at a failed action proved nothing about the steps after it. Never count it as a pass; fix the step or report the app problem that made it fail.

## Finding record

```
### <short user-facing title>
Class: Defect (reproduced) · Area: continuity · Impact: high
Start: /orders filtered to "shipped", scrolled to row 30
Action: open order 1031, press browser Back
Expected: the shipped list at row 30
Observed: unfiltered list at the top
Cause: status filter is component state (app/(app)/orders/page.jsx:7); nothing writes it to the URL
User impact: every return trip from an order costs a re-filter; support agents do this dozens of times a day
Fix direction: support agents share and return to filtered lists, so the filter belongs in the URL (?status=), replaced while adjusting
```

Impact is about users, not code: **high** = blocks or misleads a core task, loses user work, or breaks direct entry and sharing; **medium** = repeated friction or confusion on common paths; **low** = polish, rare paths.

## Group symptoms by root cause

Ten symptoms usually come from two or three structural causes: two navigation systems with no owner, no rule for which state lives in the URL, an entity spread across URL branches. Lead the report with causes; list symptoms under them. A fix to a cause should make several symptoms disappear.

## Where output goes

Write to `.experience-architecture/<YYYY-MM-DD>-<slug>/` (the user's local date: `date +%F`, not UTC) at the app root unless the project's CLAUDE.md or AGENTS.md names an artifacts location (for example `.artifacts/`), in which case use that. Check whether the folder is gitignored; if not, tell the user rather than editing `.gitignore` yourself. Never write inside the app's source folders.

Name files for what they hold: `report.md`, `model.json` (from `ea map`), `journeys.json`, `journey-log.json`, `transitions.md`, `sitemap-current.mmd`, `sitemap-proposed-<option>.mmd`, `consolidation.md`, `prototype.html`, `migration.md`.

## Boundaries that hold in every skill

- Analysis is read-only. Do not edit application code, config, routes or tests, and do not commit, unless the owner explicitly asks for implementation after seeing the recommendation. Finding a better structure is never a reason to start changing the app.
- Do not run destructive app actions in the browser: no deletes, payments, sending messages, or account changes. The crawler and journey runner block write requests (POST, PUT, PATCH, DELETE) unless a spec allows them, and the crawler skips logout/delete-style URLs. Use test accounts the user gives you or the project's seed data; never real credentials.
- Keep captured data small. Journey logs fingerprint typed values instead of storing them, mask secret-looking URL parameters, and drop page text before writing to disk. Screenshots capture everything on screen; take them only when a visual matters, and never of pages showing real personal data.
- Starting the user's dev server is allowed when they gave a URL or a run command, asked for browser checks, or agreed when asked. Stop anything you started.
- Existing ADRs, design docs and "locked" decisions are historical context. Weigh them, cite them, and say when you recommend departing from one. They do not override the analysis.
- Recommendations must preserve authorization boundaries, data integrity, public and partner URL contracts, accessibility, and operational safeguards. If an option weakens one, say so and say what would have to be rebuilt.

## Check the report before sharing it

Wrong details cost trust even when the conclusion is right, and a coding agent will act on a wrong line number. Before you present a report:

1. Run `ea refs <report.md> --root <app>`. Fix or remove every reference it marks wrong; recheck the doubtful ones. Cite only lines you have read in this session.
2. Back every claim about how much or how many ("used on four pages", "all ten sections are reachable", "nothing links to it", "every list") with a search you ran, and say what you searched. If you did not search, drop the count or mark the claim discovered.
3. Name components, files and routes only as they appear in the code. When unsure of a name, describe the thing instead.

## Writing the report

Lead with the verdict in plain language: what is wrong with the experience, what causes it, what you recommend. Then the evidence. Keep implementation detail in its own section. Distinguish clearly what was verified (reproduced, or certain from code), what was only discovered, and what was not checked.

Size the report to the question. A narrow question gets a short answer: the cause, the fix, whether it is a symptom of the structure, and the end state in a few sentences if it is. Options, a prototype, a page-by-page table and a migration plan belong to broad reviews and to Rethink, and only when the evidence shows a substantial structural problem.

## Talking to the owner

The person asking may be a solo developer or a product owner who knows the business and not the framework. The analysis is technical; the conversation is not.

- **Describe experiences.** "When someone opens an order and comes back, the list forgets its filter" beats "status is `useState` in `orders/page.jsx`". Put file and line in the report.
- **Name causes in their terms.** "The app has two navigation systems that each think they own the same pages" is a cause they can act on.
- **Make the technical decisions yourself.** Whether state goes in a path, a query or local memory, which router pattern to use, how to stage a migration: decide, and explain the effect. Do not ask the owner to pick a React pattern.
- **Ask only for product decisions,** one at a time, with your recommendation first: "Should a shared link open the customer with the panel already open? I'd say yes, because your team pastes these into Slack."
- **Describe options as what using the product would feel like,** then what changes for existing users and roughly what it costs (small, medium, large, and what drives the size).
- **Say what was proven and what was not,** in one sentence each. No hedging stacks, no invented certainty.

The chat reply is short: what is happening to users, why, what you recommend, and the one decision you need. The report holds the rest.
