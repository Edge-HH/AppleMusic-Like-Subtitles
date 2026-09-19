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
    const id = typeof timeline.GetUniqueId === 'function' ? await timeline.GetUniqueId() : name;
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
  request(action, args = {}) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ action, args });
      const request = http.request({
        hostname: '127.0.0.1',
        port: this.port,
        path: '/rpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-AMLL-Token': this.token },
        timeout: 120000,
      }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => {
          let payload;
          try { payload = JSON.parse(text || '{}'); } catch { reject(new Error(`脚本宿主返回了无效响应（HTTP ${response.statusCode}）`)); return; }
          if (response.statusCode !== 200 || !payload.ok) reject(new Error(payload.error || `脚本宿主请求失败（HTTP ${response.statusCode}）`));
          else resolve(payload.data);
        });
      });
      request.on('timeout', () => request.destroy(new Error('脚本宿主响应超时')));
      request.on('error', reject);
      request.end(body);
    });
  }
  async context() { return this.request('context'); }
  async titleSources() { return this.request('titleSources'); }
  async render(job) { return this.request('render', { job }); }
  cleanup() { /* Python 脚本宿主随 Resolve 脚本进程退出。 */ }
}

function createResolveHost(loadNative) {
  const port = argValue('--amll-script-host-port', 'AMLL_SCRIPT_HOST_PORT');
  const token = argValue('--amll-script-host-token', 'AMLL_SCRIPT_HOST_TOKEN');
  if (port && token) return new ScriptResolveHost(port, token);
  return new ResolveHost(loadNative);
}

module.exports = { ResolveHost, ScriptResolveHost, createResolveHost };
