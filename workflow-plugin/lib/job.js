'use strict';
const { validateDocument } = require('./lyrics');

function frameRate(value) {
  const fps = Number.parseFloat(value);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new Error('无法读取有效的时间线帧率');
  const fractional = [[23.976, 24000], [29.97, 30000], [47.952, 48000], [59.94, 60000], [119.88, 120000]];
  const match = fractional.find(([rounded]) => Math.abs(rounded - fps) < 0.002);
  return match ? { numerator: match[1], denominator: 1001 } : { numerator: fps, denominator: 1 };
}
function timecodeFrame(tc, rate) {
  const match = String(tc).match(/^(\d{2,}):(\d{2}):(\d{2})([:;])(\d{2,3})$/);
  const fps = rate.numerator / rate.denominator;
  const nominal = Math.round(fps);
  if (!match || +match[2] >= 60 || +match[3] >= 60 || +match[5] >= nominal) throw new Error(`无法解析播放头时间码：${tc}`);
  const [, h, m, s, delimiter, f] = match;
  let frames = ((+h * 3600 + +m * 60 + +s) * nominal) + +f;
  if (delimiter === ';') {
    if (![30, 60].includes(nominal) || Math.abs(fps - nominal * 1000 / 1001) > 0.002) throw new Error('仅支持 29.97 / 59.94 的丢帧时间码');
    const drop = nominal === 30 ? 2 : 4;
    if (+m % 10 !== 0 && +s === 0 && +f < drop) throw new Error('丢帧时间码使用了被跳过的帧号');
    const minutes = +h * 60 + +m;
    frames -= drop * (minutes - Math.floor(minutes / 10));
  }
  return frames;
}
function makeJob(document, settings, context) {
  validateDocument(document);
  const offsetMs = Number(settings.offsetMs ?? 0);
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > 86400000) throw new Error('歌词偏移必须在正负 24 小时内');
  const rate = context.frameRate;
  if (!rate || !Number.isFinite(rate.numerator) || !Number.isFinite(rate.denominator) || rate.numerator <= 0 || rate.denominator <= 0) throw new Error('无有效帧率');
  const anchor = settings.anchor || 'playhead';
  if (!['playhead', 'timeline-start', 'frame'].includes(anchor)) throw new Error('无效的起点设置');
  const startFrame = anchor === 'playhead' ? timecodeFrame(context.currentTimecode, rate) : anchor === 'timeline-start' ? context.startFrame : Number(settings.startFrame);
  if (!Number.isSafeInteger(startFrame) || startFrame < context.startFrame) throw new Error('插入起点不能早于时间线起点');
  const fps = rate.numerator / rate.denominator;
  const frames = document.lines.map(item => ({
    startFrame: startFrame + Math.round((item.startMs + offsetMs) * fps / 1000),
    endFrameExclusive: startFrame + Math.round((item.endMs + offsetMs) * fps / 1000),
  }));
  if (frames.some(item => item.startFrame < context.startFrame)) throw new Error('偏移后的歌词早于时间线起点，请增大偏移或后移插入点');
  for (const item of frames) item.endFrameExclusive = Math.max(item.startFrame + 1, item.endFrameExclusive);
  return { schemaVersion: 1, kind: 'amll.resolve.render-job', document, placement: { startFrame, offsetMs, frameRate: rate, videoTrackPolicy: 'new-track', timelineName: context.name, timelineId: context.id, lineFrames: frames } };
}
function toSrt(document, offsetMs = 0) {
  const stamp = ms => {
    if (!Number.isFinite(ms) || ms < 0) throw new Error('SRT 时间不能为负数');
    ms = Math.round(ms);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return document.lines.map((item, i) => `${i + 1}\n${stamp(item.startMs + offsetMs)} --> ${stamp(item.endMs + offsetMs)}\n${item.text}\n`).join('\n');
}
module.exports = { frameRate, timecodeFrame, makeJob, toSrt };
