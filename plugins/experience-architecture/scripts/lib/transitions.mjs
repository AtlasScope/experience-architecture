// Analyze journey logs: reconstruct browser history, check continuity invariants and expectations,
// and build an interaction-state transition map. Input shape:
// { runs: [ { journey, viewport, steps: [ { i, type, desc, snapshot, expect?, requested?, redirects? } ] } ] }
// Works on logs produced by `ea journey` or assembled by hand from `ea probe` snapshots.

const ID_SEG = /^(\d+|[0-9a-f]{8,}|[0-9a-f-]{36}|[A-Z0-9]{6,}|[a-z]+[-_]\d+)$/;
export const shape = (p) => (p || '').split('/').map((s) => (ID_SEG.test(s) ? ':id' : s)).join('/') || '/';
const qkeys = (search) => [...new URLSearchParams(search || '').keys()].sort();
const viewKey = (s) => s && JSON.stringify({ h1: s.h1, dialogs: s.dialogs, tabs: s.tabs, pressed: s.pressed, fields: (s.fields || []).filter((f) => f.value && f.value !== 'false') });
const diffView = (a, b) => {
  const out = [];
  for (const k of ['h1', 'dialogs', 'tabs', 'pressed']) if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) out.push({ what: k, before: a?.[k], after: b?.[k] });
  const fa = Object.fromEntries((a?.fields || []).map((f) => [f.name, f.value]));
  const fb = Object.fromEntries((b?.fields || []).map((f) => [f.name, f.value]));
  for (const n of new Set([...Object.keys(fa), ...Object.keys(fb)])) if ((fa[n] || '') !== (fb[n] || '') && (fa[n] || fb[n]) && n !== 'Search') out.push({ what: `field "${n}"`, before: fa[n] ?? null, after: fb[n] ?? null });
  return out;
};
const brief = (s) => s && { url: s.url, h1: s.h1, dialogs: s.dialogs, tabs: s.tabs, pressed: s.pressed, scrollY: s.scrollY, focus: s.focus?.isBody ? 'body' : s.focus?.name || s.focus?.tag };

export function analyzeLog(log, { accept = log.accept || [] } = {}) {
  const anomalies = []; const expectations = []; const transitions = []; const failedRuns = [];
  for (const run of log.runs || []) {
    const entries = []; const views = []; let pos = -1; let prev = null; const lastAt = new Map(); const labelled = new Map(); let skipped = 0;
    const A = (step, type, severity, expected, observed, before, after, extra = {}) => anomalies.push({ journey: run.journey, viewport: run.viewport, step: step.i, action: step.desc, type, severity, start: brief(before), expected, observed, after: brief(after), ...extra });
    for (const step of run.steps) {
      const s = step.snapshot;
      if (s && (s.path === 'blank' || /^about:/.test(s.url || ''))) continue;
      if (step.skipped) { skipped++; continue; }
      if (step.type === 'expect') { evalExpect(run, step, s, prev, labelled, expectations); continue; }
      if (step.blockedWrites?.length) A(step, 'write-blocked', 'info', 'the step completes without changing data', `blocked ${step.blockedWrites.join(', ')} (add to "allowWrites" if this journey must write)`, prev, s);
      if (step.error) {
        // A failed action means the journey did not test what it meant to test. It counts as a failure.
        if (step.optional) A(step, 'optional-step-failed', 'info', 'step runs', step.error, prev, s);
        else expectations.push({ journey: run.journey, viewport: run.viewport, step: step.i, what: `action: ${step.desc}`, expected: 'the action runs', observed: step.error, pass: false, kind: 'action' });
      }
      if (!s || s.error) continue;
      if (step.other) { otherTab(step, s, A, labelled); continue; }
      const before = prev;
      // ---- history model ----
      let op = 'none'; let leftView;
      const sameDoc = before && before.doc === s.doc;
      const dPush = sameDoc ? s.history.push - before.history.push : 0;
      const dRep = sameDoc ? s.history.replace - before.history.replace : 0;
      if (step.type === 'back' || step.type === 'forward') {
        const target = step.type === 'back' ? pos - 1 : pos + 1;
        const expected = entries[target];
        leftView = views[target]; // the view the user last saw at the entry Back/Forward returns to
        if (expected && expected !== '?' && expected !== s.url) A(step, step.type === 'back' ? 'back-unexpected' : 'forward-unexpected', 'defect', expected, s.url, before, s);
        if (target >= 0 && target < Math.max(entries.length, s.historyLength)) pos = target;
        op = step.type;
      } else if (step.type === 'reload') {
        op = 'reload';
      } else if (!before || !sameDoc) {
        // full document navigation (goto, hard link, location.assign/replace, server redirect)
        const lenGrew = !before || s.historyLength > before.historyLength || pos < entries.length - 1;
        if (before && !lenGrew && s.url !== before.url) { entries[pos] = s.url; op = 'doc-replace'; } else { entries.splice(pos + 1, Infinity, s.url); pos++; op = 'doc-push'; }
      } else {
        for (let k = 0; k < dPush; k++) { entries.splice(pos + 1, Infinity, k === dPush - 1 ? s.url : '?'); pos++; }
        if (dRep && !dPush) entries[pos] = s.url; else if (dPush) entries[pos] = s.url;
        op = dPush ? (dPush > 1 ? `push×${dPush}` : 'push') : dRep ? 'replace' : s.url !== before.url ? 'url-change' : 'none';
      }
      // ---- invariants ----
      if (before) {
        const pathChanged = before.path !== s.path;
        const queryOnly = !pathChanged && before.search !== s.search;
        if (step.type === 'back' && before.dialogs?.length && pathChanged) A(step, 'back-left-overlay', 'defect', `Back closes "${before.dialogs[0]}" and stays on ${before.path}`, `Back left ${before.path} for ${s.url}`, before, s);
        if (step.type === 'back' && !pathChanged && queryOnly && !before.dialogs?.length) A(step, 'back-stayed-on-page', 'likely', `Back returns to the previous place`, `Back only changed ${before.search || '(none)'} → ${s.search || '(none)'} on ${s.path}`, before, s);
        if (step.type === 'click' && queryOnly && /push/.test(op) && !s.dialogs?.length && !before.dialogs?.length) A(step, 'view-state-push', 'judgment', 'a view change that replaces the current entry', `${op}: ${before.search || '(none)'} → ${s.search}`, before, s);
        if (step.type === 'click' && s.dialogs?.length > (before.dialogs?.length || 0) && !/push/.test(op)) A(step, 'overlay-without-history', 'likely', 'opening an overlay adds a history entry (so Back closes it) or leaves history alone and closes on Escape', `opened "${s.dialogs[0]}" with ${op}${op === 'replace' ? ' — Back will leave the page' : ''}`, before, s);
        if (step.type === 'reload') {
          const d = diffView(before, s);
          if (before.url === s.url && d.length) A(step, 'refresh-divergence', 'defect', 'refresh shows the same view', d.map((x) => `${x.what}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`).join('; '), before, s, { diff: d });
        }
        // Compare with the view at the history entry Back returned to. Matching by URL alone would compare a
        // closed overlay with the same address while it was open (an overlay that pushes the same URL).
        if ((step.type === 'back' || step.type === 'forward') && (leftView || lastAt.has(s.url))) {
          const was = leftView || lastAt.get(s.url);
          const d = diffView(was, s);
          if (d.length) A(step, 'restoration-divergence', 'defect', `returning to ${s.url} restores the view the user left`, d.map((x) => `${x.what}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`).join('; '), was, s, { diff: d });
          if (was.scrollY > 200 && Math.abs(was.scrollY - s.scrollY) > 150) A(step, 'scroll-not-restored', 'defect', `scroll ${was.scrollY}`, `scroll ${s.scrollY}`, was, s);
        }
        // clicked an in-app link to a page already in history at pos-1 (in-app "back" that pushes)
        if (step.type === 'click' && /push/.test(op) && entries[pos - 2] === s.url) A(step, 'in-app-back-push', 'likely', `returning to ${s.url} reuses the existing entry (history.back) so state is restored and Back does not loop`, `pushed a new ${s.url} entry; browser Back now returns to ${before.url}`, before, s);
        if (step.type === 'click' && lastAt.has(s.url) && /push/.test(op)) {
          const d = diffView(lastAt.get(s.url), s).filter((x) => x.what !== 'h1');
          if (d.length && entries[pos - 2] === s.url) A(step, 'in-app-back-loses-state', 'defect', 'the list comes back as the user left it', d.map((x) => `${x.what}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`).join('; '), lastAt.get(s.url), s);
        }
        // entity switch leakage
        if (pathChanged && shape(before.path) === shape(s.path) && before.path !== s.path) {
          const fa = Object.fromEntries((before.fields || []).filter((f) => f.value && f.value !== 'false').map((f) => [f.name, f.value]));
          const leaked = (s.fields || []).filter((f) => f.value && f.value !== 'false' && fa[f.name] === f.value && f.name !== 'Search');
          if (leaked.length) A(step, 'state-leak-between-entities', 'defect', `${s.path} starts clean`, `carried over from ${before.path}: ${leaked.map((f) => `"${f.name}" = "${f.value}"`).join(', ')}`, before, s);
          if (before.dialogs?.length && s.dialogs?.length && before.dialogs[0] === s.dialogs[0]) A(step, 'overlay-leak-between-entities', 'likely', 'overlays close when the entity changes', `"${s.dialogs[0]}" stayed open`, before, s);
        }
        if (pathChanged && s.focus?.isBody && !['goto', 'reload'].includes(step.type)) A(step, 'focus-not-managed', 'info', 'focus moves to the new page heading or main region', 'focus left on <body>', before, s);
        if (before.dialogs?.length > (s.dialogs?.length || 0) && s.focus?.isBody) A(step, 'focus-lost-after-overlay', 'likely', 'focus returns to the control that opened the overlay', 'focus left on <body>', before, s);
        if (pathChanged && before.title === s.title && before.h1 !== s.h1) A(step, 'title-stale', 'info', 'document title follows the page', `title stays "${s.title}"`, before, s);
      }
      if (step.type === 'goto' && step.requested) {
        const req = step.requested.split('#')[0];
        if (s.url.split('#')[0] !== req && /login|signin|sign-in|auth/i.test(s.path) && !/[?&](next|from|redirect|returnTo|returnUrl|callbackUrl)=/i.test(s.search)) A(step, 'deep-link-loss', 'defect', `the sign-in page remembers ${req}`, `redirected to ${s.url} with no return address`, null, s, { requested: req });
        if ((step.redirects || []).length > 1) A(step, 'redirect-chain', 'likely', 'one redirect at most', [...step.redirects, s.url].join(' → '), null, s);
      }
      if (s.notFound) A(step, 'dead-end', 'defect', 'a page', `not-found at ${s.url}`, before, s);
      // active-state consistency
      const regs = (s.regions || []).filter((r) => !r.hidden && r.links.length >= 3 && !/tablist|footer|breadcrumb/i.test(r.region));
      const marked = regs.filter((r) => r.links.some((l) => l.current));
      const missing = regs.filter((r) => !r.links.some((l) => l.current) && r.links.some((l) => l.href && l.href.split('?')[0] !== '/' && s.path.startsWith(l.href.split('?')[0])));
      if (marked.length && missing.length) A(step, 'active-state-mismatch', 'defect', `every nav system marks the section for ${s.path}`, `${marked.map((r) => r.region + ' marks ' + r.links.filter((l) => l.current).map((l) => l.text).join('/')).join('; ')}; ${missing.map((r) => r.region).join(', ')} marks nothing`, before, s);
      if (run.viewport && /mobile|^3\d\dx/.test(run.viewport) && (!s.contentType || /html/.test(s.contentType)) && !s.navVisible) A(step, 'no-visible-nav', 'defect', 'a way to reach other sections', 'no visible navigation region', before, s);

      if (pos >= 0) { views.length = Math.min(views.length, entries.length); views[pos] = s; }
      transitions.push({ journey: run.journey, viewport: run.viewport, from: before ? stateId(before) : 'entry', to: stateId(s), action: step.desc, type: step.type, op });
      if (step.label) labelled.set(step.label, s);
      lastAt.set(s.url, s);
      prev = s;
    }
    if (run.failed) failedRuns.push({ journey: run.journey, viewport: run.viewport, error: run.failed, skipped });
  }
  // de-duplicate anomalies across viewports: keep first, count others
  const keyOf = (a) => `${a.type}|${a.journey}|${a.step}`;
  const merged = new Map();
  for (const a of anomalies) { const k = keyOf(a); if (merged.has(k)) merged.get(k).alsoIn.push(a.viewport); else merged.set(k, { ...a, alsoIn: [] }); }
  // collapse repeats: same type on the same page shape (defects/likely), or same type anywhere (info/judgment noise)
  const grouped = new Map();
  for (const a of merged.values()) {
    const k = ['info'].includes(a.severity) ? a.type : `${a.type}|${shape((a.after?.url || a.start?.url || '').split('?')[0])}`;
    if (!grouped.has(k)) grouped.set(k, { ...a, occurrences: 1, seenIn: [`${a.journey}#${a.step}`] });
    else { const g = grouped.get(k); g.occurrences++; if (g.seenIn.length < 6) g.seenIn.push(`${a.journey}#${a.step}`); }
  }
  const result = { anomalies: [...grouped.values()], expectations, transitions, failedRuns, stats: { runs: (log.runs || []).length, steps: (log.runs || []).reduce((n, r) => n + r.steps.length, 0) } };
  result.verdict = verdictOf(result, accept);
  return result;
}

// The pass/fail contract.
// - fail: a stated expectation failed, a journey stopped at an action it could not perform, or the automatic
//   checks found a defect-level problem that the spec has not accepted ("accept": [{ "type", "journey"?,
//   "path"?, "reason" }]). likely, judgment and info anomalies never fail a run.
// - pass: no failure and at least one stated expectation was checked and met. Only this is a verified result.
// - exploratory: no failure, but no expectation was checked, so nothing was verified; findings are leads.
// Checks that could not be evaluated from the log (pass: null) are neither met nor failed and are reported.
export function verdictOf(a, accept = []) {
  const accepted = (x) => accept.some((r) => (typeof r === 'string' ? r === x.type : r.type === x.type
    && (!r.journey || r.journey === x.journey)
    && (!r.path || (x.after?.url || x.start?.url || '').split('?')[0].startsWith(r.path))));
  const defects = a.anomalies.filter((x) => x.severity === 'defect');
  const open = defects.filter((x) => !accepted(x));
  const stated = a.expectations.filter((e) => e.kind !== 'action'); // failed actions are counted as stopped runs
  const failedChecks = stated.filter((e) => e.pass === false);
  const unchecked = stated.filter((e) => e.pass == null);
  const met = stated.filter((e) => e.pass === true);
  const reasons = [];
  if (failedChecks.length) reasons.push(`${failedChecks.length} stated check(s) failed`);
  if (a.failedRuns.length) reasons.push(`${a.failedRuns.length} journey run(s) stopped at an action that could not run`);
  if (open.length) reasons.push(`${open.length} defect(s) found by the automatic checks (${[...new Set(open.map((x) => x.type))].join(', ')})`);
  const result = reasons.length ? 'fail' : met.length ? 'pass' : 'exploratory';
  const summary = result === 'fail' ? `FAIL: ${reasons.join('; ')}.`
    : result === 'pass' ? `PASS: ${met.length} stated check(s) met, no journey stopped, no open defects${defects.length ? ` (${defects.length} accepted)` : ''}.`
    : `EXPLORATORY: no stated check was evaluated, so nothing here is verified. No defects found by the automatic checks${defects.length ? ` beyond ${defects.length} accepted` : ''}.`;
  return { result, summary: summary + (unchecked.length ? ` ${unchecked.length} check(s) could not be evaluated from this log.` : ''), met: met.length, failedChecks: failedChecks.length, unchecked: unchecked.length, stoppedRuns: a.failedRuns.length, openDefects: open.length, acceptedDefects: defects.length - open.length, otherAnomalies: a.anomalies.length - defects.length };
}

// Steps whose snapshot comes from another browser or tab: a cold open of a shared link, or a Cmd/Ctrl-click.
// They are compared with the page they came from and do not move the history model.
function otherTab(step, s, A, labelled) {
  const ref = step.reference;
  if (step.type === 'coldOpen') {
    const req = (step.target || '').split('#')[0];
    const onLogin = /login|signin|sign-in|auth/i.test(s.path) && !/login|signin|sign-in|auth/i.test(ref?.path || '');
    if (onLogin) {
      if (!/[?&](next|from|redirect|returnTo|returnUrl|callbackUrl)=/i.test(s.search)) A(step, 'deep-link-loss', 'defect', `the sign-in page remembers ${req}`, `a ${step.as} recipient was sent to ${s.url} with no return address`, ref, s, { requested: req });
    } else if (s.notFound || step.status >= 400) {
      A(step, 'cold-open-dead', 'defect', `a ${step.as} browser opening ${req} sees the page`, `${step.status || ''} ${s.notFound ? 'not-found page' : ''} at ${s.url}`.trim(), ref, s);
    } else if (ref) {
      const d = diffView(ref, s).filter((x) => !String(x.what).startsWith('field'));
      const urlMoved = s.url.split('#')[0] !== req && s.path !== ref.path;
      if (urlMoved || d.length) A(step, 'cold-open-differs', urlMoved ? 'defect' : 'likely', `a ${step.as} browser opening ${req} sees what the sender saw`, [urlMoved ? `landed on ${s.url}` : null, ...d.map((x) => `${x.what}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`)].filter(Boolean).join('; '), ref, s, { diff: d });
    }
  }
  if (step.type === 'openInNewTab') {
    if (step.newTab === 'none') {
      if (step.sameTabUrl) A(step, 'new-tab-hijacked', 'defect', 'Cmd/Ctrl-click opens a new tab and leaves this one alone', `navigated this tab to ${step.sameTabUrl}`, ref, s);
      else if (!step.href) A(step, 'not-a-link', 'defect', `"${step.desc}" can be opened in a new tab, bookmarked or copied`, 'it is not a link (no href); Cmd/Ctrl-click and middle-click do nothing', ref, s);
      else A(step, 'new-tab-blocked', 'likely', 'Cmd/Ctrl-click opens a new tab', `link to ${step.href} did not open one`, ref, s);
    } else if (s.notFound) A(step, 'dead-end', 'defect', 'the new tab shows the page', `not-found at ${s.url}`, ref, s);
  }
  if (step.label) labelled.set(step.label, s);
}

const stateId = (s) => `${shape(s.path)}${qkeys(s.search).length ? '?' + qkeys(s.search).join('&') : ''}${s.dialogs?.length ? ' +overlay' : ''}`;

function cmp(spec, actual) {
  if (spec == null) return true;
  if (typeof spec === 'string' && spec.startsWith('/') && spec.length > 2 && spec.endsWith('/')) return new RegExp(spec.slice(1, -1)).test(String(actual));
  if (typeof spec === 'string' && /^[<>]=?\s*-?\d/.test(spec)) { const n = Number(spec.replace(/[<>=\s]/g, '')); return spec.startsWith('>=') ? actual >= n : spec.startsWith('<=') ? actual <= n : spec.startsWith('>') ? actual > n : actual < n; }
  return String(spec) === String(actual);
}

function evalExpect(run, step, s, prev, labelled, out) {
  const e = step.expect || {};
  const check = (what, expected, observed, pass) => out.push({ journey: run.journey, viewport: run.viewport, step: step.i, what, expected, observed, pass });
  if ('url' in e) check('url', e.url, s.url, cmp(e.url, s.url));
  if ('path' in e) check('path', e.path, s.path, cmp(e.path, s.path));
  if ('h1' in e) check('h1', e.h1, s.h1, cmp(e.h1, s.h1));
  if ('title' in e) check('title', e.title, s.title, cmp(e.title, s.title));
  const hasText = typeof s.mainText === 'string';
  if ('text' in e) check('text', e.text, hasText ? (s.mainText.includes(e.text) ? 'present' : 'absent') : 'page text not recorded', hasText ? s.mainText.includes(e.text) : null);
  if ('notText' in e) check('notText', e.notText, hasText ? (s.mainText.includes(e.notText) ? 'present' : 'absent') : 'page text not recorded', hasText ? !s.mainText.includes(e.notText) : null);
  if ('dialog' in e) check('dialog', e.dialog, s.dialogs, typeof e.dialog === 'boolean' ? !!s.dialogs.length === e.dialog : s.dialogs.some((d) => d.includes(e.dialog)));
  if ('tab' in e) check('tab', e.tab, s.tabs, s.tabs.some((t) => cmp(e.tab, t)));
  if ('pressed' in e) check('pressed', e.pressed, s.pressed, s.pressed.some((t) => cmp(e.pressed, t)));
  if ('scrollY' in e) check('scrollY', e.scrollY, s.scrollY, cmp(e.scrollY, s.scrollY));
  if ('focus' in e) { const f = s.focus?.isBody ? 'body' : `${s.focus?.tag}${s.focus?.name ? ' ' + s.focus.name : ''}`; check('focus', e.focus, f, e.focus === 'not-body' ? !s.focus?.isBody : f.includes(e.focus)); }
  if ('navVisible' in e) check('navVisible', e.navVisible, s.navVisible, s.navVisible === e.navVisible);
  if ('field' in e) for (const [n, v] of Object.entries(e.field)) { const f = (s.fields || []).find((x) => x.name === n); check(`field ${n}`, v, f?.value ?? null, cmp(v, f?.value ?? '')); }
  if ('activeNav' in e) {
    const cur = (s.regions || []).flatMap((r) => r.links.filter((l) => l.current).map((l) => `${r.region}: ${l.text}`));
    const want = typeof e.activeNav === 'string' ? { text: e.activeNav } : e.activeNav;
    const regs = (s.regions || []).filter((r) => !want.region || r.region.includes(want.region)).filter((r) => !r.hidden && r.links.length >= 3 && !/tablist|footer|breadcrumb/i.test(r.region));
    const pass = regs.length > 0 && regs.every((r) => r.links.some((l) => l.current && l.text.includes(want.text)));
    check('activeNav', want, cur, pass);
  }
  if ('historyDelta' in e && prev) check('historyDelta', e.historyDelta, s.historyLength - prev.historyLength, s.historyLength - prev.historyLength === e.historyDelta);
  if ('sameAs' in e) { const ref = labelled.get(e.sameAs); const d = ref ? diffView(ref, s) : [{ what: 'missing label' }]; check(`sameAs ${e.sameAs}`, 'no difference', d.length ? d : 'same', !d.length && (!ref || ref.url === s.url)); }
}

export function transitionMermaid(a) {
  const ids = new Map(); const id = (s) => { if (!ids.has(s)) ids.set(s, `s${ids.size}`); return ids.get(s); };
  const L = ['stateDiagram-v2'];
  const edges = new Map();
  for (const t of a.transitions) {
    if (t.from === t.to && t.op === 'none') continue;
    const k = `${t.from}|${t.to}|${t.type}|${t.op}`;
    edges.set(k, t);
  }
  for (const t of edges.values()) L.push(`  ${t.from === 'entry' ? '[*]' : id(t.from)} --> ${id(t.to)}: ${t.type}${t.op && !['none', t.type].includes(t.op) ? ' (' + t.op + ')' : ''}`);
  for (const [s, i] of ids) L.splice(1, 0, `  state "${s.replace(/"/g, "'")}" as ${i}`);
  const bad = new Set(a.anomalies.filter((x) => x.severity === 'defect').map((x) => x.after?.url && stateId({ path: x.after.url.split('?')[0], search: x.after.url.includes('?') ? '?' + x.after.url.split('?')[1] : '', dialogs: x.after.dialogs })));
  for (const s of bad) if (ids.has(s)) L.push(`  class ${ids.get(s)} problem`);
  L.push('  classDef problem fill:#fecaca,stroke:#b91c1c');
  return L.join('\n');
}

export function transitionsMarkdown(a) {
  const L = ['# Journey verification', ''];
  if (a.verdict) L.push(`**${a.verdict.summary}**`, '', a.verdict.result === 'exploratory' ? 'Add `expect` steps for the promises the product makes to turn this into a regression check.' : a.verdict.result === 'fail' && a.verdict.openDefects && !a.verdict.failedChecks && !a.verdict.stoppedRuns ? 'If a defect below is intended behaviour, list it under `accept` in the spec with a reason.' : '', '');
  const failed = a.expectations.filter((e) => e.pass === false);
  const unknown = a.expectations.filter((e) => e.pass == null);
  L.push(`${a.stats.runs} run(s), ${a.stats.steps} steps. Checks: ${a.expectations.length - failed.length - unknown.length}/${a.expectations.length} met${unknown.length ? `, ${unknown.length} not checkable from this log` : ''}.${a.failedRuns?.length ? ` **${a.failedRuns.length} journey run(s) stopped early because an action failed.**` : ''} Anomalies: ${a.anomalies.length} (${a.anomalies.filter((x) => x.severity === 'defect').length} defect, ${a.anomalies.filter((x) => x.severity === 'likely').length} likely, ${a.anomalies.filter((x) => x.severity === 'judgment').length} judgment, ${a.anomalies.filter((x) => x.severity === 'info').length} info).`, '');
  if (a.failedRuns?.length) {
    L.push('## Journeys that did not finish', '', 'These journeys stopped at a failed action, so whatever came after that step was not tested. Fix the step (or the app) and rerun.', '', '| Journey | Viewport | Error | Steps skipped |', '|---|---|---|---|');
    for (const f of a.failedRuns) L.push(`| ${f.journey} | ${f.viewport} | ${String(f.error).replace(/\|/g, '/')} | ${f.skipped} |`);
    L.push('');
  }
  if (failed.length) {
    L.push('## Failed checks', '', '| Journey | Viewport | Step | Check | Expected | Observed |', '|---|---|---|---|---|---|');
    for (const e of failed) L.push(`| ${e.journey} | ${e.viewport} | ${e.step} | ${e.what} | ${JSON.stringify(e.expected)} | ${JSON.stringify(e.observed)} |`);
    L.push('');
  }
  L.push('## Anomalies', '');
  for (const sev of ['defect', 'likely', 'judgment', 'info']) for (const x of a.anomalies.filter((y) => y.severity === sev)) {
    L.push(`### ${x.type} (${sev}) — ${x.journey}, step ${x.step}${x.viewport ? `, ${x.viewport}` : ''}${x.alsoIn.length ? ` (also ${x.alsoIn.join(', ')})` : ''}${x.occurrences > 1 ? ` — seen ${x.occurrences}× (${x.seenIn.join(', ')})` : ''}`, '');
    L.push(`- Start: ${x.start ? `\`${x.start.url}\`${x.start.h1 ? ` "${x.start.h1}"` : ''}${x.start.dialogs?.length ? ` with "${x.start.dialogs[0]}" open` : ''}` : '(entry)'}`);
    L.push(`- Action: ${x.action}`);
    L.push(`- Expected: ${x.expected}`);
    L.push(`- Observed: ${x.observed}`, '');
  }
  return L.join('\n');
}
