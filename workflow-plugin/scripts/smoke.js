'use strict';
const os = require('node:os');
const path = require('node:path');
const { AmllDatabase } = require('../lib/amll');
const { PlatformProviders } = require('../lib/providers');
const { parseLyrics } = require('../lib/lyrics');
(async () => {
  const database = new AmllDatabase(path.join(os.tmpdir(), 'amll-resolve-smoke-cache'));
  const providers = new PlatformProviders();
  const checks = [
    ['AMLL search and TTML', async () => { const found = await database.search({ query: 'YOASOBI Idol' }, true); if (!found.results.length) throw new Error('No matches'); const raw = await database.lyrics(found.results[0]); const doc = parseLyrics(raw.text, raw.format, raw.source); return { matches: found.total, lines: doc.lines.length, timing: doc.timing }; }],
    ['Netease search', async () => ({ count: (await providers.search('netease', 'Idol YOASOBI')).length })],
    ['Netease lyrics', async () => { const doc = await providers.lyrics({ provider: 'netease', id: '2048982668' }); return { lines: doc.lines.length, timing: doc.timing }; }],
    ['QQ search', async () => ({ count: (await providers.search('qq', 'YOASOBI')).length })],
    ['QQ lyrics', async () => { const doc = await providers.lyrics({ provider: 'qq', id: '001KEjQl07j8DG' }); return { lines: doc.lines.length, timing: doc.timing }; }],
  ];
  // 仅输出统计，不将远端完整歌词持久化进仓库或日志。
  for (const [name, check] of checks) {
    try { console.log(JSON.stringify({ name, ok: true, result: await check() })); }
    catch (error) { console.log(JSON.stringify({ name, ok: false, error: error.message })); process.exitCode = 1; }
  }
})();
