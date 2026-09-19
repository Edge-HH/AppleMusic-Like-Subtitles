'use strict';

const GENERATED_FOLDER = 'AMLL 歌词生成';
const TRACK_NAME = 'AMLL 歌词';

function values(collection) {
  if (!collection) return [];
  return Array.isArray(collection) ? collection.filter(Boolean) : Object.values(collection).filter(Boolean);
}
function codePointLength(text) { return Array.from(String(text)).length; }
function choosePreset(line) {
  const length = codePointLength(line.text);
  if (length > 256) throw new Error(`第 ${line._rangeLine || '?'} 行有 ${length} 个 Unicode 码点，超过单行 256 字符限制，请先拆行`);
  return 'AM Lyrics';
}function seconds(ms) { return (Math.max(0, ms) / 1000).toFixed(3).replace(/\.?0+$/, ''); }
function buildAmInputs(line, fps) {
  const durationMs = line.endMs - line.startMs;
  let segments;
  let timings;
  if (line.words.length) {
    if (line.words.some(word => word.text.includes('|'))) throw new Error(`第 ${line._rangeLine || '?'} 行含有“|”，无法安全写入 AM Lyrics 分段语法`);
    segments = line.words.map(word => word.text);
    timings = line.words.map(word => `${seconds(word.startMs - line.startMs)}-${seconds(word.endMs - line.startMs)}`);
  } else {
    if (line.text.includes('|')) throw new Error(`第 ${line._rangeLine || '?'} 行含有“|”，无法安全写入 AM Lyrics 分段语法`);
    // 逐行来源只创建一个整体段，避免伪造逐字时间。
    segments = [line.text];
    timings = [`0-${seconds(durationMs)}`];
  }
  return { Lyrics: segments.join('|'), Timings: timings.join('|'), Duration: durationMs / 1000, Offset: 0, FPS: fps };
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
  if (!comp) throw new Error('AM Lyrics 标题没有可编辑的 Fusion 合成');
  const macro = await comp.FindTool('AMLLyrics');
  if (!macro) throw new Error('所选 AM Lyrics 预设缺少 AMLLyrics 控制器，请重新安装当前仓库生成的标题预设');
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
async function clearScratchItem(timeline, item) {
  if (item) await timeline.DeleteClips([item], false);
  await timeline.ClearMarkInOut('video');
}
async function createLineMedia({ mediaPool, scratch, line, frame, titleSource, customSource, fps, index }) {
  const durationFrames = frame.endFrameExclusive - frame.startFrame;
  let sourceItem = null;
  if (titleSource.startsWith('am-')) {
    const preset = choosePreset({ ...line, _rangeLine: index + 1 });
    await scratch.SetCurrentTimecode(await scratch.GetStartTimecode());
    if (!await scratch.SetMarkInOut(0, durationFrames - 1, 'video')) throw new Error('无法设置临时时间线的标题长度');
    sourceItem = await scratch.InsertFusionTitleIntoTimeline(preset);
    if (!sourceItem) throw new Error(`找不到 Fusion 标题“${preset}”，请先安装仓库生成的标题预设`);
    await configureAmTitle(sourceItem, { ...line, _rangeLine: index + 1 }, fps);
  } else {
    const appended = values(await mediaPool.AppendToTimeline([{
      mediaPoolItem: customSource,
      startFrame: 0,
      endFrame: durationFrames,
      mediaType: 1,
      trackIndex: 1,
      recordFrame: await scratch.GetStartFrame(),
    }]));
    sourceItem = appended[0];
    if (!sourceItem || Number(await sourceItem.GetDuration()) < durationFrames) throw new Error(`所选媒体池 Fusion 标题不足以覆盖第 ${index + 1} 行的时长`);
    await configureGenericTitle(sourceItem, line);
  }
  const fusionItem = await scratch.CreateFusionClip([sourceItem]);
  if (!fusionItem) throw new Error(`无法为第 ${index + 1} 行创建 Fusion 片段`);
  const mediaItem = await fusionItem.GetMediaPoolItem();
  if (!mediaItem) throw new Error(`第 ${index + 1} 行的 Fusion 片段没有生成媒体池项目`);
  const shortText = line.text.replace(/\s+/g, ' ').slice(0, 36) || `第 ${index + 1} 行`;
  try { await mediaItem.SetClipProperty('Clip Name', `${String(index + 1).padStart(3, '0')} ${shortText}`); } catch { /* 命名失败不影响内容。 */ }
  await clearScratchItem(scratch, fusionItem);
  return mediaItem;
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
        { key: 'am-default', name: 'AM Lyrics', timing: 'word' },
      ],
      mediaPool: await scanFusionItems(root),
    };
  },
  async render({ job, project, timeline }) {
    if (job?.schemaVersion !== 2 || job?.kind !== 'amll.resolve.render-job') throw new Error('渲染任务版本不受支持，请重新生成任务');
    if (!job.document?.lines?.length || job.document.lines.length !== job.placement?.lineFrames?.length) throw new Error('歌词任务行数与帧区间不一致');
    const identity = await timelineIdentity(timeline);
    if (identity.id !== String(job.placement.timelineId)) throw new Error('当前时间线已变化，请刷新连接后重新导入');
    const mediaPool = await project.GetMediaPool();
    const originalFolder = await mediaPool.GetCurrentFolder();
    const generatedFolder = await getOrCreateGeneratedFolder(mediaPool);
    const titleSource = job.render.titleSource;
    let customSource = null;
    if (titleSource.startsWith('media:')) {
      customSource = await findMediaItem(await mediaPool.GetRootFolder(), titleSource.slice(6));
      if (!customSource) throw new Error('所选媒体池 Fusion 标题已移动或删除，请刷新标题列表');
    }
    const fps = job.placement.frameRate.numerator / job.placement.frameRate.denominator;
    const lanes = assignTrackLanes(job.placement.lineFrames);
    const laneCount = Math.max(...lanes) + 1;
    const inserted = [];
    const generatedMedia = [];
    const createdTracks = [];
    let scratch = null, finalItem = null;
    try {
      await mediaPool.SetCurrentFolder(generatedFolder);
      scratch = await mediaPool.CreateEmptyTimeline(`AMLL 临时 ${Date.now()}`);
      if (!scratch) throw new Error('无法创建歌词临时时间线');
      await project.SetCurrentTimeline(scratch);
      for (let i = 0; i < job.document.lines.length; i++) {
        generatedMedia.push(await createLineMedia({ mediaPool, scratch, line: job.document.lines[i], frame: job.placement.lineFrames[i], titleSource, customSource, fps, index: i }));
      }
      await project.SetCurrentTimeline(timeline);
      const oldTrackCount = Number(await timeline.GetTrackCount('video'));
      for (let lane = 0; lane < laneCount; lane++) {
        if (!await timeline.AddTrack('video')) throw new Error('无法创建新的顶部视频轨道');
        const index = oldTrackCount + lane + 1;
        createdTracks.push(index);
        await timeline.SetTrackName('video', index, laneCount === 1 ? TRACK_NAME : `${TRACK_NAME} ${lane + 1}`);
      }
      const clipInfos = generatedMedia.map((mediaPoolItem, i) => ({
        mediaPoolItem,
        startFrame: 0,
        endFrame: job.placement.lineFrames[i].endFrameExclusive - job.placement.lineFrames[i].startFrame,
        mediaType: 1,
        trackIndex: oldTrackCount + lanes[i] + 1,
        recordFrame: job.placement.lineFrames[i].startFrame,
      }));
      inserted.push(...values(await mediaPool.AppendToTimeline(clipInfos)));
      if (inserted.length !== clipInfos.length) throw new Error(`只创建了 ${inserted.length}/${clipInfos.length} 个歌词片段`);
      for (let i = 0; i < inserted.length; i++) {
        const expected = clipInfos[i].endFrame;
        const actual = Number(await inserted[i].GetDuration());
        if (actual !== expected) throw new Error(`第 ${i + 1} 行长度写入异常：期望 ${expected} 帧，实际 ${actual} 帧`);
      }
      if (job.render.placementMode === 'fusion-clip') {
        finalItem = await timeline.CreateFusionClip(inserted);
        if (!finalItem) throw new Error('歌词已散落写入，但创建汇总 Fusion 片段失败');
        await finalItem.SetName(`AMLL ${job.document.source?.title || '歌词'}`);
        await deleteEmptyCreatedTracks(timeline, createdTracks);
      }
      if (scratch) {
        await project.SetCurrentTimeline(timeline);
        await mediaPool.DeleteTimelines([scratch]);
        scratch = null;
      }
      await mediaPool.SetCurrentFolder(originalFolder);
      const degraded = !titleSource.startsWith('am-');
      return {
        insertedCount: finalItem ? 1 : inserted.length,
        sourceLineCount: inserted.length,
        createdTrackCount: finalItem ? 1 : laneCount,
        timing: degraded ? 'line' : job.document.timing,
        message: degraded ? '已使用媒体池 Fusion 标题按逐行方式导入；不会伪造逐字动画。' : `已写入 ${inserted.length} 行歌词。`,
      };
    } catch (error) {
      try { await project.SetCurrentTimeline(timeline); } catch { /* 保留原错误。 */ }
      try { if (finalItem) await timeline.DeleteClips([finalItem], false); else if (inserted.length) await timeline.DeleteClips(inserted, false); } catch { /* 回滚尽力而为。 */ }
      try { await deleteEmptyCreatedTracks(timeline, createdTracks); } catch { /* 回滚尽力而为。 */ }
      try { if (scratch) await mediaPool.DeleteTimelines([scratch]); } catch { /* 回滚尽力而为。 */ }
      try { if (generatedMedia.length) await mediaPool.DeleteClips(generatedMedia); } catch { /* 回滚尽力而为。 */ }
      try { await mediaPool.SetCurrentFolder(originalFolder); } catch { /* 保留原错误。 */ }
      throw new Error(`${error.message}${inserted.length ? `；已尝试回滚 ${inserted.length} 个已写入片段，请检查“${TRACK_NAME}”轨道` : ''}`);
    }
  },
  __test: { values, choosePreset, buildAmInputs, assignTrackLanes },
};
