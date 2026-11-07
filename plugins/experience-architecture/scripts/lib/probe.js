(() => {
  // experience-architecture state probe. Run in any page (Playwright, built-in browser JS tool, Chrome
  // extension, devtools). Returns a JSON-safe snapshot of navigation-relevant state. First call per document
  // also installs a history.pushState/replaceState counter so later snapshots can tell push from replace.
  // Privacy defaults: free-text field values are recorded as a length and fingerprint, never raw; password,
  // payment and one-time-code fields are skipped; secret-looking query values are masked; page text is only
  // captured when the runner asks for it (window.__eaOpts.text) and is stripped before logs are written.
  const w = window;
  const opts = w.__eaOpts || {};
  const SECRET_Q = /token|secret|passw|api[-_]?key|access[-_]?key|auth|session|signature|^sig$|^code$|otp|nonce|jwt/i;
  const mask = (u) => { try { const x = new URL(u, location.href); let hit = false; for (const k of [...x.searchParams.keys()]) if (SECRET_Q.test(k)) { x.searchParams.set(k, 'REDACTED'); hit = true; } if (/access_token|id_token/.test(x.hash)) { x.hash = '#REDACTED'; hit = true; } return hit ? x : null; } catch { return null; } };
  const fp = (v) => { let h = 2166136261; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6); };
  const VIEW_FIELD = /search|filter|sort|query|^q$|status|view|mode|range|date|page|tab|group|order/i;
  const fieldValue = (f) => {
    if (f.type === 'checkbox' || f.type === 'radio') return String(f.checked);
    const v = String(f.value || '');
    if (!v) return '';
    if (opts.reveal || f.tagName === 'SELECT' || ['range', 'date', 'month', 'week', 'time', 'color', 'search'].includes(f.type)) return v.slice(0, 40);
    if (VIEW_FIELD.test((f.name || '') + ' ' + (f.id || '') + ' ' + (f.getAttribute('aria-label') || '') + ' ' + (f.placeholder || '')) && v.length <= 40) return v;
    return `«${v.length} chars #${fp(v)}»`;
  };
  if (!w.__eaHist) {
    const h = { push: 0, replace: 0, pop: 0, installedAt: Date.now() };
    const wrap = (k, key) => { const orig = history[k].bind(history); history[k] = function (...a) { h[key]++; return orig(...a); }; };
    try { wrap('pushState', 'push'); wrap('replaceState', 'replace'); } catch (e) { /* sealed */ }
    w.addEventListener('popstate', () => { h.pop++; });
    w.__eaHist = h;
  }
  const visible = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
  const text = (el, n = 60) => (el?.getAttribute?.('aria-label') || el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const rel = (href) => { try { const u = mask(href) || new URL(href, location.href); return u.origin === location.origin ? u.pathname + u.search + u.hash : u.href; } catch { return href; } };
  const here = mask(location.href) || location;
  const describe = (el) => {
    if (!el || el === document.body || el === document.documentElement) return { tag: 'body', isBody: true };
    return { tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || undefined, name: text(el, 40) || el.getAttribute('name') || el.id || undefined, inDialog: !!el.closest('[role=dialog],dialog,[aria-modal=true]') };
  };
  const isCurrent = (a) => a.hasAttribute('aria-current') && a.getAttribute('aria-current') !== 'false'
    || /(^|\s)(active|current|selected|is-active|router-link-active|router-link-exact-active)(\s|$)/.test(a.className && a.className.baseVal === undefined ? a.className : '')
    || a.getAttribute('data-state') === 'active' || a.getAttribute('data-active') === 'true' || a.getAttribute('data-status') === 'active';
  const regions = [];
  const seen = new Set();
  document.querySelectorAll('nav,[role=navigation],header,aside,footer,[role=tablist]').forEach((r, i) => {
    const shown = visible(r);
    const links = [...r.querySelectorAll('a[href],[role=tab],[role=link]')].filter((a) => (shown ? visible(a) : true) && !seen.has(a));
    links.forEach((a) => seen.add(a));
    if (!links.length) return;
    const tag = r.getAttribute('role') || r.tagName.toLowerCase();
    regions.push({
      region: `${tag}${r.getAttribute('aria-label') ? ':' + r.getAttribute('aria-label') : r.id ? '#' + r.id : '#' + i}`,
      hidden: !shown || undefined,
      links: links.slice(0, 60).map((a) => ({ text: text(a, 40), href: a.getAttribute('href') ? rel(a.href) : null, current: isCurrent(a) || a.getAttribute('aria-selected') === 'true' })),
    });
  });
  const main = document.querySelector('main,[role=main]') || document.body;
  const fields = [...document.querySelectorAll('input,textarea,select')].filter((f) => visible(f) && !['password', 'hidden', 'submit', 'button', 'file'].includes(f.type) && !/cc-|one-time-code|password|card|cvc|iban/i.test((f.autocomplete || '') + ' ' + (f.name || '') + ' ' + (f.id || '')))
    .slice(0, 30).map((f) => ({ name: f.getAttribute('aria-label') || f.labels?.[0]?.innerText?.trim().slice(0, 40) || f.name || f.id || f.placeholder || f.tagName.toLowerCase(), value: fieldValue(f) }));
  const h1 = document.querySelector('h1');
  return {
    t: Date.now(),
    url: here.pathname + here.search + here.hash,
    path: here.pathname, search: here.search, hash: here.hash,
    title: document.title, h1: h1 ? text(h1, 80) : null,
    historyLength: history.length,
    history: { push: w.__eaHist.push, replace: w.__eaHist.replace, pop: w.__eaHist.pop },
    doc: String(performance.timeOrigin),
    scrollY: Math.round(w.scrollY), scrollMax: Math.max(0, document.documentElement.scrollHeight - innerHeight), viewport: [innerWidth, innerHeight],
    focus: describe(document.activeElement),
    dialogs: [...document.querySelectorAll('[role=dialog],dialog[open],[aria-modal=true]')].filter(visible).map((d) => text(d, 40) || 'dialog'),
    tabs: [...document.querySelectorAll('[role=tab][aria-selected=true]')].filter(visible).map((t) => text(t, 30)),
    pressed: [...document.querySelectorAll('[aria-pressed=true],[aria-checked=true]:not(input),option:checked')].filter((e) => e.tagName === 'OPTION' || visible(e)).map((e) => text(e, 30)).slice(0, 20),
    fields,
    regions,
    navVisible: regions.some((r) => !r.hidden && r.links.length >= 2 && !/tablist|footer|breadcrumb/i.test(r.region)),
    navToggle: (() => { const b = [...document.querySelectorAll('button,[role=button]')].find((x) => visible(x) && (x.hasAttribute('aria-expanded') && /menu|nav|☰|≡/i.test((x.getAttribute('aria-label') || '') + x.innerText + (x.getAttribute('aria-controls') || '')) || /^(menu|☰|≡|open menu|navigation)$/i.test(text(x, 20)))); return b ? { name: text(b, 30) || 'menu', expanded: b.getAttribute('aria-expanded') } : null; })(),
    canonical: document.querySelector('link[rel=canonical]')?.href || null,
    contentType: document.contentType,
    noindex: /noindex/i.test(document.querySelector('meta[name=robots]')?.content || ''),
    notFound: /\b(404|not found|page not found|doesn.t exist)\b/i.test((document.title || '') + ' ' + (h1 ? h1.innerText : '')),
    // Text checks look at the whole page: the title, every heading and the body text (headings often sit
    // outside <main>). Kept in memory only; the runner drops it before writing.
    mainText: opts.text ? [document.title, ...[...document.querySelectorAll('h1,h2,h3')].map((h) => h.innerText), document.body.innerText || ''].join(' ').replace(/\s+/g, ' ').slice(0, 12000) : undefined,
    mainTextLength: (main.innerText || '').length,
  };
})()
