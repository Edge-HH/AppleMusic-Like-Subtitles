'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { AmllDatabase, parseIndex } = require('../lib/amll');
const { LyricService } = require('../lib/service');
const { PlatformProviders, weapi } = require('../lib/providers');
const { readLyricFile } = require('../lib/files');
const { request } = require('../lib/http');
const index = JSON.stringify({ metadata: [['musicName', ['Test']], ['artists', ['Singer']], ['ncmMusicId', ['123']]], rawLyricFile: '123-author-abcd1234.ttml' });

test('AMLL 索引保护路径，支持名字和精确歌曲 ID', async () => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'amll-test-'));
  const db = new AmllDatabase(cache, async () => ({ text: index }));
  const found = await db.search({ query: 'test singer' }); assert.equal(found.results.length, 1);
  assert.equal((await db.search({ platform: 'netease', id: '123' })).results.length, 1);
  assert.throws(() => parseIndex(index.replace('123-author-abcd1234.ttml', '../evil.ttml')));
});
test('索引刷新失败时保留旧缓存并告知', async () => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'amll-test-'));
  let fail = false;
  const db = new AmllDatabase(cache, async () => { if (fail) throw new Error('offline'); return { text: index }; });
  await db.load(); fail = true;
  const result = await db.load(true); assert.equal(result.entries.length, 1); assert.match(result.warning, /旧索引/);
});
test('AMLL 有结果时不请求平台', async () => {
  let calls = 0;
  const service = new LyricService({ search: async () => ({ results: parseIndex(index), total: 1, warnings: [] }) }, { search: async () => { calls++; return []; } });
  const result = await service.search('Test'); assert.equal(result.results.length, 1); assert.equal(calls, 0);
});
test('源故障时自动回退，保留失败信息，平台彼此隔离', async () => {
  const service = new LyricService({ search: async () => { throw new Error('AMLL offline'); } }, { search: async platform => { if (platform === 'qq') throw new Error('QQ blocked'); return [{ key: 'netease:123', provider: 'netease', id: '123' }]; } });
  const result = await service.search('Test'); assert.equal(result.results.length, 1); assert.deepEqual(result.warnings, ['AMLL offline', 'QQ blocked']);
});
test('平台候选选择时重新按歌曲 ID 检索 AMLL', async () => {
  const service = new LyricService({ search: async input => ({ results: input.id ? parseIndex(index) : [], total: 0, warnings: [] }) }, { search: async () => [{ key: 'netease:123', provider: 'netease', id: '123' }] });
  await service.search('Test', { platform: 'netease' });
  const result = await service.select('netease:123'); assert.equal(result.alternatives.length, 1);
  await assert.rejects(service.select('forged-key'), /过期/);
});
test('短链受控解析及无法跳转时明确拒绝', async () => {
  const db = { search: async () => ({ results: [], total: 0, warnings: [] }) };
  const service = new LyricService(db, {}, async () => ({ url: 'https://music.163.com/song?id=123' }));
  assert.equal((await service.search('https://163cn.tv/test')).results[0].id, '123');
  await assert.rejects(request('https://127.0.0.1/secret'), /不允许/);
  await assert.rejects(request('https://raw.githubusercontent.com:444/x'), /不允许/);
});
test('平台封装解析网易云逐字、QQ 逐行，并暴露限制', async () => {
  const ncm = new PlatformProviders(async () => ({ code: 200, yrc: { lyric: '[1000,1000](1000,500,0)你(1500,500,0)好' } }));
  assert.equal((await ncm.lyrics({ provider: 'netease', id: '123' })).timing, 'word');
  const qq = new PlatformProviders(async () => ({ code: 0, lyric: Buffer.from('[00:01.00]你好').toString('base64') }));
  assert.equal((await qq.lyrics({ provider: 'qq', id: '001abc' })).timing, 'line');
  await assert.rejects(qq.lyrics({ provider: 'qq', id: '123' }), /songmid/);
  const blocked = new PlatformProviders(async () => ({ code: 403 }));
  await assert.rejects(blocked.lyrics({ provider: 'netease', id: '123' }), /登录/);
});
test('WEAPI 双层加密返回有效字段，随机密钥不复用', () => {
  const a = new URLSearchParams(weapi({ id: '1' })), b = new URLSearchParams(weapi({ id: '1' }));
  assert.equal(a.get('encSecKey').length, 256); assert.ok(a.get('params')); assert.notEqual(a.get('params'), b.get('params'));
});
test('读取 UTF-16LE BOM 文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'amll-file-'));
  const file = path.join(dir, 'test.lrc');
  await fs.writeFile(file, Buffer.from('\uFEFF[00:01.00]你好', 'utf16le'));
  const read = await readLyricFile(file); assert.equal(read.encoding, 'utf-16le'); assert.equal(read.text, '[00:01.00]你好');
});

test('AMLL 多作者文件名允许逗号且仍拒绝目录穿越', () => {
  assert.equal(parseIndex(index.replace('123-author-abcd1234.ttml', '1766419644119-207428447,45750526-ehjthdko.ttml')).length, 1);
  assert.throws(() => parseIndex(index.replace('123-author-abcd1234.ttml', '%2e%2e%2fevil.ttml')));
});
