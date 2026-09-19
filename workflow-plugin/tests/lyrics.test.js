'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLyrics, time, attachTranslations } = require('../lib/lyrics');

test('时间戳支持分钟、小时和 TTML 单位', () => {
  assert.equal(time('01:02.5'), 62500); assert.equal(time('01:02:03,045'), 3723045); assert.equal(time('250ms'), 250); assert.equal(time('1.25s'), 1250);
  assert.throws(() => time('00:65.00')); assert.throws(() => time('garbage'));
});
test('SRT 支持 BOM、CRLF、多行，不伪造逐字', () => {
  const doc = parseLyrics('\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\n你好\r\n<b>世界</b>\r\n', 'srt');
  assert.equal(doc.lines[0].text, '你好\n世界'); assert.equal(doc.timing, 'line'); assert.deepEqual(doc.lines[0].words, []);
});
test('SRT 拒绝反向时间和非法格式', () => {
  assert.throws(() => parseLyrics('1\n00:00:02,000 --> 00:00:01,000\nx', 'srt'));
  assert.throws(() => parseLyrics('hello', 'srt'));
});
test('LRC 元数据、重复时间标签和 offset', () => {
  const doc = parseLyrics('[ti:测试]\n[offset:100]\n[00:01.20][00:03.50]重复\n[00:06.00]结束', 'lrc');
  assert.equal(doc.metadata.ti, '测试'); assert.deepEqual(doc.lines.map(l => l.startMs), [1100, 3400, 5900]); assert.equal(doc.lines[0].endMs, 3400); assert.equal(doc.lines[2].endMs, 10900);
});
test('LRC 同时刻译文不产生零长行', () => {
  const doc = parseLyrics('[00:01.00]Hello\n[00:01.00]你好\n[00:03.00]End', 'lrc');
  assert.equal(doc.lines[0].endMs, 3000); assert.equal(doc.lines[1].endMs, 3000);
});
test('增强 LRC 保留真实逐字时间和结束标记', () => {
  const doc = parseLyrics('[00:01.00]<00:01.00>你<00:01.50>好<00:02.00>\n[00:03.00]结束', 'lrc');
  assert.equal(doc.timing, 'mixed'); assert.deepEqual(doc.lines[0].words, [{ text: '你', startMs: 1000, endMs: 1500 }, { text: '好', startMs: 1500, endMs: 2000 }]);
});
test('LRC 非法 offset 和纯文本不能冒充同步歌词', () => {
  assert.throws(() => parseLyrics('[offset:abc]\n[00:01]x', 'lrc'));
  assert.throws(() => parseLyrics('[offset:2000]\n[00:01]x', 'lrc'));
  assert.throws(() => parseLyrics('无时间戳歌词', 'lrc'));
});
test('网易云 YRC 解析毫秒级逐字', () => {
  const doc = parseLyrics('[1000,1000](1000,400,0)你(1400,600,0)好', 'yrc');
  assert.equal(doc.timing, 'word'); assert.equal(doc.lines[0].text, '你好'); assert.equal(doc.lines[0].words[1].endMs, 2000);
});
test('TTML 保留翻译、音译、歌手、和声及元数据', () => {
  const doc = parseLyrics(`<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="urn:ttm" xmlns:amll="urn:amll"><head><metadata><amll:meta key="musicName" value="测试"/></metadata></head><body><div><p begin="1s" end="3s" ttm:agent="v2"><span begin="1s" end="2s">你好</span><span ttm:role="x-translation" xml:lang="en">Hello</span><span ttm:role="x-roman">Ni hao</span><span ttm:role="x-bg" begin="2s" end="3s"><span begin="2s" end="3s">啊</span></span></p></div></body></tt>`, 'ttml');
  assert.equal(doc.lines.length, 2); assert.equal(doc.lines[0].text, '你好'); assert.equal(doc.lines[0].translations[0].text, 'Hello'); assert.equal(doc.lines[0].romanization[0].text, 'Ni hao'); assert.equal(doc.lines[1].role, 'background'); assert.equal(doc.lines[1].agent, 'v2'); assert.deepEqual(doc.metadata.musicName, ['测试']);
});
test('TTML 拒绝 XML 实体、损坏 XML 和非法时间', () => {
  assert.throws(() => parseLyrics('<!DOCTYPE tt [<!ENTITY x SYSTEM "file:///secret">]><tt/>', 'ttml'));
  assert.throws(() => parseLyrics('<tt><body></tt>', 'ttml'));
  assert.throws(() => parseLyrics('<tt><body><p begin="1s" end="0s">x</p></body></tt>', 'ttml'));
});
test('平台翻译按精确时间配对，不附加错位翻译', () => {
  const doc = parseLyrics('[00:01.00]Hello', 'lrc'); attachTranslations(doc, '[00:01.00]你好\n[00:02.00]其他');
  assert.equal(doc.lines[0].translations[0].text, '你好');
});
