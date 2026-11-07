# Structural judgment

The most valuable conclusions are about the structure itself: whether a page should exist, whether the navigation is organised around the right ideas, and whether a different product shape would serve users better. Bugs are easier to find and matter less. Use this after the diagnosis, and always before finishing, even when the question was narrow.

## When to challenge the structure

Ask these after the defects are understood:

1. **Does one structural cause explain two or more findings?** Two navigation systems with overlapping jobs, one concept spread across three URL branches, no rule for what goes in the URL.
2. **Does the complaint describe a workflow rather than a bug?** "I have to open three pages to answer one question" is structural even when every page works.
3. **Are users assembling one job by hand across surfaces?** Copying an id from one page to search on another, keeping two tabs open, re-applying the same filter.
4. **Does the navigation mirror the code or the org chart instead of the users' work?** Sections named after teams or services, admin and settings split by who built them.
5. **Do pages exist that no task needs?** Stubs, "coming soon", near-copies kept for a reason nobody remembers.
6. **Has the reason for the structure gone?** The team's own README, ADRs or changelog mention a reorganisation, a merged team, a retired system, or a "revisit when" condition that has now been met.

If none applies, say the structure is sound and the problems are local. That is a real conclusion: do not invent a restructure.

If one applies, commit to it. State the end state the product should reach (what replaces the current structure, which pages go), with its evidence, even when you recommend getting there in small steps. "That is a separate, bigger decision" is not a verdict: give the verdict and say the decision is the owner's. Keeping the old screens "as places to go" beside the new structure leaves two navigation systems for the same work; recommend it only as a transition step with a point at which the old screens go.

For a narrow question, answer it fully first, then say whether the cause is local or a symptom of the structure, and if the latter, which.

A request to add something (a tab, a page, a shortcut, a "show X here too" panel) is often a symptom: users are asking the product to bring together what its structure keeps apart. Check whether the same information or action already lives elsewhere and why users must go there. If it is a symptom, say so plainly, name the end state, and shape the small change as a first step toward it (for example a section that will move into the future record page), never as a substitute for it.

## Should this page exist?

A page earns its own destination when most of these are true:

| Test | Evidence |
|---|---|
| It has a job no other page does | Its main content and actions; compare with the closest sibling |
| It is about one thing | One noun (customer, order, report) or one task |
| It is a place | People return to it, share it, bookmark it, or need it in Back history |
| It is reachable along a task | An in-app path that makes sense from what the user is doing, not just a link that happens to exist |
| Someone uses it | Analytics if available; otherwise links in, empty states, "coming soon", dates in the code |

Verdicts, each with the evidence that decided it:

- **keep**
- **merge into X**: same content or same job under another name; the stricter permission rule survives
- **demote** to a tab, view, filter or panel of X: a mode of another place, reached only from it
- **promote**: a panel or modal people link to, work in for minutes, or open from several places
- **move under X**: in the wrong branch, so its breadcrumb and nav highlight lie
- **retire**: no job, no users; redirect its URL somewhere sensible
- **introduce**: users are assembling a job across surfaces; give the job a home

Watch for **forwarding pages**: a tab or menu row whose page exists only to send users into another section. Users who click it lose the section they were in, its tabs and its menu highlight. Either the content belongs in the section they clicked from, or the row should say where it goes.

Before calling two pages duplicates, check what makes similar pages legitimately separate: different audiences or permissions, a public page and a signed-in page, a page kept for search traffic, a saved view that is really a bookmark. Before calling a page unreachable, look for links built at runtime.

## Surface levels

Many structural problems are content sitting at the wrong level of commitment.

| Level | Right for | Wrong when |
|---|---|---|
| Inline (expand in place) | a detail read and passed | users compare it or link to it |
| Popover, menu | a choice or a glance | it holds a form or more than a few actions |
| Drawer, inspector | a record viewed beside its list, quick edits | people link to it, work in it for minutes, or open it from several places |
| Modal | a short blocking decision, a focused create flow | it has tabs, scrolls a lot, or users need the page behind it |
| Page | a record or task someone goes to, bookmarks or shares | it is reached from one parent and holds two fields |
| Section (top-level nav) | a major job or kind of thing users switch between | it holds one page, or its contents belong to another section's things |

Moving up a level (drawer to an addressable drawer, modal to page) usually fixes linking and Back. Moving down (page to drawer) usually fixes lost context and needless navigation. An addressable drawer over its list often gets both.

## Is the navigation organised around the right ideas?

- **First-click test, in your head.** Take the five most common tasks (from the README, seed data, labels, the user's complaint). For each, would a new user pick the right first click from the primary navigation? Count the misses.
- **Labels in the users' words.** Users look for things (customers, invoices) and jobs (needs reply, to approve), not systems (CRM, billing service).
- **One job per system.** Each persistent navigation system has one job: move between sections, move within this record, act on the selection, switch context. Two systems offering the same destinations under different labels is a cause, not a style issue.
- **Balance.** A section with one page, or one section holding half the product, says the grouping is wrong.
- **Context.** A workspace or account switcher that silently changes what the rest of the navigation means needs that context in the URL and visible in the chrome.
- **Several products under one address.** Some sites hold separate products (two games, a public site and an app, regional editions) that share a domain and some chrome. Name each one, its front door, how users switch between them, and which settings each owns. Test links that cross from one to the other, and check that opening one product's link never changes the reader's settings in another.
- **Labels match destinations.** A menu label should share words with the heading of the page it opens. `ea crawl` lists the ones that do not (`nav-label-mismatch`); a renamed menu with old page headings is the usual cause.

## Is a different product structure better?

Name the organising idea of the current product, then test the alternatives against the shape of the users' work:

| Organising idea | Fits when users mostly |
|---|---|
| By kind of thing (customers, orders, products) | look things up and work one record at a time |
| By queue or task (needs reply, waiting on me, overdue) | process many items to a finish line |
| Record-centred hub (everything about a customer on one page) | go deep on one entity and its related things |
| By role or workspace | switch between distinct contexts with little overlap |
| By time (today, this week) | plan or review |
| Command-first, minimal chrome | are experts who know what they want |

Evidence for the shape of the work: the data model (which entities have the most relations), seed data and fixtures, nav labels, empty states, the README's description of users, any analytics, and the complaint itself. A structure that fits the work removes several defects at once and shortens the core loops; count both.

## Smells and the moves that address them

| Smell | Moves | Costs to weigh |
|---|---|---|
| Two surfaces show the same things with different behaviour or permissions | merge into one with views or filters | retraining, redirects, reconciling permissions (keep the stricter one) |
| A workflow spans distant surfaces | introduce a surface for the job, or move the step to where the work happens | another surface to maintain |
| A record reachable from several parents behaves differently by path | one canonical URL; every entry point links to it | deep links in notifications and emails |
| Global context (workspace, project) chosen in chrome but absent from URLs | put it in the path; map the current route to its equivalent on switch | every route changes; redirects |
| Chrome depends on how the user arrived | derive current nav, breadcrumbs and title from the route | route metadata conventions |
| "Up" or "back" controls call `history.back()` blindly | link to the logical parent by URL | small |
| Mobile navigation is a separately maintained copy | one navigation definition, two presentations | responsive design work |
| Dead ends: errors, empty states, not-found with no way forward | route-level error and empty states inside the chrome, with a next action | small |

## Judging a proposal

A structural recommendation is ready when you can state:

- the user problem it removes, with the findings that show it;
- what it replaces, and where every old URL goes;
- the alternative you rejected, and why;
- what it costs: engineering size, link migration, analytics, permissions, documentation, retraining;
- which safeguards it touches and how they stay in force.

Existing ADRs, design rules and "locked" layouts are history, not authority. Quote the rationale and answer it: show the change holds the original goal, or that the cost the rule now imposes is larger than what it protects.
