'use strict';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { AmllDatabase } = require('./lib/amll');
const { PlatformProviders } = require('./lib/providers');
const { LyricService } = require('./lib/service');
const { parseLyrics } = require('./lib/lyrics');
const { readLyricFile } = require('./lib/files');
const { makeJob, lineRange, toSrt } = require('./lib/job');
const { formatDocument } = require('./lib/word-joiner');
const { createResolveHost } = require('./lib/resolve');
const renderer = require('./adapters/renderer');
const host = createResolveHost(() => require('./WorkflowIntegration.node'));
let window, service, selected = null, busy = false;
const uiFile = path.join(__dirname, 'ui', 'index.html');

async function execute(action, args = {}) {
  if (action === 'status') {
    let timeline = null, hostError = null;
    try { timeline = (await host.context()).info; }
    catch (error) { hostError = error.message; }
    return { timeline, hostError, renderer: { available: host.remote || renderer.available === true, reason: host.remote ? '' : renderer.reason || '' } };
  }
  if (action === 'search') return service.search(args.query, args.options);
  if (action === 'titleSources') {
    if (host.remote) return host.titleSources();
    const context = await host.context();
    return renderer.listTitles(context);
  }
  if (action === 'select' || action === 'platformLyrics') {
    const result = await service[action](args.key);
    if (result.document) selected = result.document;
    return result;
  }
  if (action === 'importFile') {
    const choice = await dialog.showOpenDialog(window, { title: '导入歌词', properties: ['openFile'], filters: [{ name: '歌词与字幕', extensions: ['srt', 'lrc', 'ttml', 'yrc'] }] });
    if (choice.canceled) return { canceled: true };
    const file = choice.filePaths[0];
    const { text, encoding } = await readLyricFile(file, args.encoding);
    const document = parseLyrics(text, path.extname(file).slice(1).toLowerCase(), { provider: 'local', title: path.basename(file), filename: path.basename(file), encoding });
    selected = document;
    return { document };
  }
  if (action === 'parsePaste') {
    const document = parseLyrics(args.text, args.format, { provider: 'paste', title: '粘贴的歌词' });
    selected = document; return { document };
  }
  if (['export', 'render'].includes(action)) {
    if (!selected) throw new Error('请先选择或导入歌词');
    if (action === 'render' && !host.remote && renderer.available !== true) throw new Error(renderer.reason);
    let job;
    if (args.format !== 'srt' || action === 'render') {
      const context = await host.context();
      job = makeJob(selected, args.settings || {}, context.info);
      if (action === 'render') {
        const onProgress = progress => {
          if (window && !window.isDestroyed()) window.webContents.send('amll:render-progress', progress);
        };
        if (host.remote) return host.render(job, onProgress);
        const result = await renderer.render({ job, ...context, onProgress });
        if (!Number.isSafeInteger(result?.insertedCount) || result.insertedCount < 1) throw new Error('渲染模块未确认创建剪辑，请检查时间线，勿直接重复添加');
        return result;
      }
    }
    if (!['srt', 'json'].includes(args.format)) throw new Error('不支持的导出格式');
    const offset = Number(args.settings?.offsetMs ?? 0);
    if (!Number.isFinite(offset) || Math.abs(offset) > 86400000) throw new Error('歌词偏移必须在正负 24 小时内');
    const ranged = formatDocument(lineRange(selected, args.settings || {}), args.settings || {});
    const data = args.format === 'srt' ? toSrt(ranged, offset) : JSON.stringify(job, null, 2);
    const choice = await dialog.showSaveDialog(window, { title: '导出歌词', defaultPath: `lyrics.${args.format}`, filters: [{ name: args.format.toUpperCase(), extensions: [args.format] }] });
    if (choice.canceled) return { canceled: true };
    await fs.writeFile(choice.filePath, data, 'utf8');
    return { path: choice.filePath };
  }
  throw new Error('不支持的操作');
}

app.whenReady().then(() => {
  service = new LyricService(new AmllDatabase(path.join(app.getPath('userData'), 'amll-lyrics-cache')), new PlatformProviders());
  window = new BrowserWindow({ width: 1140, height: 840, minWidth: 840, minHeight: 640, title: 'AppleMusic样式标题', backgroundColor: '#11131a', webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.handle('amll:command', async (event, action, args) => {
    if (event.sender !== window.webContents || event.senderFrame?.url !== pathToFileURL(uiFile).href) return { ok: false, error: '拒绝来自非插件页面的请求' };
    if (busy) return { ok: false, error: '上一项操作仍在进行，请稍候' };
    busy = true;
    try { return { ok: true, data: await execute(action, args) }; }
    catch (error) { return { ok: false, error: error.message || '操作失败' }; }
    finally { busy = false; }
  });
  window.loadFile(uiFile);
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => host.cleanup());
