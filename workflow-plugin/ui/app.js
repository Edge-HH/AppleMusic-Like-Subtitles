'use strict';
const $ = id => document.getElementById(id);
const names = { amll: 'AMLL TTML', netease: '网易云平台', qq: 'QQ 音乐平台', local: '本地文件', paste: '粘贴内容' };
let selected = null, status = null, busy = false, importInProgress = false;
function setMessage(text) { $('message').textContent = text; }
function warnings(items = []) {
  $('warnings').replaceChildren(...items.map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
}
function controls() {
  document.querySelectorAll('button,input,select,textarea').forEach(control => { control.disabled = busy; });
  $('wordSeparator').disabled = busy || $('joinerMode').value !== 'custom';
  $('startFrame').disabled = busy || $('anchor').value !== 'frame';
  $('rangeStartLine').disabled = busy || !selected;
  $('rangeEndLine').disabled = busy || !selected;
  $('render').disabled = busy || !selected || !status?.renderer?.available || !status?.timeline;
  $('exportJson').disabled = busy || !selected || !status?.timeline;
  $('exportSrt').disabled = busy || !selected;
}
async function command(action, args) {
  if (!window.lyricsAPI) throw new Error('请从达芬奇的 工作区 → 脚本 → Utility → AppleMusic样式标题 打开插件，而不是直接打开 HTML');
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
function normalizedRange() {
  if (!selected) return { first: 1, last: 1 };
  const first = Math.max(1, Math.min(selected.lines.length, Number($('rangeStartLine').value) || 1));
  const last = Math.max(first, Math.min(selected.lines.length, Number($('rangeEndLine').value) || selected.lines.length));
  return { first, last };
}
function updateRangePreview() {
  if (!selected) return;
  const { first, last } = normalizedRange();
  $('rangeStartLine').value = first; $('rangeEndLine').value = last;
  document.querySelectorAll('.lyric-line').forEach((row, index) => row.classList.toggle('out-of-range', index + 1 < first || index + 1 > last));
  const start = selected.lines[first - 1], end = selected.lines[last - 1];
  $('rangeSummary').textContent = `将导入第 ${first}–${last} 行，共 ${last - first + 1} 行；范围 ${time(start.startMs)} → ${time(end.endMs)}`;
}
function joinerSettings() {
  return { joinerMode: $('joinerMode').value || 'auto', wordSeparator: $('wordSeparator').value };
}
function renderLyricPreview(doc) {
  const fragment = document.createDocumentFragment();
  for (const [index, raw] of doc.lines.slice(0, 1000).entries()) {
    const item = window.amllTextFormatting.formatLine(raw, joinerSettings());
    const row = document.createElement('div'); row.className = 'lyric-line'; row.dataset.line = index + 1;
    const clock = document.createElement('time'); clock.textContent = `第 ${index + 1} 行 · ${time(item.startMs)} → ${time(item.endMs)}${item.role === 'background' ? ' · 和声' : ''}${item.agent ? ` · ${item.agent}` : ''}`;
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
}
function showDocument(doc) {
  selected = doc;
  $('songTitle').textContent = doc.source.title || doc.metadata?.ti || doc.metadata?.musicName?.join(' / ') || '导入的歌词';
  $('sourceInfo').textContent = [names[doc.source.provider] || doc.source.provider, { word: '逐字时间戳', line: '逐行时间戳', mixed: '逐字与逐行混合' }[doc.timing], `${doc.lines.length} 行`, doc.source.authors?.length ? `歌词作者：${doc.source.authors.join('、')}` : '', doc.source.encoding ? `编码：${doc.source.encoding}` : ''].filter(Boolean).join(' · ');
  renderLyricPreview(doc);
  $('rangeStartLine').max = doc.lines.length; $('rangeEndLine').max = doc.lines.length;
  $('rangeStartLine').value = 1; $('rangeEndLine').value = doc.lines.length;
  updateRangePreview();
  warnings([...doc.warnings, ...(doc.lines.length > 1000 ? ['预览只显示前 1000 行；导出和渲染包含全部歌词。'] : [])]);
  setMessage('已选择歌词');
}
function showResults(items, total) {
  $('resultCount').textContent = `${items.length} 个候选${total > 100 ? `（AMLL 共 ${total} 个，仅展示最新 100 个）` : ''}`;
  $('results').replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '未找到匹配'; $('results').append(p); }
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
async function refreshTitleSources() {
  const previous = $('titleSource').value;
  const result = await command('titleSources');
  const options = [];
  const builtInGroup = document.createElement('optgroup'); builtInGroup.label = 'AppleMusic样式标题 逐字预设';
  for (const item of result.builtIn) { const option = document.createElement('option'); option.value = item.key; option.textContent = item.name; builtInGroup.append(option); options.push(item.key); }
  const mediaGroup = document.createElement('optgroup'); mediaGroup.label = '媒体池 Fusion 标题（逐行）';
  for (const item of result.mediaPool) { const option = document.createElement('option'); option.value = item.key; option.textContent = `${item.name} · ${item.path || '媒体池'} · ${item.type}`; mediaGroup.append(option); options.push(item.key); }
  $('titleSource').replaceChildren(builtInGroup, mediaGroup);
  $('titleSource').value = options.includes(previous) ? previous : 'am-default';
  if (!result.mediaPool.length) mediaGroup.label += '（未找到）';
}
async function refreshHost() {
  status = null;
  $('hostStatus').className = 'banner';
  $('hostStatus').textContent = '正在检查连接…';
  $('rendererStatus').textContent = '正在检查时间线写入模块…';
  try {
    const next = await command('status');
    if (next?.hostError) throw new Error(next.hostError);
    const timeline = next?.timeline;
    const rate = timeline?.frameRate;
    if (!timeline || typeof timeline.name !== 'string'
      || !Number.isFinite(rate?.numerator) || rate.numerator <= 0
      || !Number.isFinite(rate?.denominator) || rate.denominator <= 0
      || typeof next?.renderer?.available !== 'boolean') {
      throw new Error('未取得完整的时间线连接信息，请在达芬奇打开时间线后刷新连接');
    }
    status = next;
    $('hostStatus').textContent = `已连接时间线：${timeline.name} · ${(rate.numerator / rate.denominator).toFixed(3)} fps · 播放头 ${timeline.currentTimecode}`;
    $('rendererStatus').textContent = status.renderer.available ? '时间线写入模块已连接' : status.renderer.reason || '当前时间线写入模块不可用';
    $('startFrame').value = timeline.startFrame;
    await refreshTitleSources();
    setMessage('连接状态已更新');
  } catch (error) {
    status = null;
    $('hostStatus').className = 'banner error';
    $('hostStatus').textContent = error.message || '连接检查失败';
    $('rendererStatus').textContent = '时间线连接检查失败，暂不能写入';
    throw error;
  }
}
$('refreshHost').addEventListener('click', () => run('正在检查连接…', refreshHost));
$('refreshTitles').addEventListener('click', () => run('正在扫描媒体池 Fusion 标题…', async () => { await refreshTitleSources(); setMessage('Fusion 标题列表已刷新'); }));
$('searchForm').addEventListener('submit', event => {
  event.preventDefault();
  run('正在搜索歌词，首次同步可能需要一些时间…', async () => {
    const result = await command('search', { query: $('query').value, options: { refresh: $('refreshIndex').checked, platformSearch: $('platformSearch').checked, platform: $('platform').value } });
    showResults(result.results, result.totalAmll); warnings(result.warnings);
    setMessage(`搜索完成。${result.indexUpdatedAt ? `词库更新时间：${new Date(result.indexUpdatedAt).toLocaleString('zh-CN')}。` : ''}`);
  });
});
$('importFile').addEventListener('click', () => run('请选择歌词文件…', async () => { const result = await command('importFile', { encoding: $('encoding').value }); if (result.document) showDocument(result.document); else setMessage('已取消导入。'); }));
$('parsePaste').addEventListener('click', () => run('正在解析…', async () => showDocument((await command('parsePaste', { text: $('pasteText').value, format: $('pasteFormat').value })).document)));
$('anchor').addEventListener('change', controls);
for (const id of ['joinerMode', 'wordSeparator']) {
  $(id).addEventListener('change', () => run('正在更新连接符预览…', async () => {
    window.amllTextFormatting.options(joinerSettings());
    if (selected) { renderLyricPreview(selected); updateRangePreview(); }
    setMessage('连接符设置已更新');
  }));
}
$('rangeStartLine').addEventListener('change', updateRangePreview); $('rangeEndLine').addEventListener('change', updateRangePreview);
$('titleSource').addEventListener('change', () => { if ($('titleSource').value.startsWith('media:')) setMessage('已选择媒体池 Fusion 标题，导入时按逐行歌词处理'); });
function settings() {
  const { first, last } = normalizedRange();
  return { anchor: $('anchor').value, startFrame: Number($('startFrame').value), offsetMs: Number($('offsetMs').value), rangeStartLine: first, rangeEndLine: last, placementMode: $('placementMode').value, titleSource: $('titleSource').value, ...joinerSettings() };
}
for (const [id, format] of [['exportJson', 'json'], ['exportSrt', 'srt']]) {
  $(id).addEventListener('click', () => run('准备导出…', async () => {
    const result = await command('export', { format, settings: settings() });
    setMessage(result.canceled ? '已取消导出。' : `已导出：${result.path}`);
  }));
}
window.lyricsAPI?.onRenderProgress?.(progress => {
  if (!importInProgress) return;
  const count = Number.isFinite(progress?.completed) && Number.isFinite(progress?.total) && progress.total > 0 ? `（${progress.completed}/${progress.total} 行）` : '';
  const elapsed = Number.isFinite(progress?.elapsedSeconds) ? ` · 已用时 ${progress.elapsedSeconds} 秒` : '';
  setMessage(`${progress?.stage || '宿主正在处理导入，请勿重复操作'}${count}${elapsed}`);
});
$('render').addEventListener('click', () => run('正在导入歌词到时间线…', async () => {
  importInProgress = true;
  try {
    const result = await command('render', { settings: settings() });
    setMessage(`已创建 ${result.insertedCount} 个时间线片段`);
  } finally { importInProgress = false; }
}));
run('正在检查达芬奇连接…', refreshHost);
