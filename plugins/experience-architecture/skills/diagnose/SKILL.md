---
name: diagnose
description: >-
  Work out why a web app's experience feels wrong and what is causing it. Starts from a plain-language complaint ("the navigation feels broken", "users get lost", "Back does something weird", "my filter resets", "shared links open the wrong thing", "do we have too many pages", "are our URLs right") and investigates whichever layers it needs - page structure, URLs and routing, navigation chrome (sidebars, tabs, breadcrumbs, mobile menu) and state continuity (Back, refresh, deep links, switching records). Proves findings in a real browser when the app runs, traces symptoms to a few root causes, judges whether the structure itself is the problem, and explains it in plain English. Read-only.
when_to_use: >-
  The default starting point for any complaint or question about how an app's pages, navigation, URLs or state behave, broad or narrow, including a quick question about one screen (a panel that Back does not close, a filter that resets, a link that opens the wrong thing); narrow questions stay light. A focus word in the request (structure, urls, navigation, continuity) limits it to one layer.
argument-hint: "[what feels wrong] [structure|urls|navigation|continuity] [app path] [running URL]"
allowed-tools:
  - Bash(ea:*)
  - Read
  - Grep
  - Glob
---

# Diagnose

Request: $ARGUMENTS

## Where things are

`${CLAUDE_PLUGIN_ROOT}` means this plugin's folder. Claude Code fills it in. In Codex or Cursor it is the folder two levels above this file (`skills/diagnose/SKILL.md`), unless the installer has already written the full path. Where the `ea` command is not found, run `node <plugin folder>/scripts/ea.mjs` in its place. If the request line above shows `$ARGUMENTS`, the request is the user's message.

Read `${CLAUDE_PLUGIN_ROOT}/references/evidence.md` before reporting. It holds the finding classes, the record format, where output goes, the boundaries, and how to talk to the owner.

## Static map (generated when this skill loaded)

!`ea brief .`

If the line above shows a command instead of a route summary, run it yourself now and read the output before going further.

## 1. Frame

- Restate the complaint as what users experience. Find the app root (the package with the router; in a monorepo, the app package), the framework, and a running URL (the request, a dev script in `package.json`, or ask once). Without one, work from code and say so. If the user gave a URL or told you how to run the app, that is permission to start it and use it in the browser; stop anything you started. Otherwise ask once before starting a dev server.
- Turn the complaint into hypotheses across layers. "Navigation feels broken" might be two navigation systems with no owner, pages that duplicate each other, URLs that do not match the product's ideas, or Back and refresh losing the user's place. Keep the list; confirm or kill each one.
- If the repo documents its routes or navigation for agents or contributors (AGENTS.md, CLAUDE.md, docs about routes), compare those docs with the route map and list each mismatch as a finding: agents follow the docs.
- If the site holds more than one product under one address, name each and its front door before testing (see "Several products under one address" in `judgment.md`).
- If the map above found no routes, or the app root is elsewhere, run `ea map <app-root> --out <output-dir>/map`. Its artifacts folder is your output folder.

## 2. Size the investigation

Match the depth to the question. A focused investigation stays light.

- **Narrow** (one symptom, one screen, or a focus word): read only the matching playbook, trace the symptom to the line that causes it, and prove it in the browser. Then look for a second cause of the same symptom before stopping: other context that decides what a link or Back shows (a workspace, account or project held in storage or a store, a stored preference, a redirect). Then do the structure check in step 5. A narrow answer stays short: one report section per cause, no options or prototype. If the structure is the cause, name the end state in a few sentences and offer Rethink rather than producing a redesign.
- **Broad** (a vague complaint, several layers implicated, or a review): work through the playbooks in the order the signals point.

| Layer | Playbook | Look here when |
|---|---|---|
| Page structure | `${CLAUDE_PLUGIN_ROOT}/references/layers/structure.md` | too many pages, duplicates, things hard to find, "where should X live" |
| URLs and routing | `${CLAUDE_PLUGIN_ROOT}/references/layers/urls.md` | deep links, shared links, redirects, sign-in, 404s, URL shape |
| Navigation chrome | `${CLAUDE_PLUGIN_ROOT}/references/layers/navigation.md` | sidebars, tabs, breadcrumbs, switchers, mobile menu disagreeing or missing |
| Continuity and state | `${CLAUDE_PLUGIN_ROOT}/references/layers/continuity.md` | Back, refresh, filters resetting, panels, input lost or carried to the wrong record |

On a large app (the brief lists many routes or is truncated), start from the core loops (find, open, act, return) and the routes the complaint names. Read cited lines before trusting a signal: static signals are leads.

## 3. Prove it

With a running app, prove each candidate defect with the Verify procedure (`${CLAUDE_PLUGIN_ROOT}/skills/verify/SKILL.md`): one journey spec, run with `ea journey`. For any broad diagnosis include a cold open of a shared link signed out and as the same user, a new-tab check on the main list rows, and the core loop at phone width. Use `ea journey` and `ea crawl` for navigation checks rather than hand-written browser scripts: the runner records history operations and state after every step, which its checks depend on. A journey that stopped at a failed action proved nothing past that step.

## 4. Find the causes

Merge everything into one ledger. Drop refuted signals with a one-line reason. Classify survivors with the evidence classes. Group symptoms under the two to five causes that produce them; a fix to a cause should make several symptoms disappear. Where the right behaviour is a product choice rather than a bug, decide from what users expect (`${CLAUDE_PLUGIN_ROOT}/references/state-ownership.md`) and say why.

## 5. Judge the structure

Read `${CLAUDE_PLUGIN_ROOT}/references/judgment.md` and give an explicit verdict, even for a narrow question:

- **sound**: the problems are local; fix them in place;
- **part of the cause**: a structural change removes several findings; name it in two sentences;
- **the main cause**: the product is organised around the wrong ideas, or pages exist that should not.

For "part" or "main", name the end state (what replaces today's structure and which pages go), not only the first step.

Name pages that should not exist, or should merge, when the evidence is strong, even if nobody asked. If an ADR or team rule is what produces the symptom, judge it on the merits of what users now experience and say whether to keep, amend or overturn it; do not keep it by default because the question was narrow. When the verdict is not "sound", offer Rethink to develop options.

## 6. Report

Write `<output-dir>/report.md`:

1. **Verdict**, in three to six plain sentences: what is wrong for users, why, what you recommend.
2. **Root causes**, each with its symptoms as finding records, most user impact first.
3. **Structure verdict** and the reasons.
4. **What was proven how**: verified (reproduced in the browser, or certain from code), discovered only, not checked.
5. **Current structure**: links to the site map, navigation graph and transition map.
6. **Recommended fixes**, in the order to ship them, quick ones safe under any future structure first, and for each whether existing links and bookmarks keep working.
7. **Decisions for the owner**, each with your recommendation.

Before presenting it, run `ea refs <output-dir>/report.md --root .` and fix every reference it marks wrong, and check the counting claims (see "Check the report before sharing it" in `evidence.md`). Label findings verified or discovered.

In chat, follow "Talking to the owner" in `evidence.md`: what is happening to users, the causes, what you recommend, the one decision you need, and the report path. Do not paste the report.

## Rules

- Read-only. No edits to the app, no commits, no `.gitignore` changes, unless the owner explicitly asks for implementation after reading the recommendation.
- A smaller set of proven problems beats a long list of guesses.
- ADRs and "locked" layouts are context, not constraints. Departing from one is allowed; say so.
- Never trade away sign-in and permission boundaries, data integrity, public URL contracts, accessibility or operational safeguards for a cleaner structure.
