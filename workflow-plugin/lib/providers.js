'use strict';

const crypto = require('node:crypto');
const { json } = require('./http');
const { parseLyrics, attachTranslations } = require('./lyrics');

// 请求封装参考 jitwxs/163MusicLyrics（Apache-2.0）；详见 THIRD_PARTY_NOTICES.md。
// 这些是平台客户端接口，不承诺开放 API 的稳定性，不绕过登录或访问限制。
const MODULUS = BigInt('0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7');
function modPow(base, exp, modulus) {
  let value = 1n;
  while (exp > 0n) { if (exp & 1n) value = value * base % modulus; base = base * base % modulus; exp >>= 1n; }
  return value;
}
function aes(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from('0102030405060708'));
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}
function weapi(data) {
  const key = crypto.randomBytes(8).toString('hex');
  const reversed = Buffer.from([...key].reverse().join('')).toString('hex');
  return new URLSearchParams({ params: aes(aes(JSON.stringify(data), '0CoJUm6Qyw8W8jud'), key), encSecKey: modPow(BigInt(`0x${reversed}`), 65537n, MODULUS).toString(16).padStart(256, '0') }).toString();
}
function candidate(provider, id, title, artists = [], album = '') {
  return { key: `${provider}:${id}`, provider, id: String(id), title, artists, album, authors: [] };
}
function checkNetease(data) {
  if (data.code !== 200) throw new Error(`网易云暂不可用（代码 ${data.code ?? '未知'}），可能需要登录、地区不支持或接口限流`);
}
class PlatformProviders {
  constructor(transport = json) { this.transport = transport; }
  ncm(endpoint, data) {
    return this.transport(`https://music.163.com/weapi/${endpoint}`, { method: 'POST', body: weapi({ ...data, csrf_token: '' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/' } });
  }
  async search(platform, query) {
    if (platform === 'netease') {
      const data = await this.ncm('cloudsearch/get/web', { s: query, type: '1', limit: '20', offset: '0' });
      checkNetease(data);
      if (data.abroad) throw new Error('网易云返回地区受限搜索结果，请使用歌曲链接或本地导入');
      return (data.result?.songs || []).map(song => candidate('netease', song.id, song.name, (song.ar || song.artists || []).map(a => a.name), song.al?.name || song.album?.name || ''));
    }
    if (platform === 'qq') {
      const data = await this.transport('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Referer: 'https://y.qq.com/' },
        body: JSON.stringify({ req_1: { method: 'DoSearchForQQMusicDesktop', module: 'music.search.SearchCgiService', param: { num_per_page: 20, page_num: 1, query, search_type: 0 } } }),
      });
      if (data.code !== 0 || data.req_1?.code !== 0) throw new Error(`QQ 音乐搜索不可用（代码 ${data.req_1?.code ?? data.code ?? '未知'}），请尝试歌曲链接或本地导入`);
      return (data.req_1.data?.body?.song?.list || []).map(song => candidate('qq', song.mid, song.title || song.name, (song.singer || []).map(a => a.name), song.album?.name || ''));
    }
    throw new Error('此平台暂不支持直接搜索');
  }
  async lyrics(item) {
    if (item.provider === 'netease') {
      if (!/^\d+$/.test(item.id)) throw new Error('网易云歌曲 ID 必须是数字');
      const data = await this.ncm('song/lyric', { id: item.id, os: 'pc', lv: '-1', kv: '-1', tv: '-1', rv: '-1', yv: '-1', ytv: '-1', yrv: '-1' });
      checkNetease(data);
      if (data.nolyric || data.pureMusic) throw new Error('平台标记此歌曲为纯音乐／无歌词');
      const wordText = data.yrc?.lyric;
      const lineText = data.lrc?.lyric;
      if (!wordText && !lineText) throw new Error('平台未返回可用歌词，可能需要登录或无访问权限');
      const source = { provider: 'netease', id: item.id, title: item.title, artists: item.artists, url: `https://music.163.com/song?id=${item.id}` };
      let doc;
      if (wordText) {
        try { doc = parseLyrics(wordText, 'yrc', source); } catch (error) {
          if (!lineText) throw error;
          doc = parseLyrics(lineText, 'lrc', source); doc.warnings.push(`逐字歌词无法解析，降级使用逐行歌词：${error.message}`);
        }
      } else doc = parseLyrics(lineText, 'lrc', source);
      attachTranslations(doc, doc.source.format === 'yrc' ? data.ytlrc?.lyric || data.tlyric?.lyric : data.tlyric?.lyric);
      attachTranslations(doc, doc.source.format === 'yrc' ? data.yromalrc?.lyric || data.romalrc?.lyric : data.romalrc?.lyric, 'romanization');
      return doc;
    }
    if (item.provider === 'qq') {
      if (!/^[A-Za-z0-9]+$/.test(item.id)) throw new Error('QQ 歌曲 ID 无效');
      if (/^\d+$/.test(item.id)) throw new Error('QQ 平台回退需要 songmid，请使用含 songmid 的歌曲链接或歌曲名搜索');
      const url = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
      url.search = new URLSearchParams({ songmid: item.id, format: 'json', nobase64: '1', g_tk: '5381', platform: 'yqq', inCharset: 'utf8', outCharset: 'utf8' }).toString();
      const data = await this.transport(url.href, { headers: { Referer: 'https://y.qq.com/' } });
      if (data.code !== 0 || !data.lyric) throw new Error(`QQ 音乐未返回歌词（代码 ${data.code ?? '未知'}），可能受登录或访问限制`);
      const decode = value => !value ? '' : value.includes('[') ? value : Buffer.from(value, 'base64').toString('utf8');
      const doc = parseLyrics(decode(data.lyric), 'lrc', { provider: 'qq', id: item.id, title: item.title, artists: item.artists, url: `https://y.qq.com/n/ryqq/songDetail/${item.id}` });
      attachTranslations(doc, decode(data.trans));
      doc.warnings.push('QQ 平台回退目前使用逐行 LRC；逐字版本优先从 AMLL 歌词库选择。');
      return doc;
    }
    throw new Error('Apple Music / Spotify 链接仅支持 AMLL 匹配；未匹配时请改用网易云／QQ 歌曲名搜索，或导入本地歌词');
  }
}
module.exports = { PlatformProviders, candidate, weapi };
