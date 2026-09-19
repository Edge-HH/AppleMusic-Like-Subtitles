'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseInput } = require('../lib/input');
const { makeJob, frameRate, timecodeFrame, toSrt } = require('../lib/job');
const { parseLyrics } = require('../lib/lyrics');
const { ResolveHost } = require('../lib/resolve');

test('解析歌名、分享文字、网易云 hash 链接', () => {
  assert.deepEqual(parseInput('Idol YOASOBI'), { query: 'Idol YOASOBI' });
  assert.deepEqual(parseInput('分享：https://music.163.com/#/song?id=2048982668'), { platform: 'netease', id: '2048982668' });
  assert.deepEqual(parseInput('netease:123'), { platform: 'netease', id: '123' });
});
test('解析其他平台和短链，不把专辑当歌曲', () => {
  assert.deepEqual(parseInput('https://y.qq.com/n/ryqq/songDetail/001abc'), { platform: 'qq', id: '001abc' });
  assert.deepEqual(parseInput('https://music.apple.com/cn/album/example/123?i=456'), { platform: 'apple', id: '456' });
  assert.deepEqual(parseInput('https://open.spotify.com/track/ABC123'), { platform: 'spotify', id: 'ABC123' });
  assert.deepEqual(parseInput('https://163cn.tv/abc'), { shortUrl: 'https://163cn.tv/abc' });
  assert.throws(() => parseInput('https://music.apple.com/cn/album/example/123'));
  assert.throws(() => parseInput('https://evil.example/song/123')); assert.throws(() => parseInput('https://music.163.com:444/song?id=1'));
});
test('有理帧率与 NDF、DF 时间码', () => {
  const rate = frameRate('29.97 DF'); assert.deepEqual(rate, { numerator: 30000, denominator: 1001 });
  assert.equal(timecodeFrame('01:00:00:00', frameRate('24')), 86400);
  assert.equal(timecodeFrame('01:00:00;00', rate), 107892);
  assert.equal(timecodeFrame('00:01:00;02', rate), 1800);
  assert.throws(() => timecodeFrame('00:01:00;00', rate)); assert.throws(() => frameRate('abc'));
});
test('对接任务保留原始毫秒并显式计算帧区间', () => {
  const doc = parseLyrics('1\n00:00:01,000 --> 00:00:02,000\nHello', 'srt');
  const info = { name: '测试', id: 'id', frameRate: frameRate('24'), startFrame: 86400, currentTimecode: '01:00:10:00' };
  const job = makeJob(doc, { offsetMs: 500 }, info);
  assert.equal(job.schemaVersion, 2); assert.equal(job.placement.startFrame, 86640); assert.deepEqual(job.placement.lineFrames[0], { startFrame: 86652, endFrameExclusive: 86676 }); assert.equal(doc.lines[0].startMs, 1000);
  assert.throws(() => makeJob(doc, { anchor: 'timeline-start', offsetMs: -2000 }, info));
  assert.throws(() => makeJob(doc, { anchor: 'frame', startFrame: 12.3 }, info));
  assert.throws(() => makeJob(doc, { offsetMs: NaN }, info));
});
test('SRT 导出不把插入起点混入歌词时间', () => {
  const doc = parseLyrics('[00:01.00]你好', 'lrc'); assert.match(toSrt(doc, 500), /00:00:01,500 --> 00:00:06,500/); assert.throws(() => toSrt(doc, -2000));
});
test('Resolve 桥接只读取当前项目，无时间线时明确报错', async () => {
  let count = 0;
  const host = new ResolveHost(() => ({ Initialize: async () => true, GetResolve: async () => ({ GetVersion: async () => [19, 1], GetProjectManager: async () => ({ GetCurrentProject: async () => ({ GetCurrentTimeline: async () => { count++; return null; } }) }) }), CleanUp() {} }));
  await assert.rejects(host.context(), /时间线/); assert.equal(count, 1);
});
