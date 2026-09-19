'use strict';
const { frameRate } = require('./job');
class ResolveHost {
  constructor(loadNative) { this.loadNative = loadNative; this.native = null; this.resolve = null; }
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
module.exports = { ResolveHost };
