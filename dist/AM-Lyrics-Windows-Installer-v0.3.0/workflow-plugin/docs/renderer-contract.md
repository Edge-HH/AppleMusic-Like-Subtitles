# 歌词时间线渲染协议 v2

## 接入边界

插件主进程负责歌词选择、范围裁剪、时间线定位与安全校验；`adapters/renderer.js` 是唯一 Resolve 写入适配层。前端只能通过白名单 IPC 调用，不暴露通用 `require`、文件系统或任意 Resolve API。

适配层提供：

```js
{
  available: true,
  async listTitles({ project }) {},
  async render({ job, project, timeline }) {}
}
```

`listTitles` 返回内置 AM Lyrics 预设和媒体池中可选的 Fusion 项目。`render` 必须在全部验证和写入完成后返回正整数 `insertedCount`；部分失败需尽力回滚并明确说明残留位置。

## job v2

- `schemaVersion: 2`
- `kind: "amll.resolve.render-job"`
- `document`: 已裁剪到用户选择范围的歌词文档，第一行起点被重新归零；原始范围记录在 `document.source.range`。
- `render.placementMode`: `scattered` 或 `fusion-clip`。
- `render.titleSource`: `am-default` 或 `media:<MediaPoolItem unique id>`。
- `placement.startFrame`: Resolve 时间线绝对帧号。
- `placement.offsetMs`: UI 偏移，正值延后；不得再次应用歌词文件自身 offset。
- `placement.frameRate`: `{ numerator, denominator }`。
- `placement.timelineId / timelineName`: 生成任务时的目标时间线。
- `placement.videoTrackPolicy: "new-top-track"`。
- `placement.lineFrames[i]`: 对应裁剪后 `document.lines[i]` 的 `{ startFrame, endFrameExclusive }`。

范围对齐公式：

```text
rangedLineMs = originalLineMs - selectedFirstLine.startMs
absoluteLineFrame = placement.startFrame
                  + round((rangedLineMs + placement.offsetMs) * fps / 1000)
```

逐字时间也减去同一个范围起点，再在每句写入标题时减去该句起点，得到 Fusion 片段内相对秒数。不得按字符串平均分配时间。

## AM Lyrics 写入

- 使用单一 `AM Lyrics` 标题；单句超过 256 个 Unicode 码点时在时间线写入前报错。
- `Lyrics` 使用真实 `words[].text` 以 `|` 连接。
- `Timings` 使用 `word.startMs/endMs - line.startMs`，单位为秒。
- `Offset=0`，因为时间线位置已经包含全局偏移。
- `FPS` 写入真实时间线帧率。
- 无逐字数据的行只写一个整行段和一个整行区间，不伪造逐字。

## 媒体池 Fusion 标题

扫描媒体池中 `GetClipProperty().Type` 包含 `Fusion` 的项目，并排除插件自己的 `AMLL 歌词生成` 文件夹。导入时复制到临时时间线，查找可写 Text+ `StyledText` 并写入整行歌词。此路径始终报告 `timing: "line"`。

如果项目不能产生可编辑 Fusion comp，或没有可写 Text+，必须停止并返回明确错误；不能假报成功，也不能静默改用 AM Lyrics。

## 时间线事务

1. 核对当前时间线唯一 ID 与 job 一致。
2. 在 `AMLL 歌词生成` 媒体池文件夹创建临时时间线。
3. 为每句创建指定长度的标题实例，写入参数，再转换为独立 Fusion 源。
4. 根据半开区间重叠关系分配轨道 lane；追加足够数量的顶部视频轨道。
5. 使用 `MediaPool.AppendToTimeline` 的 `trackIndex`、`recordFrame`、`startFrame`、`endFrame` 精确写入。
6. `fusion-clip` 模式调用 `Timeline.CreateFusionClip` 合并本次生成的项目，并删除空中间轨道。
7. 删除临时时间线并恢复用户原媒体池文件夹。

失败时尽力删除目标片段、空轨道、临时时间线和未完成媒体项。成功导入后的独立 Fusion 源必须保留在媒体池，否则时间线引用可能离线。

## 验收清单

1. 选择范围后第一行准确落在锚点加偏移位置。
2. 23.976／29.97／59.94 使用有理帧率与正确丢帧时间码。
3. 逐字来源保留真实 token 时间，逐行来源没有伪造 token。
4. 现有轨道和剪辑不被覆盖或波纹移动。
5. 重叠行使用额外顶部轨道；不重叠行复用轨道。
6. 散落和单 Fusion 片段两种模式都核对片段数量、起止帧与长度。
7. 自定义媒体池标题明确报告逐行降级和不兼容结构。
8. Studio 19、19.0.2 与后续版本分别实机验证后再扩大兼容声明。
