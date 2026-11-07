# File formats

## Journey spec (`ea journey`)

```json
{
  "baseUrl": "http://localhost:3000",
  "viewports": ["desktop", "mobile"],
  "cookies": [{ "name": "session", "value": "test-user" }],
  "profiles": { "viewer": { "cookies": [{ "name": "session", "value": "test-viewer" }] }, "admin": { "storageState": "admin.json" } },
  "allowWrites": ["*/api/auth/*"],
  "journeys": [
    {
      "id": "filter-open-return",
      "intent": "Filter orders, open one, come back to the same list",
      "steps": [
        { "goto": "/orders" },
        { "click": "role=button[name='Shipped']" },
        { "scroll": 900 },
        { "click": "role=link[name=/Order 10\\d\\d/]", "label": "list-before-open" },
        { "back": true },
        { "expect": { "pressed": "Shipped", "sameAs": "list-before-open" } }
      ]
    }
  ]
}
```

Steps (one action key each):

| Step | Does |
|---|---|
| `goto` path | navigate in this tab |
| `click` selector · `hover` selector | act on the first match |
| `fill` [selector, value] · `select` [selector, option] | type into a field, choose an option |
| `press` key | keyboard (`Escape`, `Enter`) |
| `back` · `forward` · `reload` | browser history and refresh |
| `scroll` y or `"bottom"` · `wait` ms · `waitFor` selector | position and timing |
| `setCookie` {name, value} · `clearCookies` · `setViewport` name or `WxH` | session and layout |
| `coldOpen` true or a path, with `as` | open the current URL (or the path) in a new browser with no history, the way a recipient of a shared link would. `as`: `"signed-out"` (default, no cookies or storage), `"same"` (a copy of the current session), or a profile name. Compared with the page it came from. Add `"continue": true` to carry on in the new browser |
| `openInNewTab` selector | Cmd/Ctrl-click the control. Reports when it is not a link, when it navigates this tab instead, or when the new tab is a dead end. `"continue": true` carries on in the new tab |
| `expect` {...} | check the current state |

Any step may add `within` (a selector to scope the locator), `label` (names the resulting state for `sameAs`), an inline `expect`, and `optional: true`. Without `optional`, a step whose action fails (selector not found, timeout, navigation error) fails the journey: it is reported as a failed check and the remaining steps are skipped, because they would run against the wrong page.

Spec options: `profiles` (named accounts for `coldOpen`, each `cookies` and/or `storageState`), `allowWrites` (URL globs whose POST, PUT, PATCH and DELETE requests may go through; everything else is blocked and reported as `write-blocked`; `true` allows all), `reveal: true` (record typed values in clear, for synthetic test data only), `accept` (defects that are intended behaviour, each `{ "type", "journey"?, "path"?, "reason" }` or just the type; they stay in the report but no longer fail the run). Command flags: `--keep-text` keeps page text in the written log, `--reveal` is the same as `reveal: true`.

Selectors are Playwright locators: `role=link[name='Customers']`, `text=Next customer →`, CSS. Prefer roles and accessible names; they double as an accessibility check.

Viewports: `desktop` 1366×860, `laptop` 1180×760, `tablet` 820×1100, `mobile` 390×844 (touch), or `WxH`.

Expectations (all optional): `url`, `path`, `h1`, `title` (exact string or `/regex/`), `text` and `notText` (in main content), `dialog` (true/false or name), `tab` (selected tab name), `pressed` (pressed or checked control name), `field` ({ "label": "value" }), `scrollY` (`">0"`, `"<100"`), `focus` (`"not-body"` or a name), `navVisible`, `activeNav` (`"Orders"` or { "region": "Sidebar", "text": "Orders" }: every nav system, or the named one, must mark it current), `historyDelta` (entries added by the step), `sameAs` (label of an earlier state: no difference in heading, dialogs, tabs, pressed controls, fields). `text` and `notText` are checked while the journey runs; re-analysing a saved log with `ea transitions` marks them not checkable, because page text is not written to disk.

Each journey starts in a fresh tab. To test Back, go to the page before it first (two `goto` steps); Back from a journey's first page fails with a message saying so. After every action the runner waits until the page stops changing and nothing is marked busy, up to 4 seconds; add `waitFor` for anything slower. `text` checks see the title, every heading and the body text.

Write journeys from user intent ("come back to the same list"), not from the implementation. The anomaly checks catch generic breakage; expectations encode what this product promises. Never include steps that delete, pay, send, or change accounts.

## Hand-collected log (`ea transitions`)

```json
{ "runs": [ { "journey": "drawer-back", "viewport": "desktop", "steps": [
  { "i": 0, "type": "goto", "desc": "open /customers", "requested": "/customers", "snapshot": { "...": "probe output" } },
  { "i": 1, "type": "click", "desc": "click Globex row", "snapshot": { } },
  { "i": 2, "type": "back", "desc": "browser Back", "snapshot": { } },
  { "i": 3, "type": "expect", "expect": { "dialog": false }, "snapshot": { } }
] } ] }
```

`type` must be one of the step names above so the history model knows which steps are traversals. A step that failed carries `"error"`; it is reported as a failed check. Add `requested` on `goto` steps so deep-link loss can be detected.

## Proposal (`ea prototype`, `ea sitemap`)

```json
{
  "name": "A · One sidebar, records own their tabs",
  "summary": "One line on the idea",
  "chrome": { "primary": "sidebar | topbar", "mobile": "bottom-bar | drawer", "utilityLabel": "Workspace" },
  "sections": [
    { "label": "Customers", "path": "/customers",
      "views": [{ "label": "Active", "key": "active" }, { "label": "Archived", "key": "archived" }],
      "viewParam": "status", "viewHistory": "replace",
      "absorbs": ["/customers/archive"], "purpose": "optional sentence", "note": "optional",
      "children": [
        { "label": "Customer", "path": "/customers/:id", "tabs": ["Overview", "Orders", "Notes"], "tabParam": "tab", "tabHistory": "replace",
          "absorbs": ["/customers/:id/notes"], "overlays": [{ "label": "Order peek", "url": "/customers/:id?order=:orderId" }] }
      ] }
  ],
  "utility": [{ "label": "Settings", "path": "/settings", "children": [] }],
  "retire": [{ "path": "/insights", "to": "/reports", "reason": "why" }]
}
```

`sections` are primary destinations; `utility` are secondary (settings, admin). `status` on any node (`new`, `merge`, `move`) overrides the colour derived from `absorbs`.

## Migration mapping (`ea migrate`)

```json
{
  "baseUrl": "http://localhost:3000",
  "keepRest": false,
  "keep": ["/", "/orders", "/orders/:id"],
  "targets": ["/customers", "/customers/:id", "..."],
  "permanent": false,
  "moves": [{ "from": "/customers/:id/notes", "to": "/customers/:id?tab=notes", "reason": "duplicate of the tab" }],
  "retire": [{ "path": "/insights", "to": "/reports" }, { "path": "/legacy-export", "reason": "no users; 410" }]
}
```

Paths use `:param` syntax for both Next.js and React Router. `targets` (the proposal's route list) enables the missing-target check. Leave `keepRest` false for real migrations so every page gets an explicit decision.
