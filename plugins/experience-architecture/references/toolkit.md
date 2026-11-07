# The `ea` toolkit

Zero-dependency Node scripts that do the mechanical work so the analysis can spend its attention on judgment. While the plugin is enabled, `ea` is on the Bash PATH. If `ea` is not found, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/ea.mjs"` instead. Run everything from, or pointed at, the app root (the folder with the app's `package.json`; in a monorepo, the app package, not the repo root).

## Static: `ea map [root] --out <dir>`

Seconds, no install, read-only. Writes:

| File | What it is |
|---|---|
| `model.json` | Routes (path, kind, file, layouts, templates, params, inbound refs), redirects, auth guards, persistent chrome components, every navigation reference (file:line, kind push/replace/link/nav-item/redirect, target, resolved route, status ok/dead/redirected/dynamic), and signals |
| `summary.md` | Route table, redirects and guards, chrome table, signals grouped by area, unresolved dynamic targets |
| `nav-graph.mmd` / `.dot` | Who links to what. Double-bracket nodes are chrome components; ✕ nodes are dead targets |
| `sitemap-current.mmd` | URL tree; dashed nodes are URL prefixes with no page, yellow are orphans |

Discovery covers Next.js App and Pages Router, React Router config objects and `<Route>` JSX (including `x/*` mounts with nested `<Routes>`), React Router 7 / Remix flat routes, and TanStack file routes. It follows `tsconfig`/`jsconfig` path aliases, nav-config arrays imported by nav components, and URL helper functions (`ticketUrl(id)`).

Signal kinds, by area:

- **ia**: `orphan` (or `orphan-candidate` when runtime-computed links exist), `near-duplicate` (text or data overlap), `related-views` (same data or same main component), `fragmented-entity`, `tab-and-page`
- **routing**: `dead-link`, `missing-parent`, `redirect-chain`, `catch-all-redirect`, `deep-link-loss`, `entity-two-urls`, `identity-in-query`, `state-two-forms`, `unencoded-query`
- **chrome**: `duplicate-nav`, `active-state-mismatch`, `active-state-exact`, `label-drift`, `mobile-nav-missing`, `mobile-nav-subset`, `raw-breadcrumbs`
- **continuity**: `template-state`, `state-above-entity`, `global-entity-state`, `view-state-not-in-url`, `view-state-push`, `overlay-replace`, `overlay-not-in-url`, `in-app-back-push`, `nested-component`, `no-scroll-restoration`

Signals are leads. Each carries `verify:` text saying how to confirm it. Read the cited lines before promoting one to a finding. Static analysis cannot see behavior that depends on runtime data, conditional rendering, CSS at a breakpoint, or code it cannot parse; dynamic navigation targets it could not resolve are listed at the end of `summary.md`.

## Browser: Playwright mode

`ea crawl`, `ea journey` need Playwright. The scripts look in the current project, then `$EA_PLAYWRIGHT_DIR`, then `~/.experience-architecture/runtime`. They skip a copy that has no browser downloaded (common in projects) and use installed Google Chrome with it when available. They never install anything, and never suggest installing into the user's project. If missing, either ask the user before installing it outside their project (the error message prints the exact command) or use agent-browser mode below.

- `ea crawl <url> [--cookie name=value] [--storage-state f] [--viewport mobile] [--max 60]` follows same-origin links (never logout/delete/API URLs, and with write requests blocked), samples at most 3 URLs per route shape, records each page's navigation regions and which link each marks current, and reports dead pages with their referrers, redirect chains, sign-in redirects that drop the destination, conflicting active states between nav systems, duplicate destinations across regions, near-duplicate page content, missing navigation at small viewports, menu labels that share no word with the page they open (`nav-label-mismatch`), and, on a signed-out crawl, public pages missing from `/sitemap.xml` (`not-in-sitemap`). Feeds, sitemaps and other files are skipped. Run it at desktop and at `--viewport mobile`.
- `ea journey <spec.json> [--base url] [--screenshots] [--ci] [--keep-text] [--reveal]` runs journeys (format in `formats.md`) in a fresh browser per journey and viewport, snapshots state after every step, and writes `journey-log.json`, `transitions.md` (journeys that did not finish, failed checks, then anomalies as start/action/expected/observed), `transitions.json` and `transitions.mmd` (state-transition map). A failed action fails its journey and skips the rest of it. The first line of `transitions.md` is the verdict: PASS (stated checks met, no journey stopped, no defect left unaccepted), FAIL (a stated check failed, a journey stopped, or the automatic checks found a defect not listed under `accept`), or EXPLORATORY (nothing failed, but no stated check was evaluated, so nothing is verified). `likely`, `judgment` and `info` anomalies never fail a run. `--ci` exits 0, 1 or 2 for these.
- `ea refs <report.md> --root <app> [--ci]` checks every `file:line` reference in a report: the file exists, the line exists, and code quoted on the same line appears near it. Run it on every report before presenting it.

Automatic checks, which need no expectations: Back/Forward landing somewhere other than the reconstructed history says; Back leaving the page while an overlay is open; Back that only changes view state; view-state changes that push; overlays opened without history; refresh changing the view; returning via Back or an in-app link to a view that lost its filters, tab or inputs; scroll not restored; field values or overlays carried from one record to the next; sign-in redirect dropping the deep link; a shared link that a fresh browser sees differently (`cold-open-differs`, `cold-open-dead`); clickable things that cannot open in a new tab (`not-a-link`, `new-tab-hijacked`); redirect chains; not-found pages; nav systems disagreeing about the current section; no visible navigation on mobile; focus left on `<body>` after navigation or after closing an overlay; stale document titles; requests blocked because they would have changed data (`write-blocked`).

Privacy and safety defaults, for both `crawl` and `journey`: POST, PUT, PATCH and DELETE requests are blocked unless the spec's `allowWrites` lists them; free-text field values are recorded as a length and fingerprint (equal values still compare equal), while selects, checkboxes and search or filter fields keep their values; password, payment and one-time-code fields are skipped; URL parameters that look like secrets (token, key, session, code, signature) are masked; page text is used for checks in memory and dropped before anything is written. The same masking covers what the runner writes itself: step descriptions, requested URLs, redirect chains, error messages and cookie steps, with a final sweep that replaces every fill and cookie value from the spec in each output file. Screenshots are off unless asked for. Blocking write requests is not a guarantee of read-only behaviour, since some apps change data on a page load or a link; run against local or staging copies with test accounts.

## Browser: agent-browser mode

When Playwright is unavailable or the user wants to watch, drive the app with whatever browser tools you have (the built-in browser pane, the Chrome extension, a Playwright MCP). After every step, run the probe and keep the JSON it returns:

1. `ea probe` prints a self-contained script. Execute it in the page with your browser tool's JavaScript tool. The first call on a document installs a push/replace counter; call it once right after each page load before interacting.
2. Append `{ "i": n, "type": "goto|click|back|forward|reload|fill|scroll", "desc": "what you did", "snapshot": <probe result> }` to a run in a log file shaped like `formats.md` describes.
3. `ea transitions <log.json>` runs the same anomaly checks and writes the same outputs.

In this mode the probe leaves page text out and fingerprints typed values, so snapshots in your context stay small and free of personal data. For a shared-link check, open the URL in a fresh private window or a new browser profile if your tool has one, and record it as a `coldOpen` step with a `reference` snapshot of the original page.

## Design and migration

- `ea sitemap <model.json | proposal.json>` prints a Mermaid site map. For proposals, merged nodes, new nodes and retired URLs are coloured.
- `ea prototype <a.json> [b.json ...] --out prototype.html` builds one self-contained, clickable HTML prototype of one or more proposals (switcher in the header): real hash URLs, the proposal's chrome, breadcrumbs from the hierarchy, tabs and views with the history semantics the proposal declares, a responsive mobile bar, and a live log of push/replace/pop operations. Use it to test whether a structure holds up before anyone writes code.
- `ea migrate <model.json> <mapping.json> --out <dir>` checks that every current page has a decision (move, retire, keep), flags dropped params, chains, missing targets and stale existing redirects, lists every in-code link that should be updated rather than left to a redirect, emits framework redirect config, and writes `regression-journeys.json`: one journey per moved URL asserting it lands correctly and that Back does not bounce.
