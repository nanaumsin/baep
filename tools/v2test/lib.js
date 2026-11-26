const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { spawn } = require('child_process');
const BE = require('./backend');
const PORT = 8765, ROOT = `http://localhost:${PORT}`;
let server, browser;
const errors = [];
async function start(webDir) {
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', webDir], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
}
async function stop() { try { await browser.close(); } catch (e) {} try { server.kill(); } catch (e) {} }
async function ctx(name, opts = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: opts.ua, deviceScaleFactor: 1 });
  await BE.install(c);
  if (opts.mode) await c.route(`${ROOT}/app-config.js`, async r => { const res = await r.fetch(); let b = await res.text(); b = b.replace("window.BAEP_MODE = 'demo';", `window.BAEP_MODE = '${opts.mode}';`); r.fulfill({ response: res, body: b }); });
  const p = await c.newPage(); p.__name = name;
  p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (401|409|429)/.test(m.text())) errors.push(`[${name}] console.error: ${m.text()}`); });
  p.on('pageerror', e => errors.push(`[${name}] pageerror: ${e.message}`));
  return { c, p };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function skipCoach(p) { for (let i = 0; i < 4; i++) { const k = p.locator('.co-skip'); if (await k.count() && await k.first().isVisible()) { await k.first().click(); await sleep(150); } else break; } }
async function A(p, a, v) { await sleep(500); await skipCoach(p); const sel = v === undefined ? `[data-a="${a}"]` : `[data-a="${a}"][data-v="${v}"]`; await p.locator(sel).first().click(); await sleep(250); }
async function waitScreen(p, sc, ms = 8000) { await p.waitForFunction(s => window.S && S.screen === s, sc, { timeout: ms }); }
async function shot(p, n) { await p.screenshot({ path: `/home/claude/shots/v2-${n}.png` }); }
const st = p => p.evaluate(() => ({ screen: S.screen, me: S.me, ses: Object.assign({}, SES) }));
async function toastText(p) { return p.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; }); }
async function until(p, fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await p.evaluate(fn)) return true; } catch (e) {} await sleep(300); } return false; }
const results = []; function check(name, cond, info) { results.push({ name, ok: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || info === undefined ? '' : ' :: ' + JSON.stringify(info))); }
module.exports = { until, skipCoach, start, stop, ctx, sleep, A, waitScreen, shot, st, toastText, check, results, errors, BE, ROOT };
