'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const GENERATED_FOLDER = 'AppleMusic样式标题生成';
const TRACK_NAME = 'AppleMusic样式标题';

function values(collection) {
  if (!collection) return [];
  return Array.isArray(collection) ? collection.filter(Boolean) : Object.values(collection).filter(Boolean);
}
function codePointLength(text) { return Array.from(String(text)).length; }
function choosePreset(line) {
  const length = codePointLength(line.text);
  if (length > 256) throw new Error(`第 ${line._rangeLine || '?'} 行有 ${length} 个 Unicode 码点，超过单行 256 字符限制，请先拆行`);
  return 'AppleMusic样式标题';
}function seconds(ms) { return (Math.max(0, ms) / 1000).toFixed(3).replace(/\.?0+$/, ''); }
function buildAmInputs(line, fps) {
  const durationMs = line.endMs - line.startMs;
  let segments;
  let timings;
  if (line.words.length) {
    if (line.words.some(word => word.text.includes('|'))) throw new Error(`第 ${line._rangeLine || '?'} 行含有“|”，无法安全写入 AppleMusic样式标题 分段语法`);
    segments = line.words.map(word => word.text);
    timings = line.words.map(word => `${seconds(word.startMs - line.startMs)}-${seconds(word.endMs - line.startMs)}`);
  } else {
    if (line.text.includes('|')) throw new Error(`第 ${line._rangeLine || '?'} 行含有“|”，无法安全写入 AppleMusic样式标题 分段语法`);
    // 逐行来源只创建一个整体段，避免伪造逐字时间。
    segments = [line.text];
    timings = [`0-${seconds(durationMs)}`];
  }
  return { Lyrics: segments.join('|'), Timings: timings.join('|'), Duration: durationMs / 1000, Offset: 0, FPS: fps, ...(line.role === 'background' ? { BackgroundVocal: 1 } : {}) };
}
function assignTrackLanes(frames) {
  const laneEnds = [];
  return frames.map(frame => {
    let lane = laneEnds.findIndex(end => end <= frame.startFrame);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(frame.endFrameExclusive); }
    else laneEnds[lane] = frame.endFrameExclusive;
    return lane;
  });
}
async function folderName(folder) {
  if (!folder) return '';
  if (typeof folder.GetName === 'function') return String(await folder.GetName());
  return '';
}
async function folderClips(folder) {
  if (typeof folder.GetClipList === 'function') return values(await folder.GetClipList());
  if (typeof folder.GetClips === 'function') return values(await folder.GetClips());
  return [];
}
async function subFolders(folder) {
  if (typeof folder.GetSubFolderList === 'function') return values(await folder.GetSubFolderList());
  if (typeof folder.GetSubFolders === 'function') return values(await folder.GetSubFolders());
  return [];
}
async function clipProperties(clip) {
  try { return await clip.GetClipProperty() || {}; } catch { return {}; }
}
async function scanFusionItems(folder, pathParts = [], out = []) {
  const name = await folderName(folder);
  const nextPath = name ? [...pathParts, name] : pathParts;
  if (name !== GENERATED_FOLDER) {
    for (const clip of await folderClips(folder)) {
      const properties = await clipProperties(clip);
      const type = String(properties.Type || properties['Clip Type'] || '');
      if (!/fusion/i.test(type)) continue;
      const id = String(await clip.GetUniqueId());
      const clipName = String(await clip.GetName());
      out.push({ id, key: `media:${id}`, name: clipName, type, path: nextPath.join(' / ') });
    }
    for (const child of await subFolders(folder)) await scanFusionItems(child, nextPath, out);
  }
  return out;
}
async function findMediaItem(folder, id) {
  for (const clip of await folderClips(folder)) if (String(await clip.GetUniqueId()) === id) return clip;
  for (const child of await subFolders(folder)) {
    const found = await findMediaItem(child, id);
    if (found) return found;
  }
  return null;
}
async function getOrCreateGeneratedFolder(mediaPool) {
  const root = await mediaPool.GetRootFolder();
  for (const folder of await subFolders(root)) if (await folderName(folder) === GENERATED_FOLDER) return folder;
  const created = await mediaPool.AddSubFolder(root, GENERATED_FOLDER);
  if (!created) throw new Error(`无法在媒体池创建“${GENERATED_FOLDER}”文件夹`);
  return created;
}
async function compForItem(item) {
  const count = Number(await item.GetFusionCompCount());
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return item.GetFusionCompByIndex(1);
}
async function setToolInputs(tool, inputs) {
  for (const [name, value] of Object.entries(inputs)) await tool.SetInput(name, value);
}
async function configureAmTitle(item, line, fps) {
  const comp = await compForItem(item);
  if (!comp) throw new Error('AppleMusic样式标题 标题没有可编辑的 Fusion 合成');
  const macro = await comp.FindTool('AppleMusicStyleTitle');
  if (!macro) throw new Error('所选 AppleMusic样式标题 预设缺少 AppleMusicStyleTitle 控制器，请重新安装当前仓库生成的标题预设');
  await setToolInputs(macro, buildAmInputs(line, fps));
}
async function toolAttrs(tool) {
  try { return await tool.GetAttrs() || {}; } catch { return {}; }
}
async function configureGenericTitle(item, line) {
  const comp = await compForItem(item);
  if (!comp) throw new Error('所选媒体池 Fusion 项目没有可编辑合成，不能作为逐行标题模板');
  const tools = values(await comp.GetToolList());
  const candidates = [];
  for (const tool of tools) {
    const attrs = await toolAttrs(tool);
    if (attrs.TOOLS_RegID === 'TextPlus') candidates.push({ tool, name: String(attrs.TOOLS_Name || '') });
  }
  candidates.sort((a, b) => Number(/controller|title|text/i.test(b.name)) - Number(/controller|title|text/i.test(a.name)));
  for (const { tool } of candidates) {
    try {
      const current = await tool.GetInput('StyledText');
      if (current === undefined || current === null) continue;
      await tool.SetInput('StyledText', line.text);
      const updated = await tool.GetInput('StyledText');
      if (String(updated) === line.text) return;
    } catch { /* 不是可写文字节点，继续寻找。 */ }
  }
  throw new Error('所选媒体池 Fusion 标题中没有找到可写的 Text+ StyledText 输入');
}
async function createTitleSeed({ mediaPool, scratch, titleSource, customSource, durationFrames, templatePath }) {
  let sourceItem;
  if (titleSource.startsWith('am-')) {
    if (!await scratch.SetMarkInOut(0, durationFrames - 1, 'video')) throw new Error('无法设置标题源长度');
    sourceItem = await scratch.InsertFusionTitleIntoTimeline('AppleMusic样式标题');
  } else {
    sourceItem = values(await mediaPool.AppendToTimeline([{ mediaPoolItem: customSource, startFrame: 0, endFrame: durationFrames,
      mediaType: 1, trackIndex: 1, recordFrame: await scratch.GetStartFrame() }]))[0];
  }
  if (!sourceItem || !await sourceItem.ExportFusionComp(templatePath, 1)) throw new Error('无法导出现有标题节点');
  if (!titleSource.startsWith('am-')) return customSource;
  const comp = await compForItem(sourceItem);
  const macro = comp && await comp.FindTool('AppleMusicStyleTitle');
  if (!macro) throw new Error('标题缺少 AppleMusicStyleTitle 控制器');
  await macro.SetInput('Lyrics', '');
  const carrier = await scratch.CreateFusionClip([sourceItem]);
  const seed = carrier && await carrier.GetMediaPoolItem();
  if (!seed) throw new Error('无法建立可复用的 Fusion 定位源');
  await seed.SetClipProperty('Clip Name', 'AppleMusic样式标题定位源（共享，不含歌词）');
  return seed;
}
async function installTitleGraph(item, templatePath, line, fps, builtIn) {
  const previous = values(await item.GetFusionCompNameList());
  if (!await item.ImportFusionComp(templatePath)) throw new Error('无法直接写入标题节点');
  const added = values(await item.GetFusionCompNameList()).filter(name => !previous.includes(name));
  if (added.length !== 1 || !await item.LoadFusionCompByName(added[0])) throw new Error('无法激活标题合成');
  for (const name of previous) if (!await item.DeleteFusionCompByName(name)) throw new Error('无法清除旧包装合成');
  if (builtIn) await configureAmTitle(item, line, fps);
  else await configureGenericTitle(item, line);
  await item.SetName(line.text.slice(0, 80) || 'AppleMusic样式标题');
}
async function timelineIdentity(timeline) {
  const name = String(await timeline.GetName());
  const id = typeof timeline.GetUniqueId === 'function' ? String(await timeline.GetUniqueId()) : name;
  return { id, name };
}
async function deleteEmptyCreatedTracks(timeline, indexes) {
  for (const index of [...indexes].sort((a, b) => b - a)) {
    const items = values(await timeline.GetItemListInTrack('video', index));
    if (!items.length) await timeline.DeleteTrack('video', index);
  }
}

module.exports = {
  available: true,
  reason: '',
  async listTitles({ project }) {
    const mediaPool = await project.GetMediaPool();
    const root = await mediaPool.GetRootFolder();
    return {
      builtIn: [
        { key: 'am-default', name: 'AppleMusic样式标题', timing: 'word' },
      ],
      mediaPool: await scanFusionItems(root),
    };
  },
  async render({ job, project, timeline, onProgress }) {
    if (job?.schemaVersion !== 2 || job?.kind !== 'amll.resolve.render-job') throw new Error('渲染任务版本不受支持，请重新生成任务');
    const lines = job.document?.lines, frames = job.placement?.lineFrames;
    if (!lines?.length || lines.length !== frames?.length) throw new Error('歌词任务行数与帧区间不一致');
    const identity = await timelineIdentity(timeline);
    if (identity.id !== String(job.placement.timelineId)) throw new Error('当前时间线已变化，请刷新连接后重新导入');
    const titleSource = job.render.titleSource, builtIn = titleSource.startsWith('am-');
    const fps = job.placement.frameRate.numerator / job.placement.frameRate.denominator;
    const durations = frames.map((frame, i) => {
      if (!Number.isSafeInteger(frame.startFrame) || !Number.isSafeInteger(frame.endFrameExclusive) || frame.endFrameExclusive <= frame.startFrame) throw new Error(`第 ${i + 1} 行帧区间无效`);
      if (builtIn) { choosePreset(lines[i]); buildAmInputs(lines[i], fps); }
      return frame.endFrameExclusive - frame.startFrame;
    });
    const report = (stage, completed = 0) => { try { onProgress?.({ stage, completed, total: lines.length }); } catch { /* UI closure must not cancel a write. */ } };
    const mediaPool = await project.GetMediaPool(), originalFolder = await mediaPool.GetCurrentFolder();
    let customSource = null;
    if (!builtIn) {
      customSource = await findMediaItem(await mediaPool.GetRootFolder(), titleSource.slice(6));
      if (!customSource) throw new Error('所选媒体池 Fusion 标题已移动或删除，请刷新标题列表');
    }
    const lanes = assignTrackLanes(frames), laneCount = Math.max(...lanes) + 1;
    const inserted = [], createdTracks = [];
    let scratch = null, seed = null, finalItem = null;
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'amll-title-'));
    const templatePath = path.join(temporary, 'AppleMusic样式标题.comp');
    try {
      report('正在准备可复用标题源');
      await mediaPool.SetCurrentFolder(await getOrCreateGeneratedFolder(mediaPool));
      scratch = await mediaPool.CreateEmptyTimeline(`AppleMusic样式标题 临时 ${Date.now()}`);
      if (!scratch || !await project.SetCurrentTimeline(scratch)) throw new Error('无法创建歌词准备时间线');
      seed = await createTitleSeed({ mediaPool, scratch, titleSource, customSource, durationFrames: Math.max(...durations) + 1, templatePath });
      if (!await project.SetCurrentTimeline(timeline)) throw new Error('无法切回原时间线');
      const oldTrackCount = Number(await timeline.GetTrackCount('video'));
      for (let lane = 0; lane < laneCount; lane++) {
        if (!await timeline.AddTrack('video')) throw new Error('无法创建新的顶部视频轨道');
        const index = oldTrackCount + lane + 1; createdTracks.push(index);
        await timeline.SetTrackName('video', index, laneCount === 1 ? TRACK_NAME : `${TRACK_NAME} ${lane + 1}`);
      }
      report('正在批量放置时间线片段');
      inserted.push(...values(await mediaPool.AppendToTimeline(frames.map((frame, i) => ({ mediaPoolItem: seed,
        startFrame: 0, endFrame: durations[i], mediaType: 1, trackIndex: oldTrackCount + lanes[i] + 1, recordFrame: frame.startFrame })))));
      if (inserted.length !== lines.length) throw new Error(`只创建了 ${inserted.length}/${lines.length} 个歌词片段`);
      for (let i = 0; i < inserted.length; i++) {
        if (Number(await inserted[i].GetDuration()) !== durations[i] || Number(await inserted[i].GetStart()) !== frames[i].startFrame) throw new Error(`第 ${i + 1} 行位置或长度写入异常`);
        await installTitleGraph(inserted[i], templatePath, { ...lines[i], _rangeLine: i + 1 }, fps, builtIn);
        report('正在写入顶层 Fusion 文字', i + 1);
      }
      if (job.render.placementMode === 'fusion-clip') {
        report('正在创建唯一的外层复合片段', lines.length);
        finalItem = await timeline.CreateCompoundClip(inserted, { name: `AMLL ${job.document.source?.title || '歌词'}` });
        if (!finalItem) throw new Error('无法创建汇总复合片段');
        await deleteEmptyCreatedTracks(timeline, createdTracks);
      }
      report('文字写入完成，正在整理', lines.length);
      return { insertedCount: finalItem ? 1 : inserted.length, sourceLineCount: lines.length, createdTrackCount: finalItem ? 1 : laneCount,
        structure: finalItem ? 'compound' : 'top-level-fusion', timing: builtIn ? job.document.timing : 'line',
        message: builtIn ? '每句文字均位于自身 Fusion 合成顶层，无逐句歌词嵌套。' : '已使用媒体池标题逐行导入，文字位于各片段顶层。' };
    } catch (error) {
      try { await project.SetCurrentTimeline(timeline); } catch { /* Preserve original failure. */ }
      try { if (finalItem) await timeline.DeleteClips([finalItem], false); else if (inserted.length) await timeline.DeleteClips(inserted, false); } catch { /* Best-effort rollback of new items only. */ }
      try { await deleteEmptyCreatedTracks(timeline, createdTracks); } catch { /* Do not touch existing tracks. */ }
      try { if (seed && builtIn) await mediaPool.DeleteClips([seed]); } catch { /* Never delete a user's custom template. */ }
      throw new Error(`${error.message}；已尝试回滚本次新增片段，请检查 AppleMusic样式标题轨道`);
    } finally {
      try { await project.SetCurrentTimeline(timeline); if (scratch) await mediaPool.DeleteTimelines([scratch]); await mediaPool.SetCurrentFolder(originalFolder); } catch { /* Cleanup must not replace the write result. */ }
      const resolved = path.resolve(temporary);
      if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('amll-title-')) {
        try { await fs.rm(resolved, { recursive: true, force: true }); } catch { /* A cleanup failure is not an import failure. */ }
      }
    }
  },
  __test: { values, choosePreset, buildAmInputs, assignTrackLanes },
};
