'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLyrics } = require('../lib/lyrics');
const { frameRate, lineRange, makeJob } = require('../lib/job');
const { choosePreset, buildAmInputs, assignTrackLanes } = require('../adapters/renderer').__test;

test('范围裁剪会以所选第一行重新归零且保留逐字相对时间', () => {
  const doc = parseLyrics('[0,1000](0,500,0)你(500,500,0)好\n[2000,1000](2000,500,0)世(2500,500,0)界', 'yrc');
  const ranged = lineRange(doc, { rangeStartLine: 2, rangeEndLine: 2 });
  assert.equal(ranged.lines.length, 1);
  assert.equal(ranged.lines[0].startMs, 0);
  assert.deepEqual(ranged.lines[0].words.map(word => [word.text, word.startMs, word.endMs]), [['世', 0, 500], ['界', 500, 1000]]);
  assert.deepEqual(ranged.source.range, { startLine: 2, endLine: 2, originalStartMs: 2000 });
  assert.throws(() => lineRange(doc, { rangeStartLine: 0, rangeEndLine: 1 }), /范围无效/);
});

test('渲染任务记录范围、标题来源与放置模式', () => {
  const doc = parseLyrics('1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB', 'srt');
  const info = { name: '测试', id: 'id', frameRate: frameRate('24'), startFrame: 86400, currentTimecode: '01:00:10:00' };
  const job = makeJob(doc, { rangeStartLine: 2, rangeEndLine: 2, placementMode: 'fusion-clip', titleSource: 'media:abc' }, info);
  assert.equal(job.schemaVersion, 2);
  assert.equal(job.document.lines[0].text, 'B');
  assert.equal(job.document.lines[0].startMs, 0);
  assert.deepEqual(job.render, { placementMode: 'fusion-clip', titleSource: 'media:abc', joinerMode: 'auto', wordSeparator: '' });
  assert.deepEqual(job.placement.lineFrames[0], { startFrame: 86640, endFrameExclusive: 86664 });
});

test('AM Lyrics 输入使用真实逐字区间，逐行歌词只生成整行段', () => {
  const wordLine = { text: '你好', startMs: 1000, endMs: 2000, words: [{ text: '你', startMs: 1000, endMs: 1400 }, { text: '好', startMs: 1400, endMs: 2000 }] };
  assert.deepEqual(buildAmInputs(wordLine, 24), { Lyrics: '你|好', Timings: '0-0.4|0.4-1', Duration: 1, Offset: 0, FPS: 24 });
  assert.deepEqual(buildAmInputs({ ...wordLine, words: [] }, 24), { Lyrics: '你好', Timings: '0-1', Duration: 1, Offset: 0, FPS: 24 });
});

test('单一预设支持长句且保留明确上限', () => {
  assert.equal(choosePreset({ text: '字'.repeat(128) }), 'AM Lyrics');
  assert.throws(() => choosePreset({ text: '字'.repeat(257) }), /256/);
});

test('重叠歌词自动分配额外顶部轨道，不重叠歌词复用同一轨道', () => {
  assert.deepEqual(assignTrackLanes([{ startFrame: 0, endFrameExclusive: 10 }, { startFrame: 5, endFrameExclusive: 8 }, { startFrame: 10, endFrameExclusive: 20 }]), [0, 1, 0]);
});

