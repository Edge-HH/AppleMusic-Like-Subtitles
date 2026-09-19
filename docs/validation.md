# 验证记录

日期：2026-09-19。宿主：Windows，DaVinci Resolve **Studio 20.3.2.0009**。

## 已执行

### 源码 / 自动测试

- `python tools/build.py` 生成中文／英文两个单模板 setting 与独立 DRFX。
- `python -m unittest discover -s tests -v`：14 项新版标题测试通过。
- 直接执行 Lua 5.1 分段逻辑，覆盖中文、标点、空格、CRLF、空段、非法时间、重叠时间、空拍、容量边界、整体偏移、非零 RenderStart、常见整数与非整数帧率、平滑过渡单调性。
- 校验所有生成的表达式语法、原生节点连接目标、宏暴露的输入、DRFX 目录与 CRC、源码 / dist 一致性。
- PowerShell 5.1 安装脚本：验证 WhatIf、测试目录首次安装、重复安装前备份和 SHA256 比对。
- **没有用 mock 冒充 Resolve 图像验证。** 自动化 Lua 测试不负责验证字体渲染、Write On 字形索引或 GPU。

### 原生 Resolve 检查与真实导出

在独立的、仅包含合成测试素材的 QA 项目中：

1. 通过 `bmd.readfile` 解析生成的 setting。
2. 从原生 TextPlus 读取参数列表，确认 Start / End 等实际输入。
3. 通过时间线 `ImportFusionComp` 导入生成的节点结构，连接 MediaOut。
4. 通过 **宏公开参数** 修改 Timings / Offset / IdleOpacity / Lyrics / Size。
5. 在 640×360、24 fps 时间线导出 PNG RGBA，检查真实图像。

| 场景 | 结果 |
| --- | --- |
| 单模板默认中文，0 帧 | 整句低亮且有轻微模糊 |
| 单模板默认中文，48 帧 | 前半句亮起，后半句低亮 |
| 单模板默认中文，110 帧 | 整句清晰、高亮 |
| 自定义四段，IdleOpacity=0，0 帧 | 全部透明，RGBA alpha 极值均为 0 |
| 自定义四段，IdleOpacity=0，48 帧 | “我想要”已出现，“留”正在变亮，后文未出现 |
| 自定义四段，110 帧 | 整句出现 |
| 时间数量错误，0 帧 | Status 报错；全句静态显示，不丢词 |
| 英文 Hello + 空格 + world | 中间帧只亮起前词，末帧完整显示 |
| 英文语言包 | 正常导出，与 单模板默认画面一致 |
| 长句缩小字号后末帧 | 正常导出，全句落在画面内 |

真实导出预览（保留透明通道，建议在深色背景观看）：

| 未唱 | 唱到一半 | 唱完 |
| --- | --- | --- |
| ![](previews/01-idle.png) | ![](previews/02-progress.png) | ![](previews/03-complete.png) |

逐字出现的中间状态：

![](previews/04-reveal.png)

### 证据边界

- 以上是实际 Resolve 时间线导出，不是 HTML 模拟，也不是 AI 生成效果图。
- 未启用 Computer Use；没有做鼠标拖入或检查器布局的界面测试。
- 19、免费版和其他操作系统没有实机验证。
- 测试分辨率不代表 4K 或长段字幕的实时播放性能。
- 初期无界面独立合成测试曾失败；后续以时间线导入和实际导出作为结果依据，详情见 research.md。

## 用户端验收清单

在空白工程中完成以下检查，尤其是 19 或免费版：

- [ ] 重启后效果库只出现一个 AM Lyrics，不再出现 32 / 64。
- [ ] 拖入后默认中文正常显示，无红色报错节点或字体缺失。
- [ ] 控制 / Style 两页参数清楚可用，颜色选择器、字体字重配对正常。
- [ ] 修改歌词，无需进入 Fusion 即能生效。
- [ ] 删除 Timings 后自动均分；重新输入四组时间后跟随四段节奏。
- [ ] Idle opacity=0 时从不可见逐字出现。
- [ ] 改 Idle blur / Active blur 对应影响未唱 / 已唱文字。
- [ ] 粗体、普通字重、颜色、字号、位置、字距可调整。
- [ ] 设置非法时间时 Status 提示，文字不截断。
- [ ] 复制片段，各实例修改互不影响。
- [ ] 24 / 30 / 60 fps 工程、剪辑裁剪、Fusion 缓存、最终导出都与预期一致。
- [ ] 如需要换行、Emoji、组合音标、连字，逐一验证，不默认承诺支持。

## 避免误用

不要在保存当前正式工程前做未知版本的首次插件验收。遇到问题先给出 Resolve 版本、预设名、Lyrics、Timings、FPS，以及报错节点或截图。

## Workflow 插件时间线导入验证（2026-09-19）

- 插件离线测试增至 32 项，覆盖歌词范围重新对齐、逐字时间写入、逐行降级、256 字符上限和重叠轨道分配。
- 在本机 Resolve Studio 20.3.2 的隔离 QA 项目中验证公开 API 链路：按指定帧数实例化 `AM Lyrics`、写入宏控件、转换为媒体池 Fusion 源、精确追加到最高轨道之上的新轨道，并把多句合并为单一 Fusion 片段。
- QA 脚本完成后删除本轮临时时间线、媒体项和文件夹；没有在用户项目上执行破坏性测试。
- 尚未调用 Computer Use 完成插件 UI 点击回归，也未验证 Resolve 19、免费版和 macOS。
- 2026-09-19 直接替换用户模板文件后，当前已运行的 Resolve 进程仍保留旧的标题目录缓存；`InsertFusionTitleIntoTimeline("AM Lyrics")` 在不重启 Resolve 时可能得到空 Fusion 合成。安装器因此要求重启 Resolve；重启后再验收标题目录。
- 已通过 `ImportFusionComp` + 项目 PNG 渲染验证新单模板的 8 节点图像输出，当前进程缓存问题不影响生成 setting 或发布包。

详见 [`workflow-plugin/docs/verification.md`](../workflow-plugin/docs/verification.md)。
