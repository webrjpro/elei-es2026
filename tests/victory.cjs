/* Election flags below are isolated test cases, never shipped as result data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const base = 'https://resultados.tse.jus.br/oficial/ele2026/';
const files = ['6257/dados/br/br-c0001-e006257-u.json', '6259/dados/rj/rj-c0003-e006259-u.json', '6259/dados/rj/rj-c0005-e006259-u.json'];
const raw = new Map(files.map(f => [base + f, JSON.parse(execFileSync('curl.exe', ['--compressed', '--fail', '--max-time', '25', '-sS', base + f], { encoding: 'utf8' }))]));
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'text/plain');
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  let mode = 'leading', version = 0;
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function context(reducedMotion = 'no-preference') {
    const c = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion });
    await c.route('https://resultados.tse.jus.br/**', async route => {
      const original = raw.get(route.request().url());
      if (!original) { await route.abort(); return; }
      if (mode === 'offline') { await route.abort(); return; }
      const data = structuredClone(original);
      if (data.cdabr === 'br') {
        data.idg = `victory-test-${version}`; data.hg = `23:${String(version).padStart(2, '0')}:00`;
        const candidates = data.carg[0].agr.flatMap(a => a.par.flatMap(p => p.cand));
        for (const candidate of candidates) { candidate.e = 'n'; candidate.st = ''; }
        const flavio = candidates.find(c => c.n === '22' && /FLAVIO.*BOLSONARO/.test(c.nm));
        assert(flavio, 'Official national file includes target candidate');
        if (mode === 'runoff') flavio.st = '2º turno';
        if (mode === 'win') { flavio.e = 's'; flavio.st = 'Eleito'; }
        if (mode === 'other') { const other = candidates.find(c => c.n !== '22'); other.e = 's'; other.st = 'Eleito'; }
        if (mode === 'invalid') data.ele = 'wrong-election';
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    return c;
  }
  try {
    const c = await context(); const page = await c.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.clock.install({ time: new Date('2026-10-04T23:00:00-03:00') });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelectorAll('.race.is-loading').length === 0);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'Leadership alone is not election');
    await page.evaluate(() => window.Apuracao.Victory.sync({ id: 'presidente', cargo: 1, uf: 'rj' },
      { ts: Date.now(), candidatos: [{ numero: '22', nomeCompleto: 'FLAVIO NANTES BOLSONARO', eleito: true }] }));
    assert.equal(await page.locator('dialog[open]').count(), 0, 'State result cannot trigger a national victory');
    async function poll(next) {
      mode = next; version++;
      await page.clock.fastForward(17000);
      await page.waitForTimeout(250);
    }
    await poll('runoff'); assert.equal(await page.locator('dialog[open]').count(), 0, 'Runoff is not victory');
    await poll('other'); assert.equal(await page.locator('dialog[open]').count(), 0, 'Another winner does not trigger');
    await poll('invalid'); assert.equal(await page.locator('dialog[open]').count(), 0, 'Invalid official file cannot trigger');
    await poll('win');
    await page.waitForSelector('dialog[open]');
    assert.equal(await page.locator('.victory__brasil:visible').innerText(), 'BRASIL');
    assert.equal(await page.locator('.victory__slogan:visible').count(), 0, 'Slogan follows the intro');
    await page.clock.runFor(1800);
    await page.screenshot({ path: process.env.TEMP + '/victory-intro.png' });
    await page.clock.fastForward(6000);
    assert.equal(await page.locator('.victory__slogan:visible').innerText(), 'Brasil acima de tudo,\nDeus acima de todos');
    await page.clock.runFor(1100);
    await page.screenshot({ path: process.env.TEMP + '/victory-desktop.png' });
    await page.clock.fastForward(60000);
    assert.equal(await page.locator('.victory__brasil:visible').count(), 0, 'Polling never restarts the intro');
    assert.equal(await page.locator('.victory__slogan:visible').count(), 1, 'Slogan stays fixed');
    for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      assert(await page.evaluate(() => ['.victory__content', '.victory__close'].every(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      })), `Responsive overlay fits ${size.width}x${size.height}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: process.env.TEMP + '/victory-mobile.png' });
    await poll('leading'); assert.equal(await page.locator('dialog[open]').count(), 0, 'Official correction removes celebration');
    await poll('win'); await page.waitForSelector('dialog[open]');
    assert.equal(await page.locator('.victory__slogan:visible').count(), 1, 'Confirmed winner returns without repeat intro');
    await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog[open]').count(), 0);
    await poll('win'); assert.equal(await page.locator('dialog[open]').count(), 0, 'Dismissed celebration stays closed');
    await page.reload(); await page.waitForTimeout(500);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'Dismissal survives reload');
    assert.deepEqual(errors, []);
    await c.close();
    mode = 'win';
    const reduced = await context('reduce'); const rp = await reduced.newPage(); await rp.goto(url);
    await rp.waitForSelector('.victory--final[open]');
    assert.equal(await rp.locator('.victory__brasil:visible').count(), 0, 'Reduced motion skips fireworks intro');
    await rp.locator('.victory__close').click(); assert.equal(await rp.locator('dialog[open]').count(), 0);
    // A persisted elected cache must never trigger without a successful new official reading.
    mode = 'offline';
    await rp.evaluate(() => sessionStorage.clear()); await rp.reload(); await rp.waitForTimeout(700);
    assert.equal(await rp.locator('dialog[open]').count(), 0, 'Cached victory plus network failure cannot trigger');
    await reduced.close();
    // Visual QA uses the browser's real animation clock, separate from accelerated logic checks.
    mode = 'win';
    const visual = await context(); const vp = await visual.newPage(); await vp.goto(url);
    await vp.waitForSelector('.victory__brasil:visible'); await vp.waitForTimeout(1800);
    assert.equal(await vp.locator('.victory__slogan:visible').count(), 0);
    await vp.screenshot({ path: process.env.TEMP + '/victory-intro.png' });
    await vp.waitForSelector('.victory__slogan:visible'); await vp.waitForTimeout(1100);
    await vp.screenshot({ path: process.env.TEMP + '/victory-desktop.png' });
    await vp.setViewportSize({ width: 390, height: 844 });
    await vp.screenshot({ path: process.env.TEMP + '/victory-mobile.png' });
    await visual.close();
    console.log('PASS: national official-election gate, no leadership/runoff/other-winner trigger, intro, permanent slogan, repeat prevention, correction, dismissal, offline cache, reduced motion, desktop/mobile/landscape, no JS errors');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
