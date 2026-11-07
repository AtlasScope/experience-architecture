# experience-architecture

> **Moved.** This kit now lives in [AtlasScope/agent-kit](https://github.com/AtlasScope/agent-kit/tree/main/kits/experience-architecture), with its history. Install it with `claude plugin marketplace add AtlasScope/agent-kit` then `claude plugin install experience-architecture@agent-kit` (Codex: `codex plugin marketplace add AtlasScope/agent-kit` then `codex plugin add experience-architecture@agent-kit`). This repo is no longer updated.

Source, test fixtures and validation for the **Experience Architecture** plugin for Claude Code, Codex and Cursor. The plugin itself is in [`plugins/experience-architecture`](plugins/experience-architecture/README.md); this repository root is also a plugin marketplace.

## Install

See the [plugin README](plugins/experience-architecture/README.md#install) for Claude Code, cloud sessions, Codex and Cursor. In short:

```bash
claude plugin marketplace add AtlasScope/experience-architecture
claude plugin install experience-architecture@experience-architecture
```

For development, `claude --plugin-dir ./plugins/experience-architecture` loads the working copy for one session. `npm run package` writes `dist/experience-architecture-<version>.tgz`, a self-contained marketplace folder for installing without GitHub.

## Layout

| Path | What |
|---|---|
| `plugins/experience-architecture/` | The plugin: manifest, 3 skills (diagnose, rethink, verify), playbooks and references, the `ea` toolkit, eval suite |
| `fixtures/northwind/` | Next.js App Router app with 20 planted defects (written alongside the toolkit) |
| `fixtures/fernway/` | Vite + React Router app with 18 planted defects (written blind by a separate agent) |
| `fixtures/lumen/` | Next.js App Router (`src/`, parallel and intercepting routes) with 18 planted defects (written blind, held out from tuning) |
| `fixtures/tidewater/` | Vite + React Router app where the right answer is structural: one job split across pages, nav organised by back-office systems, plus decoys that look wrong but are justified (written blind for v0.2) |
| `fixtures/kestrel/` | Next.js clinic app written after v0.2 was frozen: the held-out test (structural problem, a structure to keep, defects, decoys) |
| `fixtures/meridian/` | Large Next.js App Router app (workspaces in the path, three nav systems, parallel routes) with defects, structural problems and decoys (written blind for v0.2) |
| `tests/ground-truth/` | Answer keys for each fixture. Never copy these into a workspace an evaluated agent can read |
| `tests/*.test.mjs` | Toolkit tests (`npm test`) |
| `tests/journeys/`, `tests/proposals/` | Journey, proposal and mapping examples used by the tests |
| `tests/results/` | Recorded validation results |
| `tests/compare/` | The harness for with/without comparisons (plain Claude, the standalone skill, the plugin) |
| `.agents/plugins/marketplace.json`, `skills/*/agents/openai.yaml` | Codex marketplace and per-skill settings |
| `plugins/experience-architecture/scripts/install-skills.mjs` | Installs the skills as plain folders for Cursor (or Codex, or any tool that reads skill folders) |
| `scripts/package.sh` | Builds the release package |

## Develop

```bash
npm install                 # Playwright for browser tests
npm run fixtures:install    # fixture app dependencies
npm test
claude plugin validate plugins/experience-architecture
```

Browser checks need a fixture running: `npx next dev -p 3100` in `fixtures/northwind`, `npx vite --port 3200` in `fixtures/fernway`, `npx next dev -p 3300` in `fixtures/lumen`.

## How much testing a change needs

Match the testing to the change. Rerun a level only when something it covers has changed.

| Change | Run | Roughly |
|---|---|---|
| Ordinary: a bug fix, wording in a skill or reference, a scanner tweak | The unit tests for the area touched (`node --test tests/<area>.test.mjs`), plus `claude plugin validate` if a manifest or skill frontmatter changed | Seconds, no cost |
| Important behaviour: the journey runner, the pass/fail verdict, privacy handling, packaging, how skills trigger | `npm test` with Northwind running (browser tests included), `npm run package`, and one install-and-invoke check from the package in a scratch project | A few minutes, under $1 |
| Major capability change, or preparing a release | The full comparison in `tests/compare/` (three setups, three runs each, blind judging), including an app the change was not tuned on | An hour or more, $30 to $45 |

Score or reuse earlier comparison results for anything the change did not touch.
