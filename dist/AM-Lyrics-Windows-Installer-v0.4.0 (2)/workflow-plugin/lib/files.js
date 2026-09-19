'use strict';
const fs = require('node:fs/promises');
const { MAX_BYTES } = require('./lyrics');
async function readLyricFile(file, encoding = 'auto') {
  if (!['auto', 'utf-8', 'gb18030', 'utf-16le', 'utf-16be'].includes(encoding)) throw new Error('不支持的文件编码');
  const stat = await fs.stat(file);
  if (stat.size > MAX_BYTES) throw new Error('歌词文件超过 8 MB 限制');
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_BYTES) throw new Error('歌词文件超过 8 MB 限制');
  let selected = encoding;
  if (selected === 'auto') {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) selected = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) selected = 'utf-16be';
    else { try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }; } catch { selected = 'gb18030'; } }
  }
  return { text: new TextDecoder(selected, { fatal: true }).decode(bytes), encoding: selected };
}
module.exports = { readLyricFile };
