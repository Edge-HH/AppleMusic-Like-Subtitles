'use strict';
const { parseInput } = require('./input');
const { request } = require('./http');
const { parseLyrics } = require('./lyrics');
const { candidate } = require('./providers');

class LyricService {
  constructor(database, providers, transport = request) { this.database = database; this.providers = providers; this.transport = transport; this.candidates = new Map(); }
  remember(items) { for (const item of items) this.candidates.set(item.key, item); return items; }
  async search(text, options = {}) {
    let input = parseInput(text);
    if (input.shortUrl) {
      const response = await this.transport(input.shortUrl, { maxBytes: 2 * 1024 * 1024 });
      input = parseInput(response.url);
      if (input.shortUrl) throw new Error('此分享链接未直接跳转到单曲，请打开后复制完整歌曲链接或输入歌名');
    }
    this.candidates.clear();
    const warnings = [];
    let amll = { results: [], total: 0 };
    try { amll = await this.database.search(input, Boolean(options.refresh)); warnings.push(...amll.warnings); } catch (error) { warnings.push(error.message); }
    const results = this.remember(amll.results);
    if (!results.length || options.platformSearch) {
      if (input.id) {
        if (['netease', 'qq'].includes(input.platform)) results.push(...this.remember([candidate(input.platform, input.id, `平台歌曲 ${input.id}`)]));
        else warnings.push('此歌曲未匹配 AMLL；Apple Music / Spotify 暂不提供平台歌词回退，请搜索歌名或导入本地歌词。');
      } else {
        const platforms = options.platform === 'all' || !options.platform ? ['netease', 'qq'] : [options.platform];
        if (platforms.some(platform => !['netease', 'qq'].includes(platform))) throw new Error('不支持的搜索平台');
        const searches = await Promise.allSettled(platforms.map(platform => this.providers.search(platform, input.query)));
        for (const outcome of searches) {
          if (outcome.status === 'fulfilled') results.push(...this.remember(outcome.value));
          else warnings.push(outcome.reason.message);
        }
      }
    }
    return { results, warnings, totalAmll: amll.total, indexUpdatedAt: amll.at || null };
  }
  async select(key) {
    const item = this.candidates.get(key);
    if (!item) throw new Error('搜索结果已过期，请重新搜索');
    if (item.provider !== 'amll') {
      // 歌名从平台定位后，再用精确 ID 检查 AMLL，避免标题差异导致漏掉逐字版本。
      try {
        const alternatives = await this.database.search({ platform: item.provider, id: item.id });
        if (alternatives.results.length) return { alternatives: this.remember(alternatives.results), warnings: alternatives.warnings };
      } catch { /* 已在搜索阶段展示源故障；用户仍可选择可用的平台歌词。 */ }
      return { document: await this.providers.lyrics(item) };
    }
    const raw = await this.database.lyrics(item);
    return { document: parseLyrics(raw.text, raw.format, raw.source) };
  }
  async platformLyrics(key) {
    const item = this.candidates.get(key);
    if (!item || item.provider === 'amll') throw new Error('请选择网易云或 QQ 音乐候选歌曲');
    return { document: await this.providers.lyrics(item) };
  }
}
module.exports = { LyricService };
