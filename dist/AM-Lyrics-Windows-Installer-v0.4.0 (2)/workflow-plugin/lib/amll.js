'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { request } = require('./http');
const { ID_KEYS } = require('./input');
const ROOT = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/';

function parseIndex(text) {
  const result = [];
  for (const row of text.split('\n')) {
    if (!row.trim()) continue;
    const data = JSON.parse(row);
    if (typeof data.rawLyricFile !== 'string' || !/^[A-Za-z0-9,-]+\.ttml$/.test(data.rawLyricFile) || !Array.isArray(data.metadata)) throw new Error('AMLL 索引结构发生变化');
    const metadata = Object.create(null);
    for (const pair of data.metadata) if (Array.isArray(pair) && typeof pair[0] === 'string' && Array.isArray(pair[1])) metadata[pair[0]] = pair[1].map(String);
    result.push({ key: `amll:${data.rawLyricFile}`, provider: 'amll', file: data.rawLyricFile, title: metadata.musicName?.join(' / ') || '未命名歌曲', artists: metadata.artists || [], album: metadata.album?.join(' / ') || '', authors: metadata.ttmlAuthorGithubLogin || metadata.ttmlAuthorGithub || [], metadata });
  }
  if (!result.length) throw new Error('AMLL 索引为空');
  return result;
}

class AmllDatabase {
  constructor(cacheDirectory, transport = request) { this.cacheDirectory = cacheDirectory; this.transport = transport; this.pending = null; this.memory = null; }
  async load(force = false) {
    if (this.pending) return this.pending;
    this.pending = this.loadInternal(force).finally(() => { this.pending = null; });
    return this.pending;
  }
  async loadInternal(force) {
    let cached = this.memory;
    const file = path.join(this.cacheDirectory, 'amll-index.json');
    if (!cached) {
      try { const raw = JSON.parse(await fs.readFile(file, 'utf8')); cached = { at: raw.at, entries: parseIndex(raw.text) }; } catch { /* 损坏或不存在的缓存不能阻止重新同步。 */ }
    }
    if (cached && !force && Date.now() - cached.at < 86400000) return cached;
    try {
      const { text } = await this.transport(`${ROOT}metadata/raw-lyrics-index.jsonl`);
      const entries = parseIndex(text);
      const at = Date.now();
      let warning;
      try {
        await fs.mkdir(this.cacheDirectory, { recursive: true });
        await fs.writeFile(`${file}.tmp`, JSON.stringify({ at, text }), 'utf8');
        await fs.rename(`${file}.tmp`, file);
      } catch { warning = '索引已加载，但无法保存本地缓存。'; }
      this.memory = { at, entries };
      return { ...this.memory, warning };
    } catch (error) {
      if (cached) { this.memory = cached; return { ...cached, warning: `同步失败，正在使用 ${new Date(cached.at).toLocaleString('zh-CN')} 的旧索引：${error.message}` }; }
      throw new Error(`AMLL 索引加载失败：${error.message}`);
    }
  }
  async search(input, force = false) {
    const { entries, at, warning } = await this.load(force);
    const norm = value => value.normalize('NFKC').toLocaleLowerCase();
    const terms = input.query ? norm(input.query).split(/\s+/).filter(Boolean) : [];
    const matches = entries.filter(item => input.id ? (item.metadata[ID_KEYS[input.platform]] || []).includes(input.id) : terms.every(term => norm([item.title, ...item.artists, item.album].join(' ')).includes(term)));
    matches.reverse(); // 索引从旧到新排列，最新提交优先，但历史版本仍可选择。
    return { results: matches.slice(0, 100), total: matches.length, at, warnings: warning ? [warning] : [] };
  }
  async lyrics(candidate) {
    if (!/^[A-Za-z0-9,-]+\.ttml$/.test(candidate.file)) throw new Error('AMLL 文件名无效');
    const url = `${ROOT}raw-lyrics/${candidate.file}`;
    const { text } = await this.transport(url, { maxBytes: 8 * 1024 * 1024 });
    return { text, format: 'ttml', source: { provider: 'amll', url, title: candidate.title, artists: candidate.artists, authors: candidate.authors, id: candidate.file } };
  }
}
module.exports = { AmllDatabase, parseIndex, ROOT };

