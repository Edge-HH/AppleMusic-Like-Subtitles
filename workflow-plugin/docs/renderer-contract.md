# 歌词样式渲染对接协议 v1

## 范围与接入点

此插件负责歌词来源、选择、解析、时间线定位；另一模块负责 Fusion 样式和实际剪辑创建。
唯一代码接入点是 `workflow-plugin/adapters/renderer.js`，当前为不可用占位实现。
不要将渲染实现置于前端，不向 renderer process 暴露通用 `require`、文件系统或任意 Resolve API。

```js
module.exports = {
  available: true,
  reason: '',
  async render({ job, resolve, project, timeline, info }) {
    // 由完成后的样式模块实现：验证模板、创建新视频轨道、写入歌词。
    // 全部成功后才返回；出现部分写入应抛出明确异常并报告已创建内容。
    return { insertedCount: 1, message: '已创建歌词剪辑' };
  },
};
```

以上只描述接口，不能直接替换占位文件来假报成功。

## job 数据

- `schemaVersion: 1`
- `kind: "amll.resolve.render-job"`
- `document`: 歌词原始时间、文本和来源。
- `placement.startFrame`: Resolve 时间线绝对帧号，不是相对时间线起点的帧数。
- `placement.offsetMs`: UI 偏移；正值延后。不得再次应用 LRC 文件 offset。
- `placement.frameRate`: `{ numerator, denominator }`，例如 30000/1001。
- `placement.timelineId / timelineName`: 生成时的目标时间线。
- `placement.videoTrackPolicy: "new-track"`: 不覆盖用户已有轨道和剪辑。
- `placement.lineFrames[i]`: 对应 `document.lines[i]` 的 `{ startFrame, endFrameExclusive }`，结束帧排他。

**逐字时间仍为歌曲起点相对的毫秒。** 对齐公式：

```text
absoluteWordFrame = placement.startFrame
                  + round((word.startMs + placement.offsetMs) * fps / 1000)
```

如果 Fusion comp 使用相对剪辑帧号，应再减去该剪辑的绝对起点。
不要按字符串逐字分配平均时间。SRT/普通 LRC 应按逐行动画降级，并在接入 UI 中明确说明。

## document 数据

```json
{
  "schemaVersion": 1,
  "source": { "provider": "amll", "format": "ttml", "title": "示例", "authors": ["author"], "id": "原文件名" },
  "metadata": { "musicName": ["示例"] },
  "timing": "word",
  "durationMs": 2000,
  "warnings": [],
  "lines": [{
    "startMs": 1000,
    "endMs": 2000,
    "text": "你好",
    "words": [{ "startMs": 1000, "endMs": 1500, "text": "你" }, { "startMs": 1500, "endMs": 2000, "text": "好" }],
    "translations": [{ "language": "en", "text": "Hello" }],
    "romanization": [],
    "agent": "v1",
    "role": "main"
  }]
}
```

`role` 可以为 `main` 或 `background`，和声作为独立行，允许与主唱时间重叠。
`timing` 可以为 `line` / `word` / `mixed`。每条 `words` 数组可能为空。
文本可能包含换行、引号、反斜线、Emoji 和中日韩字符，写入 Lua/Fusion 时必须正确序列化，不能直接拼进代码执行。
歌词作者、平台来源和文件 ID 必须保留，不能把第三方歌词归为本插件原创。

## 接入验收清单

1. 先检查模板存在、版本、支持的字数／词数上限；超限分段或明确拒绝，禁止静默截断。
2. 确认当前时间线与 job 的目标相同，并使用真实帧率（含 23.976/29.97/59.94）。
3. 创建专用新视频轨道，保留所有已有剪辑，不改工程设置。
4. 对多歌手、翻译、和声、逐行降级给出明确策略。
5. 确认新增片段数量和写入成功后再返回 insertedCount。
6. 部分失败时有回滚策略或具体残留说明，避免用户重试叠加重复剪辑。
7. 在 Studio 19、19.0.2+ 及后续主版本实机验证后，才扩大已验证兼容范围。
