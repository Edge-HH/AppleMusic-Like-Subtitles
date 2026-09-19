'use strict';

const ID_KEYS = { netease: 'ncmMusicId', qq: 'qqMusicId', apple: 'appleMusicId', spotify: 'spotifyId' };
function parseInput(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 2000) throw new Error('请输入歌曲名或歌曲链接（最多 2000 字符）');
  const text = input.trim();
  const explicit = text.match(/^(netease|qq|apple|spotify):([A-Za-z0-9]+)$/);
  if (explicit) return { platform: explicit[1], id: explicit[2] };
  const match = text.match(/https?:\/\/[^\s<>"「」]+/);
  if (!match) return { query: text };
  const url = new URL(match[0].replace(/[）。，！!]+$/, ''));
  if (url.username || url.password || (url.port && url.port !== '443')) throw new Error('链接包含不允许的认证信息或端口');
  const host = url.hostname;
  const path = url.pathname;
  const hashParams = new URLSearchParams(url.hash.split('?')[1] || '');
  let platform, id;
  if (['music.163.com', 'y.music.163.com'].includes(host)) {
    platform = 'netease';
    if (/song/i.test(path + url.hash)) id = url.searchParams.get('id') || hashParams.get('id') || path.match(/\/song\/(\d+)/)?.[1];
    if (!id && /\/m\//.test(path)) return { shortUrl: url.href.replace(/^http:/, 'https:') };
  } else if (host === '163cn.tv') {
    return { shortUrl: url.href.replace(/^http:/, 'https:') };
  } else if (host === 'y.qq.com') {
    platform = 'qq';
    id = url.searchParams.get('songmid') || url.searchParams.get('songid') || path.match(/\/(?:songDetail|song)\/([A-Za-z0-9]+)/i)?.[1];
    if (!id && path.endsWith('/ryqq/songDetail')) id = url.searchParams.get('id');
    if (!id && path.includes('/n/ryqq/songDetail/')) id = path.split('/').at(-1);
    if (!id && (path.includes('/n/ryqq/') || path.includes('/n2/m/') || path.includes('/base/fcgi-bin/'))) return { shortUrl: url.href.replace(/^http:/, 'https:') };
  } else if (host === 'music.apple.com') {
    platform = 'apple'; id = url.searchParams.get('i') || (/\/song\//.test(path) ? path.match(/\/(\d+)$/)?.[1] : null);
  } else if (host === 'open.spotify.com') {
    platform = 'spotify'; id = path.match(/\/track\/([A-Za-z0-9]+)/)?.[1];
  } else throw new Error('暂不支持此链接，请输入歌曲名，或使用网易云、QQ、Apple Music、Spotify 的歌曲链接');
  if (!id || !/^[A-Za-z0-9]+$/.test(id)) throw new Error('未找到歌曲 ID，请粘贴单曲链接，而不是专辑或歌单链接');
  return { platform, id };
}
module.exports = { parseInput, ID_KEYS };
