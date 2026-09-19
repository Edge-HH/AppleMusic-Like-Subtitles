'use strict';

const { DOMParser } = require('@xmldom/xmldom');
const MAX_BYTES = 8 * 1024 * 1024;

function time(value) {
  const text = String(value).trim();
  let m = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (m) return Math.round(Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]]);
  m = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m || Number(m[3]) >= 60 || (m[1] !== undefined && Number(m[2]) >= 60)) {
    throw new Error(`不支持的时间戳：${text}`);
  }
  return (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number((m[4] || '').padEnd(3, '0'));
}

function line(startMs, endMs, text, extra = {}) {
  return { startMs, endMs, text, words: [], translations: [], romanization: [], agent: null, role: 'main', ...extra };
}

function validateDocument(doc) {
  if (!doc || doc.schemaVersion !== 1 || !Array.isArray(doc.lines) || !doc.lines.length) throw new Error('没有可用的带时间戳歌词');
  if (doc.lines.length > 20000) throw new Error('歌词行数超过 20,000 行限制');
  for (const item of doc.lines) {
    if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs) || item.startMs < 0 || item.endMs <= item.startMs) throw new Error('歌词时间范围无效（结束必须晚于开始）');
    if (typeof item.text !== 'string' || !Array.isArray(item.words)) throw new Error('歌词数据结构无效');
    let previous = -1;
    for (const word of item.words) {
      if (!Number.isFinite(word.startMs) || !Number.isFinite(word.endMs) || word.startMs < item.startMs || word.endMs > item.endMs || word.endMs <= word.startMs || word.startMs < previous || typeof word.text !== 'string') throw new Error('逐字时间戳无效或超出所在行');
      previous = word.startMs;
    }
  }
  doc.lines.sort((a, b) => a.startMs - b.startMs);
  const wordLines = doc.lines.filter(item => item.words.length).length;
  doc.timing = wordLines === 0 ? 'line' : wordLines === doc.lines.length ? 'word' : 'mixed';
  doc.durationMs = Math.max(...doc.lines.map(item => item.endMs));
  return doc;
}

function parseSrt(input) {
  const lines = [];
  for (const block of input.trim().split(/\n\s*\n/)) {
    const rows = block.split('\n');
    if (/^\d+$/.test(rows[0].trim())) rows.shift();
    const match = (rows.shift() || '').match(/^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/);
    if (!match || !rows.length) throw new Error('SRT 格式无效：每段需要时间范围和字幕文字');
    lines.push(line(time(match[1]), time(match[2]), rows.join('\n').replace(/<\/?(?:b|i|u|font)(?:\s[^>]*)?>/gi, '')));
  }
  return { lines, metadata: {}, warnings: ['SRT 按逐行字幕导入，不会伪造逐字时间戳。'] };
}

function parseLrc(input) {
  const entries = [], metadata = {}, warnings = [];
  let offset = 0;
  for (const row of input.split('\n')) {
    const tag = row.match(/^\[(ar|ti|al|by|offset):([^\]]*)\]\s*$/i);
    if (tag) {
      if (tag[1].toLowerCase() === 'offset') {
        if (!/^[+-]?\d+$/.test(tag[2].trim())) throw new Error('LRC offset 必须是整数毫秒');
        offset = Number(tag[2]);
      } else metadata[tag[1].toLowerCase()] = tag[2];
      continue;
    }
    const prefix = row.match(/^((?:\[\d+:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/);
    if (!prefix) {
      if (row.trim()) warnings.push('忽略了不带时间戳的 LRC 行。');
      continue;
    }
    const starts = [...prefix[1].matchAll(/\[([^\]]+)\]/g)].map(m => time(m[1].replace(/^(\d+:\d{2}):/, '$1.')));
    const text = prefix[2];
    const marks = [...text.matchAll(/<(\d+:\d{2}(?:\.\d{1,3})?)>/g)];
    for (const start of starts) {
      const words = [];
      // 重复行的内嵌时间戳按第一组行时间平移，而不是重复使用绝对时间。
      for (let i = 0; i < marks.length; i++) {
        const wordText = text.slice(marks[i].index + marks[i][0].length, marks[i + 1]?.index ?? text.length);
        if (wordText) words.push({ text: wordText, startMs: time(marks[i][1]) + start - starts[0], endMs: marks[i + 1] ? time(marks[i + 1][1]) + start - starts[0] : null });
      }
      entries.push(line(start, null, text.replace(/<\d+:\d{2}(?:\.\d{1,3})?>/g, ''), { words }));
    }
  }
  entries.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < entries.length; i++) {
    const current = entries[i];
    const next = entries.slice(i + 1).find(item => item.startMs > current.startMs);
    const finalWord = current.words.at(-1);
    current.endMs = Math.max(next?.startMs ?? current.startMs + 5000, finalWord?.endMs ?? ((finalWord?.startMs ?? current.startMs) + 1));
    if (finalWord && finalWord.endMs === null) finalWord.endMs = current.endMs;
    // 标准 LRC 正 offset 表示提前显示，因此从时间戳中减去 offset。
    current.startMs -= offset; current.endMs -= offset;
    for (const word of current.words) { word.startMs -= offset; word.endMs -= offset; }
    if (current.startMs < 0) throw new Error('LRC offset 导致负时间，请修正文件中的 offset');
  }
  warnings.push('LRC 无显式结束时间的行使用下一行起点；末行默认持续 5 秒，需按音源核对。');
  if (!entries.some(item => item.words.length)) warnings.push('普通 LRC 仅有逐行时间戳，不会自动推算逐字。');
  return { lines: entries, metadata, warnings: [...new Set(warnings)] };
}

function parseYrc(input) {
  const lines = [];
  for (const row of input.split('\n')) {
    const m = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) continue;
    const words = [...m[3].matchAll(/\((\d+),(\d+),\d+\)([^()]*)/g)].map(w => ({ startMs: +w[1], endMs: +w[1] + +w[2], text: w[3] }));
    if (words.length) lines.push(line(+m[1], +m[1] + +m[2], words.map(w => w.text).join(''), { words }));
  }
  return { lines, metadata: {}, warnings: [] };
}

function parseTtml(input) {
  if (/<!DOCTYPE|<!ENTITY/i.test(input)) throw new Error('为安全起见，不支持包含 DTD 或实体声明的 TTML');
  const errors = [];
  const xml = new DOMParser({ onError: (level, message) => { errors.push(message); } }).parseFromString(input, 'application/xml');
  if (errors.length || xml.documentElement?.localName !== 'tt') throw new Error('TTML XML 格式无效');
  const metadata = {};
  for (const element of Array.from(xml.getElementsByTagName('*'))) {
    if (element.localName === 'meta' && element.hasAttribute('key')) {
      const key = element.getAttribute('key');
      // 元数据是远程不可信输入，拒绝对象原型相关键。
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
      (metadata[key] ||= []).push(element.getAttribute('value'));
    }
    if (element.getAttribute('timeContainer') === 'seq') throw new Error('暂不支持 seq 相对时间 TTML，请使用 AMLL 格式');
  }
  const lines = [];
  const attr = (node, name) => node.getAttribute(name) || '';
  function readLine(node, parent, role = 'main') {
    const startMs = attr(node, 'begin') ? time(attr(node, 'begin')) : parent?.startMs;
    const endMs = attr(node, 'end') ? time(attr(node, 'end')) : attr(node, 'dur') ? startMs + time(attr(node, 'dur')) : parent?.endMs;
    const out = line(startMs, endMs, '', { role, agent: attr(node, 'ttm:agent') || parent?.agent || null });
    function visit(part) {
      if (part.nodeType === 3 || part.nodeType === 4) { out.text += part.data; return; }
      if (part.nodeType !== 1) return;
      const partRole = attr(part, 'ttm:role');
      if (partRole === 'x-bg') { readLine(part, out, 'background'); return; }
      if (partRole === 'x-translation' || partRole === 'x-roman') {
        out[partRole === 'x-translation' ? 'translations' : 'romanization'].push({ text: part.textContent, language: attr(part, 'xml:lang') || null }); return;
      }
      if (part.localName === 'br') { out.text += '\n'; return; }
      if (attr(part, 'begin') && (attr(part, 'end') || attr(part, 'dur')) && !Array.from(part.childNodes).some(c => c.nodeType === 1 && c.hasAttribute('begin'))) {
        const wordStart = time(attr(part, 'begin'));
        const wordEnd = attr(part, 'end') ? time(attr(part, 'end')) : wordStart + time(attr(part, 'dur'));
        out.words.push({ startMs: wordStart, endMs: wordEnd, text: part.textContent });
        out.text += part.textContent; return;
      }
      for (const child of Array.from(part.childNodes)) visit(child);
    }
    for (const child of Array.from(node.childNodes)) visit(child);
    if (out.text.trim()) lines.push(out);
  }
  for (const element of Array.from(xml.getElementsByTagName('*'))) if (element.localName === 'p') readLine(element);
  return { lines, metadata, warnings: [] };
}

function parseLyrics(input, format, source = {}) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > MAX_BYTES) throw new Error('歌词文件过大（最多 8 MB）');
  const parsers = { srt: parseSrt, lrc: parseLrc, ttml: parseTtml, yrc: parseYrc };
  if (!parsers[format]) throw new Error('仅支持 SRT、LRC、TTML、YRC');
  const result = parsers[format](input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
  return validateDocument({ schemaVersion: 1, source: { ...source, format }, ...result });
}

function attachTranslations(doc, text, field = 'translations') {
  if (!text) return doc;
  try {
    const translated = parseLyrics(text, 'lrc');
    const byStart = new Map(translated.lines.map(item => [item.startMs, item.text]));
    for (const item of doc.lines) if (byStart.has(item.startMs)) item[field].push({ text: byStart.get(item.startMs), language: null });
  } catch { doc.warnings.push('附加翻译或音译格式无效，已保留原文。'); }
  return doc;
}

module.exports = { time, parseLyrics, validateDocument, attachTranslations, MAX_BYTES };

