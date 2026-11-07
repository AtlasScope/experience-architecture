// Builds the static experience model: routes, render trees, chrome, navigation graph, and signals.
import path from 'node:path';
import { walk, detectProject, importsOf, importBindings, rel, read as readSafe } from './files.mjs';
import { discoverRoutes, redirectsAndGuards, normalizeTarget, matchRoute, matchRedirect } from './routes.mjs';
import { scanFile, scanCss } from './scan.mjs';

const VIEW_STATE = /^(tab|activeTab|currentTab|filter|filters|status|sort|sortBy|order|page|view|mode|query|q|search|selected|selectedId|open|isOpen|expanded|panel|step|range|period)$/i;
const OVERLAY_KEYS = /^(selected|modal|drawer|dialog|panel|preview|open|sheet|inspect|detail|item)$/i;

export function buildModel(root, { maxFiles } = {}) {
  root = path.resolve(root);
  const project = detectProject(root);
  const files = walk(root, { maxFiles });
  const cssFiles = walk(root, { exts: ['.css', '.scss'] });
  const routes = discoverRoutes(root, files, project.frameworks);
  const { redirects, guards } = redirectsAndGuards(root, walk(root, { exts: ['.js', '.mjs', '.ts', '.cjs', '.jsx', '.tsx'] }));

  // import graph + closures
  const absOf = (r) => path.join(root, r);
  const imports = new Map();
  const bindings = new Map();
  for (const f of files) { imports.set(f, importsOf(f, project.aliases)); bindings.set(f, importBindings(f, project.aliases)); }
  const closureCache = new Map();
  const closure = (f) => {
    if (closureCache.has(f)) return closureCache.get(f);
    const seen = new Set([f]); const stack = [f];
    while (stack.length) for (const d of imports.get(stack.pop()) || []) if (!seen.has(d)) { seen.add(d); stack.push(d); }
    closureCache.set(f, seen); return seen;
  };

  const scans = new Map();
  for (const f of files) scans.set(f, scanFile(f));

  // ---- React Router: element -> component file, nested <Routes> mounts, route-level redirects ----
  const elementFile = (r, name) => { if (!name) return null; const b = bindings.get(absOf(r.file))?.get(name.split('.')[0]); return b ? b.file : (r.source.endsWith('jsx') && [...scans.keys()].includes(absOf(r.file)) && new RegExp(`function\\s+${name}\\b|const\\s+${name}\\s*=`).test(readSafe(absOf(r.file))) ? absOf(r.file) : null); };
  for (const r of routes.filter((x) => x.source.startsWith('react-router'))) {
    const f = elementFile(r, r.element);
    if (f) r.componentFile = rel(root, f);
    r.layouts = (r.layoutElements || []).map((n) => elementFile(r, n)).filter(Boolean).map((f2) => rel(root, f2));
  }
  for (const mount of routes.filter((x) => x.kind === 'mount' && x.componentFile)) {
    const prefix = mount.path.replace(/\/\*$/, '');
    for (const r of routes.filter((x) => x.relative && x.file === mount.componentFile)) {
      r.path = (prefix + (r.path === '/' ? '' : r.path.startsWith('/') ? r.path : '/' + r.path)) || '/';
      r.mountedFrom = mount.path;
      r.layouts = [...mount.layouts, mount.componentFile, ...r.layouts];
      r.params = (r.path.match(/:[\w]+|\*/g) || []).map((x) => x.replace(':', '') || 'splat');
    }
  }
  for (const r of routes.filter((x) => x.kind === 'redirect' && x.redirectTo != null)) {
    const base = r.path.replace(/\/\*$/, '') || '/';
    const to = r.redirectTo.startsWith('/') ? r.redirectTo : (base.replace(/\/$/, '') + '/' + r.redirectTo).replace(/\/+/g, '/');
    redirects.push({ from: r.path, to, kind: 'redirect', permanent: false, client: true, catchAll: /(^|\/)\*$/.test(r.path), file: r.file, line: r.line });
  }
  for (const r of redirects) if (r.from && /(^|\/)(\*|:path\*|\(\.\*\))$/.test(r.from)) r.catchAll = true;
  for (const r of routes) if (r.componentFile && r.componentFile !== r.file) { r.definedAt = `${r.file}:${r.line}`; r.file = r.componentFile; delete r.line; }

  // chrome = everything rendered by a layout/template (or a layout route's element) for the routes beneath it
  const chromeScope = new Map(); // file -> Set(route paths)
  const ownerOf = new Map(); // file -> Set(route paths) for page-owned
  const addTo = (map, f, p) => { if (!map.has(f)) map.set(f, new Set()); map.get(f).add(p); };
  for (const r of routes) {
    if (r.kind !== 'page') continue;
    for (const lf of [...(r.layouts || []), ...(r.templates || [])].filter((x) => x.includes('/') || x.includes('.'))) {
      const abs = absOf(lf);
      if (!imports.has(abs)) continue;
      for (const f of closure(abs)) addTo(chromeScope, f, r.path);
    }
    const pf = absOf(r.componentFile || r.file);
    if (imports.has(pf) && (r.componentFile || !r.source.startsWith('react-router'))) for (const f of closure(pf)) addTo(ownerOf, f, r.path);
  }

  // nav config arrays imported by a component become that component's links; URL helpers resolve dynamic targets
  for (const [f, s] of scans) {
    for (const [local, b] of bindings.get(f) || []) {
      const items = scans.get(b.file)?.navArrays?.[b.imported];
      const src = readSafe(f);
      if (items && new RegExp(`\\b${local}\\b[\\s\\S]*?(href|to)\\s*=\\s*\\{`).test(src)) {
        // the importer may build each item's URL under a prefix: href={`/w/${ws}${item.path}`}
        const pm = src.match(/`((?:[^`$]|\$\{[^}]*\})*?)\$\{\s*\w+\.(?:path|href|to|url)\s*\}/);
        const prefix = pm ? pm[1].replace(/\$\{[^}]*\}/g, ':param').replace(/\/+$/, '') : '';
        for (const it of items) s.refs.push({ kind: 'nav-item', tag: null, target: prefix && it.target?.startsWith('/') ? prefix + it.target : it.target, label: it.label, line: it.line, via: `${rel(root, b.file)}:${it.line} (${b.imported})` });
      }
    }
    for (const ref of s.refs) {
      if (ref.target != null || !ref.expr) continue;
      const call = ref.expr.match(/^(\w+)\s*\(/);
      const b = call && bindings.get(f)?.get(call[1]);
      const h = b ? scans.get(b.file)?.urlHelpers?.[b.imported] : call ? s.urlHelpers?.[call[1]] : null;
      if (h) { ref.target = h.templates[0]; ref.via = `${b ? rel(root, b.file) : rel(root, f)}:${h.line} (${call[1]})`; ref.expr = null; }
    }
  }

  // ---- edges ----
  const edges = [];
  for (const [f, s] of scans) {
    const relf = rel(root, f);
    const isChrome = chromeScope.has(f) && !(ownerOf.get(f)?.size === 1 && chromeScope.get(f).size <= 1);
    const owners = isChrome ? null : [...(ownerOf.get(f) || [])];
    const owner = isChrome ? `chrome:${relf}` : owners.length === 1 ? owners[0] : owners.length ? `shared:${relf}` : `file:${relf}`;
    for (const ref of s.refs) {
      const norm = ref.target != null ? normalizeTarget(ref.target) : null;
      let status; let targetRoute = null; let via = ref.via || null;
      if (ref.target == null || (norm && /:param[^/]|[^/]:param|^\/?:param/.test(norm.path))) status = 'dynamic';
      else if (!norm) status = 'external';
      else {
        const red = matchRedirect(norm.path, redirects);
        const m = matchRoute(norm.path, routes);
        if (red && !red.catchAll && (!m || m.path.includes('*'))) { status = 'redirected'; via = red.to; const m2 = matchRoute(normalizeTarget(red.to)?.path || '', routes); targetRoute = m2?.path || null; }
        else if (m && !(m.path.endsWith('*') && red?.catchAll)) { status = 'ok'; targetRoute = m.path; }
        else if (red?.catchAll) { status = 'dead'; via = `caught by ${red.from} → ${red.to}`; }
        else status = 'dead';
      }
      edges.push({ from: owner, file: relf, line: ref.line, via: ref.via, kind: ref.kind, tag: ref.tag, label: ref.label, target: ref.target, expr: ref.expr, query: norm?.queryKeys || [], targetRoute, status, via, scrollFalse: ref.scrollFalse, backLike: ref.backLike });
    }
  }

  // ---- route stats ----
  const pages = routes.filter((r) => r.kind === 'page');
  const inbound = new Map(pages.map((r) => [r.path, new Set()]));
  for (const e of edges) if (e.targetRoute && inbound.has(e.targetRoute) && e.from !== e.targetRoute) inbound.get(e.targetRoute).add(e.from);
  for (const g of guards) { const m = matchRoute(normalizeTarget(g.to)?.path || '', routes); if (m) inbound.get(m.path)?.add(`guard:${g.file}`); }
  for (const r of redirects) { const m = matchRoute(normalizeTarget(r.to)?.path || '', routes); if (m) inbound.get(m.path)?.add(`redirect:${r.file}`); }

  const chrome = [...chromeScope.entries()]
    .filter(([f]) => scans.get(f)?.refs.length)
    .map(([f, scope]) => {
      const s = scans.get(f);
      const targets = edges.filter((e) => e.file === rel(root, f) && e.targetRoute).map((e) => e.targetRoute);
      return { file: rel(root, f), scope: scope.size, scopeSample: [...scope].slice(0, 6), activeStrategy: s.activeStrategy, ariaCurrent: s.ariaCurrent, derivedCrumbs: s.derivedCrumbs, targets: [...new Set(targets)], mobileNavHint: s.mobileNavHint };
    });

  const signals = deriveSignals({ root, routes, pages, redirects, guards, edges, inbound, chrome, scans, chromeScope, ownerOf, cssFiles, absOf, rel: (f) => rel(root, f) });

  return {
    generatedAt: new Date().toISOString(),
    root, project,
    counts: { files: files.length, routes: routes.length, pages: pages.length, edges: edges.length, signals: signals.length },
    routes: routes.map((r) => ({ ...r, inbound: inbound.has(r.path) ? [...inbound.get(r.path)] : undefined })),
    redirects, guards, chrome, edges, signals,
  };
}

function sig(list, s) { list.push({ id: `${s.area}-${list.filter((x) => x.area === s.area).length + 1}`, ...s }); }

function deriveSignals(ctx) {
  const { routes, pages, redirects, guards, edges, inbound, chrome, scans, chromeScope, ownerOf, cssFiles, absOf, rel } = ctx;
  const out = [];
  const pagePaths = new Set(pages.map((r) => r.path));

  // orphans
  const dynamicCount = edges.filter((e) => e.status === 'dynamic').length;
  const unlinked = pages.filter((r) => !(r.path === '/' || /\/(404|500|_error|not-found)$/.test(r.path) || /(^|\/)(sign-?in|log-?in|signup|sign-?up|auth|register|logout|callback)(\/|$)/i.test(r.path)) && inbound.get(r.path)?.size === 0);
  if (dynamicCount && unlinked.length > 4) {
    // many unconfirmed orphans next to runtime-built links: one lead, not a wall of them
    // When most links are built in code, "nothing links here" is mostly an artefact of reading the code: say so
    // once, as a limit of the scan, and point at the crawl, which sees the real links.
    const literal = edges.filter((e) => e.status !== 'dynamic').length;
    if (dynamicCount >= literal || unlinked.length > pages.length * 0.3) sig(out, { area: 'ia', kind: 'scan-limit', title: `The code scan cannot tell which pages are unreachable: ${dynamicCount} links are built in code. Run "ea crawl" to find pages nothing links to`, evidence: unlinked.slice(0, 6).map((r) => ({ file: r.file })), pages: unlinked.map((r) => r.path), detail: `${unlinked.length} pages have no link written out literally in the code. With this many links built at runtime, that number says little.` });
    else sig(out, { area: 'ia', kind: 'orphan-candidate', title: `${unlinked.length} pages have no literal link pointing at them (${dynamicCount} links are built at runtime)`, evidence: unlinked.slice(0, 12).map((r) => ({ file: r.file })), pages: unlinked.map((r) => r.path), detail: `Pages: ${unlinked.map((r) => r.path).join(', ')}. Most are probably reached through links computed at runtime (sub-navs, tabs, settings menus). Confirm with a crawl before calling any of them unreachable.`, verify: 'Crawl the running app; any page still unvisited is a real orphan.' });
  }
  for (const r of dynamicCount && unlinked.length > 4 ? [] : unlinked) {
    {
      const sure = dynamicCount === 0;
      sig(out, { area: 'ia', kind: sure ? 'orphan' : 'orphan-candidate', title: sure ? `No in-app path reaches ${r.path}` : `No statically resolvable link reaches ${r.path}`, evidence: [{ file: r.file }], detail: sure ? 'No link, navigation call, redirect or guard targets this route. It can only be reached by typing the URL or from outside the app.' : `No literal link, redirect or guard targets this route, but ${dynamicCount} navigation target(s) are computed at runtime and may reach it. Treat as unconfirmed until a crawl or code read settles it.`, verify: 'Check the unresolved dynamic targets in summary.md; crawl the running app to confirm.' });
    }
  }
  // dead links
  const dead = edges.filter((e) => e.status === 'dead');
  const deadBy = groupBy(dead, (e) => normalizeTarget(e.target).path);
  for (const [t, es] of deadBy) sig(out, { area: 'routing', kind: 'dead-link', title: `Links point at ${t}, which no route or redirect serves`, evidence: es.map((e) => ({ file: e.file, line: e.line, label: e.label })), detail: `${es.length} reference(s). Users get a not-found page.`, verify: `Open ${t} in the running app.` });

  // URL prefixes with no page (hackable URLs, derived breadcrumbs)
  const missingParents = new Set();
  for (const r of pages) {
    const segs = r.path.split('/').filter(Boolean);
    for (let i = 1; i < segs.length; i++) {
      const p = '/' + segs.slice(0, i).join('/');
      const red = matchRedirect(p, redirects, { catchAll: false });
      if (!p.includes('*') && !matchRoute(p, routes) && !red) missingParents.add(p);
    }
  }
  const crumbChrome = chrome.filter((c) => c.derivedCrumbs);
  if (missingParents.size) {
    sig(out, { area: 'routing', kind: crumbChrome.length ? 'dead-link' : 'missing-parent', title: crumbChrome.length ? `Breadcrumb-style links built from the URL hit ${missingParents.size} prefix(es) with no page` : `${missingParents.size} URL prefix(es) have no page`, evidence: crumbChrome.map((c) => ({ file: c.file })), paths: [...missingParents].sort(), detail: crumbChrome.length ? `${crumbChrome.map((c) => c.file).join(', ')} turns every URL prefix into a link. These prefixes 404: ${[...missingParents].sort().join(', ')}` : `Removing the last segment from a URL leads to a 404 at: ${[...missingParents].sort().join(', ')}`, verify: 'Visit each prefix in the running app.' });
  }

  // redirect chains
  for (const r of redirects.filter((x) => x.from && x.kind === 'redirect')) {
    const chain = [r.from, r.to]; let cur = r; let guard = 0;
    if (r.catchAll) continue;
    while (guard++ < 10) { const tp = normalizeTarget(cur.to)?.path || ''; const page = matchRoute(tp, routes); if (page && !page.path.includes('*')) break; const nx = matchRedirect(tp, redirects.filter((x) => x !== cur), { catchAll: false }); if (!nx || chain.includes(nx.to)) break; chain.push(nx.to); cur = nx; }
    if (chain.length > 2) sig(out, { area: 'routing', kind: 'redirect-chain', title: `Redirect chain: ${chain.join(' → ')}`, evidence: [{ file: r.file, line: r.line }], detail: `${chain.length - 1} hops. Each hop costs a round trip and an extra history decision; point ${r.from} straight at ${chain[chain.length - 1]}.`, verify: `curl -sI the first URL and count Location headers.` });
  }
  // auth guards that drop the destination
  // Only a redirect to a sign-in or access page can lose a deep link; other redirects (to settings, to a
  // provider's connect page) are product flows.
  const SIGN_IN = /sign-?in|log-?in|auth|access|session|welcome|waitlist|invite|onboard/i;
  for (const g of guards.filter((x) => x.kind === 'redirect' && !x.preservesDestination && SIGN_IN.test(String(x.to)))) {
    sig(out, { area: 'routing', kind: 'deep-link-loss', title: `Guard redirect to ${g.to} does not carry the requested URL`, evidence: [{ file: g.file, line: g.line }], detail: 'A signed-out user who opens a deep link is sent to the guard target with no record of where they were going, so after signing in they land on a default page.', verify: `Signed out, open a protected deep link, sign in, and check where you land.` });
  }

  // two addresses for one entity / identity in the query string
  for (const r of pages) {
    const f = absOf(r.file); const s = scans.get(f); if (!s) continue;
    const keys = closureKeys(f, scans, ownerOf, r.path);
    const child = pages.find((x) => x.path.startsWith(r.path + '/:'));
    const sel = keys.filter((k) => OVERLAY_KEYS.test(k) || /id$/i.test(k));
    if (child && sel.length) sig(out, { area: 'routing', kind: 'entity-two-urls', title: `An item can be addressed as ${r.path}?${sel[0]}=… and as ${child.path}`, evidence: [{ file: r.file }, { file: child.file }], detail: 'Two URL shapes identify the same thing. Links, bookmarks and analytics split between them and Back behaves differently depending on which one the user came through.', verify: 'Open both URLs; compare what is shown and what Back does.' });
    else if (!r.params.length && keys.some((k) => /^(id|\w+Id)$/.test(k))) sig(out, { area: 'routing', kind: 'identity-in-query', title: `${r.path} takes the entity it shows from ?${keys.find((k) => /^(id|\w+Id)$/.test(k))}=`, evidence: [{ file: r.file }], detail: 'Identity lives in the query string while sibling routes put identity in the path. The page sits outside the entity\'s URL hierarchy and its chrome.', verify: 'Check which section the page highlights and where its breadcrumbs lead.' });
  }

  // chrome: duplicated destinations and inconsistent active state
  const navChrome = chrome.filter((c) => c.targets.length >= 2);
  if (navChrome.length >= 2) {
    const counts = new Map();
    for (const c of navChrome) for (const t of c.targets) counts.set(t, (counts.get(t) || []).concat(c.file));
    const dup = [...counts.entries()].filter(([, fs]) => fs.length > 1);
    if (dup.length) sig(out, { area: 'chrome', kind: 'duplicate-nav', title: `${dup.length} destination(s) are linked from more than one persistent nav system`, evidence: navChrome.map((c) => ({ file: c.file })), destinations: dup.map(([t, fs]) => ({ target: t, from: fs })), detail: `Shared: ${dup.map(([t]) => t).join(', ')}. Two systems claiming the same job means two active states to keep in sync and no clear owner for where something lives.`, verify: 'Visit a nested page and compare which item each system highlights.' });
    const strategies = new Set(navChrome.map((c) => c.activeStrategy || 'none'));
    if (strategies.size > 1) sig(out, { area: 'chrome', kind: 'active-state-mismatch', title: `Persistent nav systems compute "current" differently (${[...strategies].join(' vs ')})`, evidence: navChrome.map((c) => ({ file: c.file, note: c.activeStrategy || 'no active state' })), detail: 'On a nested route one system shows the section as current and another does not.', verify: 'Open a nested page (e.g. a detail route) and check both systems.' });
  }
  for (const c of navChrome.filter((x) => x.activeStrategy === 'exact')) {
    const nested = c.targets.filter((t) => pages.some((p) => p.path !== t && p.path.startsWith(t === '/' ? '/x' : t + '/')));
    if (nested.length) sig(out, { area: 'chrome', kind: 'active-state-exact', title: `${c.file} only marks an item current on an exact URL match`, evidence: [{ file: c.file }], detail: `Sections with child pages lose their highlight one level down: ${nested.join(', ')}.`, verify: `Open ${nested[0]}/<child> and check the item.` });
  }
  // label drift: same target, different labels; different targets with similar implementations handled below
  const labels = groupBy(edges.filter((e) => e.targetRoute && e.label && e.from.startsWith('chrome:')), (e) => e.targetRoute);
  for (const [t, es] of labels) {
    const ls = [...new Set(es.map((e) => e.label))];
    if (ls.length > 1) sig(out, { area: 'chrome', kind: 'label-drift', title: `${t} is labelled ${ls.map((l) => `"${l}"`).join(' and ')} in different places`, evidence: es.map((e) => ({ file: e.file, line: e.line })), detail: 'Different names for one destination make users think they are different places.', verify: 'Confirm in the UI.' });
  }

  // mobile: nav hidden below a breakpoint with no replacement
  const hidden = cssFiles.flatMap((f) => scanCss(f).filter((h) => /nav|sidebar|menu|topbar|header|rail/i.test(h.selector)).map((h) => ({ ...h, file: rel(f) })));
  const twHidden = [...scans.entries()].flatMap(([f, s]) => s.hiddenBelowBreakpoint.map((h) => ({ file: rel(f), line: h.line, selector: `<${h.tag}> hidden below ${h.bp}` })));
  const mobileReplacement = chrome.some((c) => c.mobileNavHint) || [...scans.values()].some((s) => s.mobileNavHint);
  if ((hidden.length || twHidden.length) && !mobileReplacement) sig(out, { area: 'chrome', kind: 'mobile-nav-missing', title: 'Navigation is hidden on small screens and nothing replaces it', evidence: [...hidden, ...twHidden].map((h) => ({ file: h.file, line: h.line, note: h.selector })), detail: 'No menu button, drawer or bottom bar was found for narrow viewports.', verify: 'Open the app at 375px wide and try to reach another section.' });
  if (crumbChrome.length) sig(out, { area: 'chrome', kind: 'raw-breadcrumbs', title: 'Breadcrumbs echo raw URL segments', evidence: crumbChrome.map((c) => ({ file: c.file })), detail: 'Labels come from the path (ids, route words), not from what the user knows the place as, and every prefix becomes a link whether or not it is a page.', verify: 'Open a detail page and read the breadcrumb.' });

  // state: templates holding state
  for (const r of routes) for (const t of r.templates) {
    const s = scans.get(absOf(t));
    if (s?.useStates.length && !out.some((o) => o.kind === 'template-state' && o.evidence[0].file === t)) sig(out, { area: 'continuity', kind: 'template-state', title: `${t} holds state that resets on every navigation`, evidence: [{ file: t, line: s.useStates[0].line }], detail: `Next.js templates remount on each navigation, so ${s.useStates.map((u) => u.name).join(', ')} start over every time the user moves between pages beneath it.`, verify: 'Change the state, navigate to a sibling page, and see whether it persists.' });
  }
  // state: providers above a dynamic segment (leak across entities)
  for (const [f, scope] of chromeScope) {
    const s = scans.get(f); if (!s || !(s.useStates.length && (s.context || s.provider))) continue;
    const dyn = [...scope].filter((p) => /\/:/.test(p));
    if (!dyn.length) continue;
    // A provider around most of the app (appearance, account, settings) is expected to keep its state
    // between records; only state scoped to one area that holds a record page is suspicious.
    // Keep it when the state holds what the user types or picks (drafts, selections, filters), which must not
    // follow them to the next record.
    const userWork = s.useStates.some((u) => /draft|text|note|input|value|form|select|editing|compose|message|body|filter|query/i.test(u.name));
    if (scope.size >= Math.max(5, pages.length * 0.5) && !userWork) continue;
    const fixedPrefix = commonPrefix([...scope]);
    if (dyn.some((p) => p.startsWith(fixedPrefix)) && !out.some((o) => o.kind === 'state-above-entity' && o.evidence[0].file === rel(f))) {
      sig(out, { area: 'continuity', kind: 'state-above-entity', title: `${rel(f)} keeps state above ${dyn[0]}`, evidence: [{ file: rel(f), line: s.useStates[0].line }], detail: `State named ${s.useStates.map((u) => u.name).join(', ')} survives when the user switches from one ${dyn[0]} to another. Anything entity-specific in it will leak between entities.`, verify: `Enter something on one ${dyn[0]}, go to another, and check.` });
    }
  }
  // state: view state in component memory only
  for (const r of pages) {
    const f = absOf(r.file); const s = scans.get(f); if (!s) continue;
    const vs = s.useStates.filter((u) => VIEW_STATE.test(u.name) && !s.queryKeysRead.includes(u.name));
    if (vs.length) sig(out, { area: 'continuity', kind: 'view-state-not-in-url', title: `${r.path}: ${vs.map((v) => v.name).join(', ')} live only in component memory`, evidence: vs.map((v) => ({ file: r.file, line: v.line })), detail: 'Refresh, Back from a child page, opening in a new tab and sharing the link all lose this state.', verify: 'Change it, open a child page, press Back; then refresh.' });
  }
  // history semantics
  for (const e of edges) {
    if (!['push', 'replace'].includes(e.kind) || e.from.startsWith('chrome:')) continue;
    const ownerPath = e.from;
    if (!pagePaths.has(ownerPath)) continue;
    const t = e.target ?? e.expr ?? '';
    const tn = e.target ? normalizeTarget(e.target) : null;
    const sameRoute = (tn && e.targetRoute === ownerPath) || /^[`'"]?\?/.test(t) || /pathname\s*\}?\s*\?/.test(t);
    const qkeys = tn?.queryKeys || [...t.matchAll(/[?&]([\w-]+)=/g)].map((m) => m[1]);
    if (e.kind === 'push' && sameRoute && qkeys.length && !qkeys.some((k) => OVERLAY_KEYS.test(k))) sig(out, { area: 'continuity', kind: 'view-state-push', title: `${ownerPath}: changing ${qkeys.join(', ')} adds a history entry`, evidence: [{ file: e.file, line: e.line }], detail: 'Back steps through every tab or filter change before leaving the page. Correct for filters people expect to undo, wrong for tabs on one record. Decide per control and usually use replace for tabs.', verify: 'Click through the control, then press Back and count steps.' });
    if (e.kind === 'replace' && qkeys.some((k) => OVERLAY_KEYS.test(k))) sig(out, { area: 'continuity', kind: 'overlay-replace', title: `${ownerPath}: an overlay opens with history.replace (?${qkeys.find((k) => OVERLAY_KEYS.test(k))}=)`, evidence: [{ file: e.file, line: e.line }], detail: 'Opening the overlay changes the URL without a history entry, so Back leaves the page instead of closing the overlay.', verify: 'Open the overlay, press Back.' });
    const tr = e.targetRoute;
    if (e.kind === 'push' && tr && tr !== ownerPath && ownerPath.startsWith(tr === '/' ? '/' : tr + '/')) sig(out, { area: 'continuity', kind: 'in-app-back-push', title: `${ownerPath}: the in-app way back pushes ${tr} instead of going back`, evidence: [{ file: e.file, line: e.line }], detail: `It creates a new ${tr} entry with fresh state (filters, scroll) and leaves the detail page behind it, so browser Back afterwards returns to the detail page.`, verify: `On ${tr}, change a filter and scroll, open an item, use the in-app back control, then press browser Back.` });
  }

  // IA: near-duplicate page implementations
  // compare list-like pages, including ones under a workspace or tenant param; skip record pages (last segment a param)
  const pageScans = pages.map((r) => ({ r, s: scans.get(absOf(r.file)) })).filter((x) => x.s && x.s.tokens.length >= 3 && !/\/:[^/]+$/.test(x.r.path) && !x.r.path.includes('*'));
  // components used by many pages (cards, layout primitives) say nothing about two pages being related
  const compUse = new Map(); for (const x of pageScans) for (const c of new Set(x.s.dataSig.filter((y) => y.startsWith('comp:')))) compUse.set(c, (compUse.get(c) || 0) + 1);
  // Framework building blocks (links, images, suspense boundaries) are not evidence of shared purpose either.
  const FRAMEWORK = /^comp:(Link|NavLink|Image|Head|Script|Suspense|Fragment|Outlet|Navigate|Form|Trans|Helmet|ErrorBoundary)$/;
  const common = (c) => FRAMEWORK.test(c) || compUse.get(c) > Math.max(5, pageScans.length * 0.25);
  for (let i = 0; i < pageScans.length; i++) for (let j = i + 1; j < pageScans.length; j++) {
    const a = pageScans[i]; const b = pageScans[j];
    const textSim = jaccard(a.s.tokens, b.s.tokens);
    const ad = a.s.dataSig.filter((x) => x.startsWith('data:')); const bd = b.s.dataSig.filter((x) => x.startsWith('data:'));
    const dataSim = ad.length && bd.length && a.s.dataSig.length >= 3 ? jaccard(a.s.dataSig, b.s.dataSig) : 0;
    const sharedComp = a.s.dataSig.filter((x) => x.startsWith('comp:') && b.s.dataSig.includes(x) && !common(x));
    const inter = a.s.dataSig.filter((x) => b.s.dataSig.includes(x)).length;
    const contain = inter / (Math.min(a.s.dataSig.length, b.s.dataSig.length) || 1);
    const sameSources = ad.length >= 2 && ad.length === bd.length && ad.every((x) => bd.includes(x));
    const dup = textSim >= 0.6 || (dataSim >= 0.9 && textSim >= 0.3) || (sameSources && dataSim >= 0.6 && textSim >= 0.4);
    const sameBase = sharedComp.length && (dataSim >= 0.6 || (contain >= 0.75 && a.s.dataSig.filter((x) => !x.startsWith('comp:') && b.s.dataSig.includes(x)).length >= 2));
    if (a.r.file === b.r.file) continue;
    if (dup) sig(out, { area: 'ia', kind: 'near-duplicate', title: `${a.r.path} and ${b.r.path} show mostly the same thing`, evidence: [{ file: a.r.file }, { file: b.r.file }], similarity: { text: +textSim.toFixed(2), data: +dataSim.toFixed(2) }, detail: `Visible text overlap ${Math.round(textSim * 100)}%, data and fields read ${Math.round(dataSim * 100)}%. Two destinations for one thing split users, links and maintenance.`, verify: 'Open both pages side by side.' });
    else if (dataSim >= 0.75 || sameBase) sig(out, { area: 'ia', kind: 'related-views', title: sameBase ? `${a.r.path} and ${b.r.path} are both built on <${sharedComp[0].slice(5)}>` : `${a.r.path} and ${b.r.path} are different views of the same data`, evidence: [{ file: a.r.file }, { file: b.r.file }], similarity: { text: +textSim.toFixed(2), data: +dataSim.toFixed(2) }, detail: 'They read the same records and fields but present them differently. Often one should be a filter, tab or mode of the other. This is a design question, not a defect.', verify: 'Decide whether users think of these as one place.' });
  }
  // routing: catch-all redirects
  for (const r of redirects.filter((x) => x.catchAll)) sig(out, { area: 'routing', kind: 'catch-all-redirect', title: `Unknown URLs${r.from === '*' || r.from === '/*' ? '' : ' under ' + r.from.replace(/\/?\*$/, '')} silently redirect to ${r.to}`, evidence: [{ file: r.file, line: r.line }], detail: 'Mistyped, removed and stale links show a real page with no not-found message, so broken links never surface and users do not know they missed their destination.', verify: 'Open a made-up URL.' });
  // routing: same state in path and query
  for (const r of pages) for (const p of r.params) {
    const listPath = r.path.slice(0, r.path.indexOf('/:' + p)).replace(/\/[^/:]+$/, (m) => (pages.some((x) => x.path === r.path.slice(0, r.path.indexOf('/:' + p)).replace(m, '')) ? '' : m));
    const sibling = pages.find((x) => x !== r && (x.path === listPath || r.path.startsWith(x.path + '/')) && closureKeys(absOf(x.file), scans).concat(edges.filter((e) => e.targetRoute === x.path).flatMap((e) => e.query)).includes(p));
    if (sibling) sig(out, { area: 'routing', kind: 'state-two-forms', title: `"${p}" is in the path on ${r.path} and in the query on ${sibling.path}?${p}=`, evidence: [{ file: r.file }, { file: sibling.file }], detail: 'The same view has two URL shapes, usually rendered by different components. Links, active states and bookmarks split between them.', verify: 'Open both forms for the same value and compare page, nav highlight and Back.' });
  }
  // routing: helpers that build query strings without encoding
  for (const [f, s] of scans) for (const n of s.unencodedQuery) sig(out, { area: 'routing', kind: 'unencoded-query', title: `${n}() builds a query string without encoding values`, evidence: [{ file: rel(f), line: s.urlHelpers[n].line }], detail: 'Values containing &, #, ?, + or spaces break the URL or are truncated.', verify: `Call ${n} with a value like "A & B" and inspect the link.` });
  // continuity: no scroll restoration in a client router
  if (routes.some((r) => r.source.startsWith('react-router') || r.source === 'tanstack') && ![...scans.values()].some((s) => s.scrollRestoration)) sig(out, { area: 'continuity', kind: 'no-scroll-restoration', title: 'Client-side routing with no scroll management', evidence: routes.filter((r) => r.definedAt).slice(0, 1).map((r) => ({ file: r.definedAt.split(':')[0] })), detail: 'Without <ScrollRestoration> or equivalent, a new page can open at the previous page\'s scroll offset and Back may not return to where the user was in a long list.', verify: 'Scroll a long list, open an item, then press Back.' });
  // continuity: components declared inside components
  for (const [f, s] of scans) for (const n of s.nestedComponents) sig(out, { area: 'continuity', kind: 'nested-component', title: `<${n.name}> is declared inside ${n.parent} and remounts on every render`, evidence: [{ file: rel(f), line: n.line }], detail: `Every re-render of ${n.parent} creates a new component type, so React discards ${n.name}'s state (selected tab, inputs, scroll) whenever the parent updates.`, verify: `Change something in ${n.name} (e.g. pick a tab), then trigger a parent update.` });
  // continuity: overlay open-state in persistent chrome or page memory
  for (const [f, s] of scans) if (s.overlayStates.length && (s.overlay || /Dialog|Modal|Drawer|Sheet/.test(readSafe(f))) && (chromeScope.has(f) || ownerOf.has(f))) {
    if (scans.get(f).readsSearchParams && s.queryKeysRead.some((k) => OVERLAY_KEYS.test(k))) continue;
    sig(out, { area: 'continuity', kind: 'overlay-not-in-url', title: `${rel(f)} opens an overlay from component state (${s.overlayStates.map((u) => u.name).join(', ')})`, evidence: s.overlayStates.map((u) => ({ file: rel(f), line: u.line })), detail: chromeScope.has(f) ? 'The overlay lives in persistent chrome: it survives navigation, Back does not close it and it cannot be linked to.' : 'The overlay cannot be linked to and Back does not close it. Fine for transient confirmations; wrong for things users create, share or return to.', verify: 'Open it, then press Back; open it and navigate elsewhere.' });
  }
  // continuity: entity-specific fields in a global store
  for (const [f, s] of scans) if (s.storeEntityFields.length && !/Record<|\[\w+:\s*string\]|byId|ById|Map</.test(readSafe(f))) sig(out, { area: 'continuity', kind: 'global-entity-state', title: `${rel(f)} keeps ${[...new Set(s.storeEntityFields.map((x) => x.name))].join(', ')} as single global value(s)`, evidence: s.storeEntityFields.map((x) => ({ file: rel(f), line: x.line })), detail: 'Something that belongs to one record (a draft, a selection) is stored once for the whole app, so it follows the user from one record to the next.', verify: 'Type in it on one record, open another record.' });
  // chrome: mobile nav that drops destinations
  const mobile = chrome.filter((c) => /mobile/i.test(c.file) || (c.mobileNavHint && c.targets.length));
  const desktop = new Set(chrome.filter((c) => !mobile.includes(c) && c.scope > 1).flatMap((c) => c.targets));
  for (const m of mobile) { const missing = [...desktop].filter((t) => !m.targets.includes(t)); if (missing.length && m.targets.length) sig(out, { area: 'chrome', kind: 'mobile-nav-subset', title: `${m.file} offers ${m.targets.length} destinations; desktop chrome offers ${desktop.size}`, evidence: [{ file: m.file }], missing, detail: `Not reachable from the small-screen navigation: ${missing.join(', ')}.`, verify: 'At 390px wide, try to reach each missing section.' }); }

  // IA: pages split from their entity (same entity word, different branches)
  for (const r of pages.filter((x) => !x.params.length)) {
    const head = r.path.split('/')[1] || '';
    const m = head.match(/^([a-z]+)-(.+)$/);
    if (m && pages.some((p) => p.path.startsWith(`/${m[1]}s/:`) || p.path.startsWith(`/${m[1]}/:`))) sig(out, { area: 'ia', kind: 'fragmented-entity', title: `${r.path} is about a ${m[1]} but lives outside /${m[1]}s`, evidence: [{ file: r.file }], detail: `A ${m[1]}'s information is split across branches of the URL tree; its chrome, breadcrumbs and active states disagree about where the user is.`, verify: `Open it from a ${m[1]} page and look at nav highlight and breadcrumb.` });
  }
  for (const r of pages.filter((x) => x.params.length)) {
    const parent = r.path.replace(/\/[^/]+$/, '');
    const parentScan = pages.find((p) => p.path === parent);
    const leaf = r.path.split('/').pop();
    if (parentScan && !leaf.startsWith(':')) {
      const ps = scans.get(absOf(parentScan.file));
      if (ps?.tabs && new RegExp(`['"\`]${leaf}['"\`]`).test(readSafe(absOf(parentScan.file)))) sig(out, { area: 'ia', kind: 'tab-and-page', title: `${r.path} duplicates the "${leaf}" tab on ${parent}`, evidence: [{ file: r.file }, { file: parentScan.file }], detail: 'The same content is both a tab and a separate page. Users and links split between two versions that can drift.', verify: 'Compare the tab and the page.' });
    }
  }
  return out;
}


function closureKeys(file, scans) {
  return scans.get(file)?.queryKeysRead || [];
}
function groupBy(arr, fn) { const m = new Map(); for (const x of arr) { const k = fn(x); m.set(k, (m.get(k) || []).concat(x)); } return m; }
function jaccard(a, b) { const A = new Set(a); const B = new Set(b); let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i || 1); }
function commonPrefix(paths) {
  if (!paths.length) return '/';
  const split = paths.map((p) => p.split('/'));
  const out = [];
  for (let i = 0; ; i++) { const s = split[0][i]; if (s == null || split.some((x) => x[i] !== s)) break; out.push(s); }
  return out.join('/') || '/';
}
