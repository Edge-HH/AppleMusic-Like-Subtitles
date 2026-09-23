# 歌词时间线渲染协议 v2

## 边界

主进程执行选择范围、连接符格式化与帧定位。普通 Scripts 模式由 `script-host.py` 写入 Resolve；Studio Workflow 兼容模式由 `adapters/renderer.js` 写入。前端只通过允许的 IPC 命令操作，不直接调用 SDK。

两种后端都执行“共享定位源 + 独立顶层文字图”的流程，详细结构及原生接口限制见 [direct-import.md](direct-import.md)。

## 数据

```json
{
  "schemaVersion": 2,
  "kind": "amll.resolve.render-job",
  "document": {"lines": []},
  "render": {
    "placementMode": "scattered",
    "titleSource": "am-default",
    "joinerMode": "auto",
    "wordSeparator": ""
  },
  "placement": {
    "startFrame": 86400,
    "offsetMs": 0,
    "frameRate": {"numerator": 24, "denominator": 1},
    "timelineId": "...",
    "timelineName": "...",
    "videoTrackPolicy": "new-top-track",
    "lineFrames": [{"startFrame": 86400, "endFrameExclusive": 86448}]
  }
}
```

- `document` 已范围裁剪、重新归零并完成显示格式化；后端不再重复追加连接符。
- `joinerMode` / `wordSeparator` 保存格式化选项。预览、任务、JSON 和 SRT 共用 `lib/word-joiner.js`。
- 每个 lineFrame 使用包含起点、不包含终点的帧区间。插入后检查 GetStart/GetDuration，不静默接受错误长度。
- `scattered` 返回多句独立 Fusion 文字；`fusion-clip` 为兼容保留的选项值，现创建一个外层 Compound Clip。
- `am-default` 和旧的 am-auto/am-32/am-64 别名使用单一 AppleMusic样式标题；选择媒体池自定义 Fusion 标题时，普通脚本与原生兼容桥接都会降级为逐行写入 Text+，不伪造逐字时间。

## 写入顺序

1. 校验协议、时间线 ID、帧区间和最终文字，未通过不创建轨道。
2. 创建一条准备时间线，只实例化一次已安装的标题；导出标题图。
3. 将定位源文字清空，只创建一次可用于 AppendToTimeline 的 Fusion 源。
4. 回到原时间线，按重叠关系创建顶部新轨道，一次批量定位片段。
5. 每个实例导入同一模板文件为独立合成，激活新合成并删除继承的包装图，再写入本句文字、时间、FPS、和声参数。
6. 合并模式只调用一次 CreateCompoundClip。
7. 清理准备时间线、恢复媒体池文件夹。失败时只尝试回滚本次新增片段和空轨道；共享定位源成功后保留。

标题样式来自已安装模板，插件不改动其动画逻辑。

## 长任务响应

非写入 RPC 仍为单 JSON。render 使用 NDJSON：

```json
{"type":"progress","data":{"stage":"正在写入顶层 Fusion 文字","completed":1,"total":20}}
{"type":"heartbeat","elapsedSeconds":125}
{"ok":true,"data":{"insertedCount":20,"sourceLineCount":20,"createdTrackCount":1,"structure":"top-level-fusion"}}
```

实际一次响应中以上对象各占一行。最终帧也可能是 `ok:false` 与 error；HTTP 200 不代表写入已完成。

无 render 空闲截止时间、不自动重试写请求；丢失最终结果提示任务状态不确定。SDK 调用保持串行，心跳线程不访问 Resolve。
