// v0.3.1 fixes from the Pullwise run: false alarms, menu labels, sitemap coverage (no browser needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlFindings } from '../plugins/experience-architecture/scripts/lib/browser.mjs';
import { analyzeLog } from '../plugins/experience-architecture/scripts/lib/transitions.mjs';

const snap = (path, extra = {}) => ({ url: path, path, search: '', hash: '', title: extra.h1 || '', h1: null, historyLength: 2, history: { push: 0, replace: 0, pop: 0 }, doc: 'd1', scrollY: 0, dialogs: [], tabs: [], pressed: [], fields: [], regions: [], navVisible: true, focus: { tag: 'h1' }, contentType: 'text/html', ...extra });
const page = (path, extra) => ({ requested: path, final: path, status: 200, redirects: [], snapshot: snap(path, extra) });

test('an overlay that pushes the same URL and closes on Back is not a restoration problem', () => {
  const base = snap('/gear', { h1: 'Gear', historyLength: 3, history: { push: 0, replace: 0, pop: 0 } });
  const open = { ...base, dialogs: ['Search'], historyLength: 4, history: { push: 1, replace: 0, pop: 0 } };
  const closed = { ...base, historyLength: 4, history: { push: 1, replace: 0, pop: 1 } };
  const log = { runs: [{ journey: 'search-back', viewport: 'mobile', steps: [
    { i: 0, type: 'goto', desc: 'goto /dungeons', requested: '/dungeons', snapshot: snap('/dungeons', { doc: 'd0' }) },
    { i: 1, type: 'goto', desc: 'goto /gear', requested: '/gear', snapshot: base },
    { i: 2, type: 'click', desc: 'click search', snapshot: open },
    { i: 3, type: 'back', desc: 'Back', snapshot: closed },
  ] }] };
  const a = analyzeLog(log);
  assert.ok(!a.anomalies.some((x) => x.type === 'restoration-divergence'), JSON.stringify(a.anomalies.map((x) => x.type)));
  assert.ok(!a.anomalies.some((x) => x.type === 'back-left-overlay'));
});

test('a feed or other file is not judged as a page without navigation', () => {
  const pages = [page('/home'), page('/home/news'), { ...page('/feed.xml', { contentType: 'application/rss+xml', navVisible: false, regions: [] }) }];
  assert.ok(!crawlFindings(pages, 'mobile').some((f) => f.type === 'no-visible-nav'));
});

test('menu labels that share no word with the page they open are reported', () => {
  const nav = { region: 'nav#Main', hidden: false, links: [{ text: 'This Week', href: '/classes' }, { text: 'Gear', href: '/gear' }, { text: 'Dungeons', href: '/dungeons' }] };
  const pages = [page('/home', { regions: [nav] }), page('/classes', { h1: 'Classes', regions: [nav] }), page('/gear', { h1: 'Gear', regions: [nav] }), page('/dungeons', { h1: 'Mythic+ dungeons', regions: [nav] })];
  const f = crawlFindings(pages, 'desktop').find((x) => x.type === 'nav-label-mismatch');
  assert.ok(f, 'found');
  assert.deepEqual(f.items.map((i) => i.label), ['This Week']);
});

test('public pages missing from the sitemap are grouped by section', () => {
  const pages = [page('/'), page('/classes'), page('/forever'), page('/forever/dungeons'), page('/settings', { noindex: true })];
  const f = crawlFindings(pages, 'desktop', null, { paths: new Set(['/', '/classes']) }).find((x) => x.type === 'not-in-sitemap');
  assert.equal(f.count, 2);
  assert.deepEqual(f.sections.map((s) => s.section), ['/forever']);
  assert.ok(crawlFindings(pages, 'desktop', null, { missing: true }).some((x) => x.type === 'no-sitemap'));
});
