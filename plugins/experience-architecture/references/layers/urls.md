# Playbook: URLs and routing

Loaded by Diagnose when URLs, deep links, redirects, sign-in or 404s are in question.

Read `${CLAUDE_PLUGIN_ROOT}/references/evidence.md`, and `${CLAUDE_PLUGIN_ROOT}/references/frameworks.md` for the app's router.

## Procedure

1. **Inventory.** Use the static map from Diagnose (or run `ea map <app-root> --out <out>/map`). From its `summary.md`, take the route table (kinds: page, layout-route, prefix, mount, redirect, api), redirects and guards, and the `routing` signals. Check the unresolved dynamic targets at the bottom; resolve the important ones by reading the code.

2. **Route identity versus view state.** For each route, write down what the path identifies and what the query holds. Using `${CLAUDE_PLUGIN_ROOT}/references/state-ownership.md` (decide from what users expect a link to reproduce), flag:
   - identity in the query (`?id=`) next to siblings that use the path;
   - one entity reachable at two URL shapes (`/customers?selected=4` and `/customers/4`);
   - the same view state in the path in one place and the query in another;
   - view state users would expect a shared link to reproduce that lives nowhere in the URL (see the continuity playbook);
   - URLs built by string concatenation without encoding.

3. **Topology versus concepts.** Does the tree read like the product? Look for nouns split across branches (`/customer-activity` beside `/customers/:id`), prefixes with no page (removing a segment gives a 404), layouts whose nesting does not match what users perceive as "inside" something, and route groups or mounts that hide structure.

4. **Entry and exit paths.** For representative URLs (a list, a record, a nested tab, a settings page), check direct entry signed in and signed out, refresh, and opening in a new tab. Check redirect chains (`curl -sI` each hop for server redirects, or the crawler), catch-all routes, the not-found experience, auth guards (do they carry `?next=`, and is it validated as same-origin?), canonical tags on public pages, and trailing-slash and case handling. For public pages, check discoverability: a signed-out `ea crawl` compares the pages it reaches with `/sitemap.xml` (`not-in-sitemap`, `no-sitemap`); also check robots rules and any machine-readable site map the project publishes.

5. **Verify.** With a running URL, run `ea crawl <url>` at desktop, plus journeys (`${CLAUDE_PLUGIN_ROOT}/references/formats.md`) for the entry cases: `coldOpen` each representative URL `as: "signed-out"` and `as: "same"`, a second account through `profiles` where permissions differ, and `openInNewTab` on list rows, cards and breadcrumbs. Without a running app, label findings code-certain or likely.

6. **Compatibility.** If restructuring is on the table, list which URLs are external contracts (shared links, emails, docs, SEO, partner integrations, mobile app deep links) and carry them into the migration plan (`${CLAUDE_PLUGIN_ROOT}/references/migration.md`).

## Output

`<out>/routing.md` holds the route inventory table (path, identifies, query state, layouts, guards, inbound links), the findings, and the current site map and nav graph files. Diagnose's report carries the verdict on whether URLs match the product model and the defects that break direct entry or history.

Read-only playbook. Do not add redirects or change routes.
