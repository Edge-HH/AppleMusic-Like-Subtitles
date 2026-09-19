# 一手资料与实现取舍（旧版历史记录）

记录日期：2026-09-19。

> 下文记录旧版迭代，不代表 0.5.0 的节点结构与当前验证状态；当前映射见 `amll-motion-research.md`，验证状态见 `validation.md`。

## 1. AMLL：只参考视觉，不移植代码

- 仓库：https://github.com/amll-dev/applemusic-like-lyrics
- 阅读的实际源码：`packages/core/src/styles/lyric-player.module.css`。
- 该文件 Git blob：`ab72e21eb2c4ba65b32ca841bbab63870f1ccff2`。
- 源码地址：https://github.com/amll-dev/applemusic-like-lyrics/blob/main/packages/core/src/styles/lyric-player.module.css

CSS 用不同的 mask alpha 区分亮部和暗部；gradientMask 状态亮部为 1、暗部为 0.4，并有 opacity / filter 过渡。这里把“未唱弱化、已唱明亮、柔和平滑”作为视觉方向，使用原生 Fusion 节点重新实现。

**边界：** 本项目的单字整体透明度与模糊过渡不是 AMLL 的连续渐变遮罩扫描，也不包含它的整行滚动和强调动画。默认值是本项目的视觉近似，不声称精确复刻 Apple 官方实现。没有复制第三方渲染代码或字体。

## 2. Blackmagic 原生模板作为序列化依据

在本机 Resolve Studio 20.3.2 的官方安装包内读取：

```text
E:\Davinci Resolve\Fusion\Templates\Templates.drfx
```

核对的例子：

- `Edit/Titles/Text Ripple.setting`：GroupOperator、InstanceInput、InstanceOutput、Font/Style 配对、RGB ControlGroup，以及 TextPlus 原生 Opacity1。
- `Edit/Titles/Jitter Lower Third.setting`：TextPlus 的逐字裁剪参数确实为 **Start / End**，不是其他节点所用的 WriteOnStart / WriteOnEnd。
- `Fusion/Tools/Edge Control.setting` 等：Blur 的 XBlurSize 和 Filter 字段。
- 原生模板文件存放在 ZIP 的 `Edit/Titles/` 下；本项目 DRFX 采用同一目录结构。

这些例子只用于核对格式和输入 ID，没有把现有官方设计复制进本项目。

进一步使用本机 `fuscript.exe` 创建原生 TextPlus，读取 GetInputList，再以 Blackmagic 的 `bmd.readfile` 解析生成的 setting，确认原生解析器接受格式。

## 3. 真实宿主与脚本依据

官方随安装提供的 API 文档：

```text
C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\README.txt
```

使用文档列出的 `InsertFusionCompositionIntoTimeline`、`ImportFusionComp`、`SetRenderSettings`、`AddRenderJob`、`StartRendering` 做真实时间线的 PNG 导出，而非仅在普通 Lua 中模拟图像效果。

**踩坑记录：** 新建的独立 Fusion 合成不等于 Resolve 时间线里的合成。无界面环境里 Paste 返回 false，一次 Fusion.LoadComp 尝试触发进程崩溃；改用 Resolve TimelineItem.ImportFusionComp 后，同一节点结构成功载入并完成实际渲染。独立合成测试不能拿来证明标题不可用，也不能跳过真实时间线测试。失败路径的底层原因没有进一步诊断。

自定义数字输入需要 `INP_External = true` 才能可靠连接动画表达式；早期 false 的设置导致 Progress 保持默认值。已修正并在原生宿主中验证。

## 4. 实现结构

- 全句 TextPlus 统一排版；每个字槽以 Start/End 截取对应字符。
- 各字槽用单独的 Progress 同时驱动 Opacity1、RGB 亮度和 Blur。
- 所有字槽的 Font、Style、Size、Center、字距、行距都引用控制器，不用手动计算字形宽度。
- Lua 5.1 兼容的 UTF-8 码点计数，避免把中文误算成三个字节。
- 暴露歌词与时间两组文本字段；分段不限固定行数，只受每句容量限制。
- 不缓存跨帧状态，因此倒放或随机跳帧时由当前帧重新计算。
- 错误时间、空段、超长输入走全句静态回退，避免静默丢词。

源码只使用 TextPlus、Blur、Merge、MacroOperator；没有 `ofx.*`、Fuse、自定义插件、网络请求或每帧文件读取。**这为免费版兼容提供设计基础，但不能代替免费版实测。**

## 5. 未验证范围

- Resolve 19 和免费版。
- macOS / Linux 字体与模板安装路径。
- 4K、HDR、变速、复杂 Unicode grapheme / 连写脚本、所有可选字体的连字行为。
- 所有未来 Resolve 版本。

实际验证记录与待测步骤见 `validation.md`。
