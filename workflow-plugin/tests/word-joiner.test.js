'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLyrics } = require('../lib/lyrics');
const { makeJob, toSrt } = require('../lib/job');
const context = { id: 'test', name: 'timeline', startFrame: 0, currentTimecode: '00:00:00:00', frameRate: { numerator: 24, denominator: 1 } };
const english = () => parseLyrics('[0,1000](0,400,0)Hello(400,600,0)world', 'yrc');

test('英文逐词歌词默认补空格，原词时间和源文档不变', () => {
  const doc = english(), source = JSON.stringify(doc);
  const result = makeJob(doc, {}, context).document;
  assert.equal(result.lines[0].text, 'Hello world');
  assert.equal(result.lines[0].words.map(x => x.text).join(''), 'Hello world');
  assert.deepEqual(result.lines[0].words.map(x => [x.startMs,x.endMs]), [[0,400],[400,1000]]);
  assert.equal(JSON.stringify(doc), source);
  assert.match(toSrt(result), /Hello world/);
});

test('中文默认不加空格，自定义连接符对任意语言生效且可为空', () => {
  const doc = parseLyrics('[0,1000](0,400,0)你(400,600,0)好', 'yrc');
  assert.equal(makeJob(doc, {}, context).document.lines[0].text, '你好');
  assert.equal(makeJob(doc, { joinerMode: 'custom', wordSeparator: '·' }, context).document.lines[0].text, '你·好');
  assert.equal(makeJob(english(), { joinerMode: 'custom', wordSeparator: '' }, context).document.lines[0].text, 'Helloworld');
});

test('保留 TTML 分词 span 外的空白和标点，不在已有空格上重复添加', () => {
  const doc = parseLyrics('<tt><body><p begin="0s" end="1s"><span begin="0s" end="0.4s">Hello</span>, <span begin="0.4s" end="1s">world</span>!</p></body></tt>', 'ttml');
  const line = makeJob(doc, {}, context).document.lines[0];
  assert.equal(line.words.map(x => x.text).join(''), 'Hello, world!');
});

test('连接符不能注入原生分段符或换行，非法配置在写入前拒绝', () => {
  for (const wordSeparator of ['|','\n','\r','\0','x'.repeat(33)]) {
    assert.throws(() => makeJob(english(), { joinerMode: 'custom', wordSeparator }, context), /连接符/);
  }
});


test('自定义连接符替换已有边界空白，标点保留，未分词歌词不伪造时间', () => {
  const { formatLine } = require('../lib/word-joiner');
  const line = english().lines[0];
  line.words[0].text='Hello ';line.words[1].text=' world';line.text='Hello  world';
  assert.equal(formatLine(line,{joinerMode:'custom',wordSeparator:' / '}).text,'Hello / world');
  const plain={text:'Hello world\n你好',words:[]};
  const formatted=formatLine(plain,{joinerMode:'custom',wordSeparator:'·'});
  assert.equal(formatted.text,'Hello·world\n你好');assert.deepEqual(formatted.words,[]);
  assert.equal(formatLine({text:'Hello,world',words:[{text:'Hello'},{text:'world'}]}).text,'Hello, world');
});


test('英文单字母逐字段不被自动拆成带空格的字母串', () => {
  const {formatLine}=require('../lib/word-joiner');
  assert.equal(formatLine({text:'Hello',words:[...'Hello'].map(text=>({text}))}).text,'Hello');
  assert.equal(formatLine({text:'Iam',words:[{text:'I'},{text:'am'}]}).text,'I am');
});
