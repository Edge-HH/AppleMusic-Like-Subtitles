'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { ScriptResolveHost } = require('../lib/resolve');

const info = { id: 'timeline-test', name: '测试时间线', frameRate: { numerator: 24, denominator: 1 }, startFrame: 86400, currentTimecode: '01:00:00:00' };

async function rpc(t, answer) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const request = JSON.parse(body); calls.push(request);
      const payload = answer(request);
      res.writeHead(payload.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { host: new ScriptResolveHost(server.address().port, 'test-token'), calls };
}

function mainProcess(host) {
  const file = path.resolve(__dirname, '../main.js');
  const requireMain = createRequire(file);
  const sandbox = vm.createContext({ __dirname: path.dirname(file), process, console,
    require(name) {
      if (name === 'electron') return { app: { whenReady: () => ({ then() {} }), on() {} }, ipcMain: {}, dialog: { showSaveDialog: async () => ({ canceled: true }) } };
      if (name === './lib/resolve') return { createResolveHost: () => host };
      return requireMain(name);
    },
  });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nglobalThis.executeForTest=execute;', sandbox);
  return sandbox.executeForTest;
}

async function renderer(command) {
  let deliverProgress = () => {};
  const html = fs.readFileSync(path.resolve(__dirname, '../ui/index.html'), 'utf8');
  const makeElement = () => ({ value: '', textContent: '', disabled: false, children: [], dataset: {}, classList: { toggle() {} },
    listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; } });
  const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, makeElement()]));
  elements.anchor.value = 'playhead'; elements.titleSource.value = 'am-default';
  elements.rendererStatus.textContent = '正在检查时间线写入模块…';
  const sandbox = vm.createContext({ console, window: { lyricsAPI: { command, onRenderProgress: handler => { deliverProgress = handler; } }, amllTextFormatting: require('../lib/word-joiner') }, document: {
    getElementById: id => elements[id], createElement: makeElement, createDocumentFragment: makeElement,
    querySelectorAll: selector => selector === '.lyric-line' ? [] : Object.values(elements),
  } });
  const source = fs.readFileSync(path.resolve(__dirname, '../ui/app.js'), 'utf8')
    .replace("run('正在检查达芬奇连接…', refreshHost);", "globalThis.ready=run('正在检查达芬奇连接…', refreshHost);");
  vm.runInContext(source + '\nglobalThis.refreshForTest=()=>run("刷新",refreshHost); globalThis.selectForTest=showDocument;', sandbox);
  await sandbox.ready;
  return { elements, refresh: sandbox.refreshForTest, select: sandbox.selectForTest, progress: value => deliverProgress(value) };
}

const normalReply = request => ({ ok: true, data: request.action === 'context' ? info : request.action === 'titleSources'
  ? { builtIn: [{ key: 'am-default', name: 'AppleMusic样式标题' }], mediaPool: [] }
  : { insertedCount: 1, sourceLineCount: 1, createdTrackCount: 1 } });

// Python dispatch('context') deliberately sends only the serializable flat info object.
test('脚本 RPC 上下文在桥接边界转换成与原生宿主相同的 info 契约', async t => {
  const { host } = await rpc(t, normalReply);
  assert.deepEqual((await host.context()).info, info);
});

test('真实 main status → UI 初始化不再读取 undefined.name，选择歌词后可写入', async t => {
  const { host } = await rpc(t, normalReply);
  const execute = mainProcess(host);
  const ui = await renderer(async (action, args) => ({ ok: true, data: await execute(action, args) }));
  assert.doesNotMatch(ui.elements.message.textContent, /Cannot read properties/);
  assert.match(ui.elements.hostStatus.textContent, /已连接时间线：测试时间线/);
  assert.match(ui.elements.rendererStatus.textContent, /已连接/);
  assert.doesNotMatch(ui.elements.message.textContent, /操作未完成|undefined/);
  const parsed = await execute('parsePaste', { format: 'lrc', text: '[00:00.00]你好' });
  ui.select(parsed.document);
  await ui.refresh();
  assert.equal(ui.elements.render.disabled, false);
});

test('导入与 JSON 导出复用修正后的上下文，不止消除 UI 异常', async t => {
  const { host, calls } = await rpc(t, normalReply);
  const execute = mainProcess(host);
  await execute('parsePaste', { format: 'lrc', text: '[00:00.00]你好' });
  const result = await execute('render', { settings: {} });
  assert.equal(result.insertedCount, 1);
  const job = calls.find(call => call.action === 'render').args.job;
  assert.equal(job.placement.timelineId, info.id);
  assert.equal(job.placement.timelineName, info.name);
  assert.equal(job.placement.startFrame, info.startFrame);
  assert.equal((await execute('export', { format: 'json', settings: {} })).canceled, true);
});

test('缺失／损坏的上下文明确拒绝，不能当作已连接', async t => {
  let data;
  const { host } = await rpc(t, () => ({ ok: true, data }));
  for (data of [null, {}, { ...info, frameRate: null }, { ...info, frameRate: { numerator: 0, denominator: 1 } }]) {
    await assert.rejects(host.context(), /时间线.*(无效|不完整)/);
  }
});

test('UI 对缺失时间线和断线清除检查中提示，失效后禁用写入', async () => {
  let failed = false;
  const ui = await renderer(async action => {
    if (action === 'titleSources') return { ok: true, data: normalReply({ action }).data };
    return { ok: true, data: failed ? { hostError: null, renderer: { available: true } }
      : { timeline: info, hostError: null, renderer: { available: true } } };
  });
  failed = true;
  await ui.refresh();
  assert.doesNotMatch(ui.elements.rendererStatus.textContent, /正在检查|已连接/);
  assert.doesNotMatch(ui.elements.message.textContent, /undefined/);
  assert.equal(ui.elements.render.disabled, true);
});

test('状态请求抛错时两个状态栏都结束等待', async () => {
  const ui = await renderer(async () => { throw new Error('脚本宿主响应超时'); });
  assert.doesNotMatch(ui.elements.rendererStatus.textContent, /正在检查/);
  assert.match(ui.elements.message.textContent, /响应超时/);
  assert.equal(ui.elements.render.disabled, true);
});


test('宿主没有时间线时显示原始提示，打开时间线后刷新可恢复写入', async t => {
  let disconnected = true;
  const { host } = await rpc(t, request => disconnected
    ? { ok: false, error: '请先创建或打开一条时间线' } : normalReply(request));
  const execute = mainProcess(host);
  const ui = await renderer(async (action, args) => ({ ok: true, data: await execute(action, args) }));
  assert.match(ui.elements.hostStatus.textContent, /请先创建或打开一条时间线/);
  assert.match(ui.elements.rendererStatus.textContent, /检查失败/);
  assert.equal(ui.elements.render.disabled, true);
  const parsed = await execute('parsePaste', { format: 'lrc', text: '[00:00.00]你好' });
  ui.select(parsed.document);
  disconnected = false;
  await ui.refresh();
  assert.match(ui.elements.hostStatus.textContent, /已连接时间线/);
  assert.equal(ui.elements.render.disabled, false);
});


test('界面导入期间显示进度，完成后忽略迟到的心跳', async () => {
  let complete;
  const ui = await renderer(async action => {
    if (action === 'render') return new Promise(resolve => { complete=resolve; });
    if (action === 'titleSources') return {ok:true,data:normalReply({action}).data};
    return {ok:true,data:{timeline:info,hostError:null,renderer:{available:true}}};
  });
  ui.select(require('../lib/lyrics').parseLyrics('[00:00.00]hello','lrc'));
  const running=ui.elements.render.listeners.click();
  ui.progress({stage:'正在写入顶层 Fusion 文字',completed:1,total:3,elapsedSeconds:130});
  assert.match(ui.elements.message.textContent,/1\/3 行/);
  assert.match(ui.elements.message.textContent,/130 秒/);
  complete({ok:true,data:{insertedCount:3,sourceLineCount:3,createdTrackCount:1}});
  await running;
  const message=ui.elements.message.textContent;
  ui.progress({elapsedSeconds:135});assert.equal(ui.elements.message.textContent,message);
});

test('修改连接符会更新预览但保留选定的歌词范围', async () => {
  const ui=await renderer(async action => ({ok:true,data:action==='titleSources'?normalReply({action}).data:{timeline:info,hostError:null,renderer:{available:true}}}));
  ui.select(require('../lib/lyrics').parseLyrics('[0,1000](0,400,0)Hello(400,600,0)world\n[2000,1000](2000,400,0)你(2400,600,0)好','yrc'));
  ui.elements.rangeStartLine.value='2';ui.elements.rangeEndLine.value='2';
  ui.elements.joinerMode.value='custom';ui.elements.wordSeparator.value='·';
  await ui.elements.wordSeparator.listeners.change();
  const row=ui.elements.preview.children[0].children[0];
  assert.equal(row.children[1].children.map(span=>span.textContent).join(''),'Hello·world');
  assert.equal(Number(ui.elements.rangeStartLine.value),2);assert.equal(Number(ui.elements.rangeEndLine.value),2);
});
