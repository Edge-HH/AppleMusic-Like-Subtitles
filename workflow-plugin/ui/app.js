'use strict';
const $ = id => document.getElementById(id);
const names = { amll: 'AMLL TTML', netease: '网易云平台', qq: 'QQ 音乐平台', local: '本地文件', paste: '粘贴内容' };
let selected = null, status = null, busy = false;
function setMessage(text) { $('message').textContent = text; }
function warnings(items = []) {
  $('warnings').replaceChildren(...items.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
function controls() {
  document.querySelectorAll('button,input,select,textarea').forEach(control => { control.disabled = busy; });
  $('startFrame').disabled = busy || $('anchor').value !== 'frame';
  $('render').disabled = busy || !selected || !status?.renderer.available || !status?.timeline;
  $('exportJson').disabled = busy || !selected || !status?.timeline;
  $('exportSrt').disabled = busy || !selected;
}
async function command(action, args) {
  if (!window.lyricsAPI) throw new Error('请从达芬奇 Studio 的工作流程集成菜单打开插件，而不是直接打开 HTML');
  const result = await window.lyricsAPI.command(action, args);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
async function run(label, work) {
  if (busy) return;
  busy = true; controls(); setMessage(label);
  try { await work(); } catch (error) { setMessage(`操作未完成：${error.message}`); }
  finally { busy = false; controls(); }
}
function time(ms) { return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`; }
function showDocument(doc) {
  selected = doc;
  $('songTitle').textContent = doc.source.title || doc.metadata?.ti || doc.metadata?.musicName?.join(' / ') || '导入的歌词';
  $('sourceInfo').textContent = [names[doc.source.provider] || doc.source.provider, { word: '逐字时间戳', line: '逐行时间戳', mixed: '逐字与逐行混合' }[doc.timing], `${doc.lines.length} 行`, doc.source.authors?.length ? `歌词作者：${doc.source.authors.join('、')}` : '', doc.source.encoding ? `编码：${doc.source.encoding}` : ''].filter(Boolean).join(' · ');
  const fragment = document.createDocumentFragment();
  // 限制一次 DOM 构建规模；导出和渲染仍使用完整歌词文档。
  for (const item of doc.lines.slice(0, 1000)) {
    const row = document.createElement('div'); row.className = 'lyric-line';
    const clock = document.createElement('time'); clock.textContent = `${time(item.startMs)} → ${time(item.endMs)}${item.role === 'background' ? ' · 和声' : ''}${item.agent ? ` · ${item.agent}` : ''}`;
    const text = document.createElement('p');
    if (item.words.length) {
      for (const word of item.words) {
        const span = document.createElement('span'); span.className = 'word'; span.textContent = word.text; span.title = `${time(word.startMs)} → ${time(word.endMs)}`; text.append(span);
      }
    } else text.textContent = item.text;
    row.append(clock, text);
    for (const translation of [...item.translations, ...item.romanization]) { const p = document.createElement('p'); p.className = 'translation'; p.textContent = translation.text; row.append(p); }
    fragment.append(row);
  }
  $('preview').replaceChildren(fragment);
  warnings([...doc.warnings, ...(doc.lines.length > 1000 ? ['预览只显示前 1000 行；导出和渲染包含全部歌词。'] : [])]);
  setMessage('已选择歌词；尚未修改达芬奇时间线。请核对音源版本、时间起点和偏移。');
}
function showResults(items, total) {
  $('resultCount').textContent = `${items.length} 个候选${total > 100 ? `（AMLL 共 ${total} 个，仅展示最新 100 个）` : ''}`;
  $('results').replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '未找到匹配。可更换关键词、使用歌曲链接或导入本地歌词。'; $('results').append(p); }
  for (const item of items) {
    const container = document.createElement('div');
    const button = document.createElement('button'); button.className = 'candidate'; button.setAttribute('aria-pressed', 'false');
    const title = document.createElement('strong'); title.textContent = item.title;
    const desc = document.createElement('small'); desc.textContent = [names[item.provider], item.artists.join(' / '), item.album, item.authors.length ? `歌词作者：${item.authors.join(' / ')}` : '', item.file || item.id].filter(Boolean).join(' · ');
    button.append(title, desc);
    button.addEventListener('click', () => run('正在获取所选歌词…', async () => {
      const result = await command('select', { key: item.key });
      if (result.alternatives) { showResults(result.alternatives); warnings(result.warnings); setMessage('该歌曲 ID 在 AMLL 找到以下版本，请选择一个。'); }
      else { document.querySelectorAll('.candidate').forEach(node => node.setAttribute('aria-pressed', 'false')); button.setAttribute('aria-pressed', 'true'); showDocument(result.document); }
    }));
    container.append(button);
    if (item.provider !== 'amll') {
      const direct = document.createElement('button'); direct.className = 'secondary'; direct.textContent = '直接尝试平台歌词';
      direct.addEventListener('click', () => run('正在请求平台歌词…', async () => showDocument((await command('platformLyrics', { key: item.key })).document)));
      container.append(direct);
    }
    $('results').append(container);
  }
}
async function refreshHost() {
  status = await command('status');
  $('hostStatus').className = `banner${status.hostError ? ' error' : ''}`;
  $('hostStatus').textContent = status.hostError || `已连接时间线：${status.timeline.name} · ${(status.timeline.frameRate.numerator / status.timeline.frameRate.denominator).toFixed(3)} fps · 播放头 ${status.timeline.currentTimecode}`;
  $('rendererStatus').textContent = status.renderer.available ? '样式模块已连接，可在新视频轨道添加歌词。' : status.renderer.reason;
  if (status.timeline) $('startFrame').value = status.timeline.startFrame;
  setMessage('连接状态已更新。');
}
$('refreshHost').addEventListener('click', () => run('正在检查连接…', refreshHost));
$('searchForm').addEventListener('submit', event => {
  event.preventDefault();
  run('正在搜索歌词，首次同步可能需要一些时间…', async () => {
    const result = await command('search', { query: $('query').value, options: { refresh: $('refreshIndex').checked, platformSearch: $('platformSearch').checked, platform: $('platform').value } });
    showResults(result.results, result.totalAmll); warnings(result.warnings);
    setMessage(`搜索完成。${result.indexUpdatedAt ? `词库更新时间：${new Date(result.indexUpdatedAt).toLocaleString('zh-CN')}。` : ''}请选择候选版本。`);
  });
});
$('importFile').addEventListener('click', () => run('请选择歌词文件…', async () => { const result = await command('importFile', { encoding: $('encoding').value }); if (result.document) showDocument(result.document); else setMessage('已取消导入。'); }));
$('parsePaste').addEventListener('click', () => run('正在解析…', async () => showDocument((await command('parsePaste', { text: $('pasteText').value, format: $('pasteFormat').value })).document)));
$('anchor').addEventListener('change', controls);
function settings() { return { anchor: $('anchor').value, startFrame: Number($('startFrame').value), offsetMs: Number($('offsetMs').value) }; }
for (const [id, format] of [['exportJson', 'json'], ['exportSrt', 'srt']]) {
  $(id).addEventListener('click', () => run('准备导出…', async () => {
    const result = await command('export', { format, settings: settings() });
    setMessage(result.canceled ? '已取消导出。' : `已导出：${result.path}${format === 'srt' ? '\n普通 SRT 不包含逐字动画和 Apple Music 样式，仅应用歌词偏移，不含时间线插入起点。' : '\n这是渲染对接文件，尚未创建时间线剪辑。'}`);
  }));
}
$('render').addEventListener('click', () => run('正在创建歌词剪辑，请勿切换时间线…', async () => { const result = await command('render', { settings: settings() }); setMessage(`渲染模块确认添加 ${result.insertedCount} 个剪辑。${result.message || ''}`); }));
run('正在检查达芬奇连接…', refreshHost);
