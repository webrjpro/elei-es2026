/* Integration checks using snapshots downloaded from the official TSE only.
 * Run: $env:PLAYWRIGHT_MODULE='path/to/playwright-core'; node tests/browser.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const run = promisify(execFile);
const ufs = 'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' ');
const base = 'https://resultados.tse.jus.br/oficial/ele2026/';
const files = [...ufs.map(uf => `6257/dados/${uf}/${uf}-c0001-e006257-u.json`),
  '6257/dados/br/br-c0001-e006257-u.json', '6259/dados/rj/rj-c0003-e006259-u.json', '6259/dados/rj/rj-c0005-e006259-u.json'];

async function main() {
  const snapshots = new Map();
  const queue = files.slice();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const file = queue.shift();
      const { stdout } = await run('curl.exe', ['--compressed', '--fail', '--max-time', '25', '-sS', base + file], { maxBuffer: 2000000 });
      const raw = JSON.parse(stdout);
      assert(raw.carg?.length && raw.s, `Official file structure: ${file}`);
      snapshots.set(base + file, raw);
    }
  }));
  console.log(`PASS: downloaded ${snapshots.size} real official TSE files`);
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-04T19:00:00-03:00') });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let mode = 'official';
    let requests = 0;
    await page.route('https://resultados.tse.jus.br/**', async route => {
      const raw = snapshots.get(route.request().url());
      if (!raw) { await route.abort(); return; }
      requests++;
      if (mode === 'offline') { await route.abort(); return; }
      if (mode === '404') { await route.fulfill({ status: 404, body: '' }); return; }
      let data = raw;
      if (mode === 'invalid') data = { ...raw, ele: 'wrong-election' };
      if (mode === 'older') data = { ...raw, dg: '01/10/2026', hg: '01:00:00' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(url);
    await page.waitForFunction(() => document.querySelector('.territory-summary')?.textContent.includes('27 atualizadas'));
    assert.equal(await page.locator('.territory-grid .territory-card').count(), 27);
    assert.equal(await page.locator('.territory-rio .territory-card').count(), 2);
    assert.equal(await page.locator('.race.is-loading').count(), 0);
    assert.equal(await page.locator('#status .status__text').innerText(), 'Ao vivo');
    const below = await page.evaluate(() => document.querySelector('#territorial-charts').getBoundingClientRect().top >= document.querySelector('#races').getBoundingClientRect().bottom);
    assert(below, 'Charts below the existing panels');
    for (const uf of ufs) {
      const raw = snapshots.get(base + `6257/dados/${uf}/${uf}-c0001-e006257-u.json`);
      const card = page.locator('.territory-grid .territory-card').filter({ has: page.locator(`a[href$="${uf}-c0001-e006257-u.json"]`) });
      const expected = new Intl.NumberFormat('pt-BR').format(Number(raw.s.st));
      assert((await card.locator('.territory-card__count').innerText()).startsWith(expected + ' de '), `${uf}: official section count`);
      const leader = raw.carg[0].agr.flatMap(a => a.par.flatMap(p => p.cand)).sort((a, b) => Number(b.vap) - Number(a.vap))[0];
      assert((await card.locator('.territory-bar').first().innerText()).includes(leader.nmu), `${uf}: official leader`);
    }
    for (const [id, cargo] of [['governador', '0003'], ['senador', '0005']]) {
      const raw = snapshots.get(base + `6259/dados/rj/rj-c${cargo}-e006259-u.json`);
      const count = raw.carg.find(c => String(c.cd) === String(Number(cargo))).agr.flatMap(a => a.par.flatMap(p => p.cand)).length;
      assert.equal(await page.locator(`[aria-labelledby="territory-${id}-title"] .territory-bar`).count(), count, `${id}: all official candidates`);
    }
    await page.selectOption('#territory-state', 'rj');
    assert.equal(await page.locator('.territory-grid .territory-card:visible').count(), 1);
    await page.selectOption('#territory-state', 'todos');
    await page.selectOption('#territory-order', 'apuracao');
    const percentages = await page.locator('.territory-grid [role="progressbar"]').evaluateAll(els => els.map(el => Number(el.getAttribute('aria-valuenow'))));
    assert(percentages.every((pct, i) => i === 0 || percentages[i - 1] >= pct), 'Sort by counting progress');
    await page.selectOption('#territory-order', 'nome');
    await page.screenshot({ path: path.join(os.tmpdir(), 'apuracao-desktop.png'), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px: no horizontal overflow`);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), 'apuracao-mobile.png'), fullPage: true });
    console.log('PASS: official values, 27 UFs, both RJ races, placement, filters, sorting, desktop and mobile');
    const beforeAuto = requests;
    await page.clock.fastForward(61000);
    await page.waitForFunction(() => document.querySelector('.territory-summary')?.textContent.includes('27 atualizadas'));
    await page.waitForTimeout(100);
    assert(requests >= beforeAuto + 27, 'Automatic state refresh after one minute');
    const beforeManual = requests;
    await page.click('#refresh');
    await page.waitForTimeout(100);
    assert(requests >= beforeManual + 27, 'Refresh button also updates state charts');
    console.log('PASS: automatic and manual refresh');
    const text = await page.locator('.territory-grid .territory-bars').allTextContents();
    for (const failure of ['invalid', 'older', 'offline']) {
      mode = failure;
      await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 600000; });
      await page.evaluate(() => window.Apuracao.Territory.refresh());
      assert.deepEqual(await page.locator('.territory-grid .territory-bars').allTextContents(), text, `${failure}: retains last official votes`);
      assert.equal(await page.locator('.territory-grid .is-stale').count(), 27);
    }
    mode = 'official';
    await page.evaluate(() => { const now = Date.now; Date.now = () => now() + 600000; });
    await page.evaluate(() => window.Apuracao.Territory.refresh());
    assert.equal(await page.locator('.territory-grid .is-stale').count(), 0, 'Recovers on valid official files');
    mode = '404';
    await page.evaluate(() => window.Apuracao.Territory.refresh());
    const after404 = requests;
    await page.evaluate(() => window.Apuracao.Territory.refresh());
    assert.equal(requests, after404, '404 backoff avoids repeated requests');
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    console.log('PASS: invalid/old data rejection, offline preservation, recovery and 404 backoff');
    mode = 'offline';
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.territory-grid .territory-bars li').length > 0);
    assert.deepEqual(await page.locator('.territory-grid .territory-bars').allTextContents(), text, 'Offline reload restores the official cache');
    console.log('PASS: offline reload from official cache');
    await context.close();
    // Separate live check: actual browser requests go straight to TSE, without interception.
    const live = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await live.goto(url);
    await live.waitForFunction(() => document.querySelector('.territory-summary')?.textContent.includes('27 atualizadas'), { timeout: 90000 });
    assert.equal(await live.locator('.race.is-loading').count(), 0);
    console.log('PASS: live browser connections to all 30 official TSE files');
    await live.close();
    console.log('Screenshots:', path.join(os.tmpdir(), 'apuracao-desktop.png'), path.join(os.tmpdir(), 'apuracao-mobile.png'));
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
