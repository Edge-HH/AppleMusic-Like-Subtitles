'use strict';

const http = require('node:http');
const { frameRate } = require('./job');

function argValue(name, environmentName) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : (process.env[environmentName] || '');
}

class ResolveHost {
  constructor(loadNative) { this.loadNative = loadNative; this.native = null; this.resolve = null; this.remote = false; }
  async connect() {
    if (this.resolve) return this.resolve;
    const native = this.loadNative();
    this.native = native;
    if (!await native.Initialize('com.edgehh.amll.lyrics')) throw new Error('达芬奇接口初始化失败，请从 Studio 的工作区 → 工作流程集成启动插件');
    const resolve = await native.GetResolve();
    if (!resolve) throw new Error('未连接到 DaVinci Resolve Studio');
    const version = await resolve.GetVersion();
    if (!version || Number(version[0]) < 19) throw new Error('需要 DaVinci Resolve Studio 19 或更新版本');
    this.resolve = resolve;
    return resolve;
  }
  async context() {
    const resolve = await this.connect();
    const manager = await resolve.GetProjectManager();
    const project = manager && await manager.GetCurrentProject();
    if (!project) throw new Error('请先打开达芬奇项目');
    const timeline = await project.GetCurrentTimeline();
    if (!timeline) throw new Error('请先创建或打开一条时间线');
    const name = await timeline.GetName();
    const id = (typeof timeline.GetUniqueId === 'function' ? await timeline.GetUniqueId() : null) || name;
    const rate = await timeline.GetSetting('timelineFrameRate');
    return { resolve, project, timeline, info: { id, name, frameRate: frameRate(rate), startFrame: Number(await timeline.GetStartFrame()), currentTimecode: await timeline.GetCurrentTimecode() } };
  }
  cleanup() { if (this.native) { try { this.native.CleanUp(); } catch { /* 退出时宿主可能已经结束。 */ } } }
}

class ScriptResolveHost {
  constructor(port, token) {
    this.port = Number(port);
    this.token = token;
    this.remote = true;
  }
  request(action, args = {}, onProgress) {
    const writing = action === 'render';
    return new Promise((resolve, reject) => {
      let settled = false, lastProgress = {};
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      const unknown = () => new Error('导入连接中断，结果不确定，任务可能仍在执行；请先检查时间线，勿重复导入');
      const notify = value => {
        lastProgress = { ...lastProgress, ...value };
        try { onProgress?.(lastProgress); } catch { /* UI closure must not cancel a native write. */ }
      };
      const consume = (payload, statusCode) => {
        if (payload?.type === 'progress') { notify(payload.data || {}); return; }
        if (payload?.type === 'heartbeat') { notify({ elapsedSeconds: payload.elapsedSeconds }); return; }
        if (typeof payload?.ok !== 'boolean') { fail(writing ? unknown() : new Error('脚本宿主响应格式无效')); return; }
        if (statusCode !== 200 || !payload.ok) { fail(new Error(payload.error || `脚本宿主请求失败（HTTP ${statusCode}）`)); return; }
        if (!settled) { settled = true; resolve(payload.data); }
      };
      const body = JSON.stringify({ action, args });
      const request = http.request({
        hostname: '127.0.0.1', port: this.port, path: '/rpc', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-AMLL-Token': this.token },
        // A native write cannot be cancelled by closing its HTTP socket. Never turn
        // a long successful import into a false timeout or automatically retry it.
        timeout: writing ? 0 : 120000,
      }, response => {
        let text = '';
        const streaming = String(response.headers['content-type'] || '').includes('application/x-ndjson');
        response.setEncoding('utf8');
        const parse = line => {
          try { consume(JSON.parse(line), response.statusCode); }
          catch { fail(writing ? unknown() : new Error(`脚本宿主返回了无效响应（HTTP ${response.statusCode}）`)); }
        };
        response.on('data', chunk => {
          text += chunk;
          if (text.length > 32 * 1024 * 1024) { fail(writing ? unknown() : new Error('脚本宿主响应过大')); response.destroy(); return; }
          if (streaming) {
            let end;
            while ((end = text.indexOf('\n')) >= 0) {
              const line = text.slice(0, end).trim(); text = text.slice(end + 1);
              if (line) parse(line);
            }
          }
        });
        response.on('end', () => {
          if (text.trim()) parse(text);
          if (!settled) fail(writing ? unknown() : new Error('脚本宿主没有返回结果'));
        });
        response.on('aborted', () => fail(writing ? unknown() : new Error('脚本宿主响应中断')));
        response.on('error', error => fail(writing ? unknown() : error));
      });
      request.on('timeout', () => request.destroy(new Error('脚本宿主响应超时')));
      request.on('error', error => fail(writing ? unknown() : error));
      request.end(body);
    });
  }
  async context() {
    // Python RPC sends only serializable metadata. Callers share the native host's
    // { info } contract, but remote mode cannot expose native project/tool handles.
    const info = await this.request('context');
    const rate = info?.frameRate;
    if (!info || typeof info.name !== 'string' || !info.name.trim()
      || typeof info.id !== 'string' || !info.id
      || typeof info.currentTimecode !== 'string' || !info.currentTimecode
      || !Number.isSafeInteger(info.startFrame)
      || !Number.isFinite(rate?.numerator) || rate.numerator <= 0
      || !Number.isFinite(rate?.denominator) || rate.denominator <= 0) {
      throw new Error('脚本宿主返回的时间线信息无效或不完整，请打开有效时间线后刷新连接');
    }
    return { info };
  }
  async titleSources() { return this.request('titleSources'); }
  async render(job, onProgress) { return this.request('render', { job }, onProgress); }
  cleanup() { /* Python 脚本宿主随 Resolve 脚本进程退出。 */ }
}

function createResolveHost(loadNative) {
  const port = argValue('--amll-script-host-port', 'AMLL_SCRIPT_HOST_PORT');
  const token = argValue('--amll-script-host-token', 'AMLL_SCRIPT_HOST_TOKEN');
  if (port && token) return new ScriptResolveHost(port, token);
  return new ResolveHost(loadNative);
}

module.exports = { ResolveHost, ScriptResolveHost, createResolveHost };
