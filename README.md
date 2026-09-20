# AM Lyrics — Apple Music 风格逐字字幕

面向 **DaVinci Resolve Studio 19+** 的原生 Fusion 标题与歌词导入插件。

> 当前版本改为单一标题模板，不再向用户暴露旧版 `32 / 64` 节点容量区别。
> 旧版曾在 Windows / Resolve Studio 20.3.2 验证时间线渲染；0.5.0 重构版的完整图像验收尚未通过，请查看本轮验证记录。

## 下载与语言版本

每个 Release 同时发布：

- `AM-Lyrics-Windows-Installer-v*.zip`：Windows 一键安装标题和 Scripts 插件，自动按系统界面语言选择中文或英文标题。
- `AM-Lyrics-Title-ZH-v*.zip`：仅中文检查器标题；其中也包含可双击安装的 `AM-Lyrics-ZH.drfx`。
- `AM-Lyrics-Title-EN-v*.zip`：仅英文检查器标题；其中也包含可双击安装的 `AM-Lyrics-EN.drfx`。
- `AMLL-Resolve-Script-v*.zip`：仅 Scripts 插件。

同一台机器只安装一个语言的标题版本；中文和英文包里的模板文件名都叫 `AM Lyrics.setting`，不会同时在效果库出现两套语言。

### Windows 一键安装

1. 解压 `AM-Lyrics-Windows-Installer-v*.zip`。
2. 双击 `Install-Windows.cmd`，安装到当前用户的 Resolve Scripts 目录。
3. 安装器会备份旧标题／旧插件到 `D:\CodexBackup`，删除旧的旧版 AM Lyrics 模板文件，再安装当前系统语言对应的单一标题与歌词助手。
4. 重启 Resolve。

如果双击后窗口一闪而过，请先完整解压 ZIP，再运行解压目录里的 `Install-Windows.cmd`，不要直接双击压缩包内的文件或 `Install-Windows.ps1`；安装器会保留窗口并显示具体错误。

也可以手动指定语言：

```powershell
./Install-Windows.ps1 -Language zh
./Install-Windows.ps1 -Language en
```

## Fusion 标题重构（0.5.0 候选版）

> 本轮已完成算法／结构回归与部分原生接口验证，但**尚未完成新版完整图像和实时播放性能验收**；不能据此宣称逐帧等同 AMLL。
> 旧版示例图片不代表此次效果，具体证据与阻塞情况见 [`docs/validation.md`](docs/validation.md)。

效果库仍使用 **AM Lyrics**，保留原生 Fusion 标题，不改为网页视频渲染流程：

- 移除按字符数量估算宽度的矩形遮罩，以及重复叠加的底字／当前字结构。
- 原生 Text+ `Start / End` 按实际排版截取字符或词；`WordBounds` 的图像 DataWindow 提供单词实际左右边界。
- Custom Tool（原生类型 ID 为 `Custom`）在单词实际宽度内扫描线性亮暗前沿。前沿后方的文字保持同一亮度，不以整词透明度渐变冒充逐字扫亮。
- 已稳定、动画中、尚未开始三个区域各自拥有对应文字；不在移动字下方保留另一份静态字形。
- 常规词至少用 1 秒 ease-out 上浮 0.05em，唱完后继续完成上浮并保持终点；强调字使用错落的缩放、水平位移、上浮和光晕包络。
- 最多 16 个活动动画槽，空槽直接跳过 Merge，零光晕绕过 SoftGlow。整张图固定 100 个节点，不是“每个字都永久分配一套节点”。**节点数／跳过分支不等于实时帧率保证，仍需实测。**
- 每帧只计算一份时间状态，输出字段共享结果；时间基准采用 `comp.GlobalStart`，不随单帧导出的 RenderStart 改变。

单句上限仍为 256 个 Unicode 码点；错误时间或超限时全句静态回退并显示原因，不静默截字。

## 检查器

- **Controls**：歌词、分词时间、自动时长、偏移、帧率、输入检查；宏自身提供恢复默认按钮，已移除按字符范围分段的全部控件。
- **Style**：字体、字重、字形加厚（默认 0.006，设为 0 关闭）、字号、位置、字距、行距、颜色和总透明度。
- **Motion**：平滑扫亮、上浮、长音强调、逐字错落、强调光晕五个独立勾选开关（默认开启），以及亮暗前沿宽度（em）、未唱／已唱透明度、上浮高度（em）、最短上浮时长、强调门槛／倍率、光晕倍率、句尾加强、背景人声模式。
- 移除未接线的模糊滑杆、重复的亮度／透明度控制和隐藏的字符标记状态。
- **恢复默认效果**恢复字体、位置、颜色和动效；**不改变 Lyrics、Timings、Duration、Offset、FPS**，不会破坏已完成的对拍。

## 手动使用

1. 更新安装并重启 Resolve 后，重新拖入 `AM Lyrics`；已有时间线标题包含旧节点副本，不会被安装器自动替换。
2. 输入 `我|想要|留住|这一刻`。
3. 留空时间使用自动节奏，或者输入 `0-0.5|0.5-1.5|1.8-2.6|2.6-4.2`。
4. 分词只需在歌词中输入 `|`，或使用歌词助手导入已有逐字时间；不再提供字符范围选择和自动拆分时间的按钮。
5. 使用“恢复默认效果（保留歌词和时间）”回到默认外观，包括恢复加厚量和效果开关。

### 预览性能与效果取舍

- 默认在 Bold 基础上用 Text+ 同色细描边加厚字形，不增加独立图像处理节点；测量和实际文字使用一致的加厚参数。
- 整词动画复用已渲染字形的边界，同词逐字错落共用一次整词测量；扫亮未开始、已完成或关闭时不再通过边界表达式请求整词图像。
- 没有缩放时不读取字形中心；没有任何变换时将 Transform 的 Blend 设为 0；关闭光晕时沿用 SoftGlow 的零 Blend 旁路。
- 需要更轻的预览时，先关闭“逐字错落”：长音改为整词强调，仍保留平滑扫亮、上浮、缩放和光晕；再按需关闭“强调光晕”。
- “上浮”关闭后，常规和强调的垂直位移都关闭；“长音强调”关闭后，不再产生强调缩放、错落和强调光晕，但常规上浮保留。
- “平滑扫亮”关闭后，按每段结束时间从未唱亮度切到已唱亮度，不修改时间数据。
- 未在真实 Resolve 中测得此次优化后的 FPS；结构回归测试不等同于实际预览性能或画面验收。

## 从歌词助手直接导入

菜单入口改为 **工作区 → 脚本 → Utility → AMLL 歌词助手**，由 Lua 启动器调用独立的 64 位 Python 3.8+ 宿主与本地 Electron 界面，不再依赖 Resolve 的嵌入式 Python 是否可用。

如果菜单尚未刷新，完全退出并重开 Resolve；也可在完整解压的安装包中双击 **`Open-Lyrics.cmd`**。需要先启动 Resolve。启动失败会显示错误，并写入 `%LOCALAPPDATA%\AMLL-Lyrics\logs\host.log`，不再静默退出。

**兼容性边界：** Lua 菜单入口不依赖 Workflow Integration 菜单，但独立 Python 连接的是外部 Resolve API，可能受到 Free／Studio 版本和脚本偏好设置限制；未实测免费版，不承诺免费版完整导入。普通脚本模式的媒体池自定义标题导入仍有限制，与此次动效重构无关。

打开 **工作区 → 脚本 → Utility → AMLL 歌词助手**：

1. 搜索 AMLL／平台歌词，或导入 SRT、LRC、TTML、YRC。
2. 导入前选择连续歌词范围。
3. 选择播放头、时间线起点或绝对帧，并设置偏移。
4. 选择散落到顶部新轨道，或合并成一个 Fusion 片段。
5. 选择 `AM Lyrics` 保留真实逐字时间；选择媒体池其他 Fusion 标题会明确降级为逐行歌词。

插件不会覆盖或波纹移动现有剪辑。重叠的主唱／和声会自动放到额外顶部轨道。

## 开发与构建

```powershell
./Build-Title-Preset.ps1
./Build-Plugin-Package.ps1
./Build-Release-Packages.ps1
```

测试：

```powershell
python -m unittest discover -s tests -v
cd workflow-plugin
npm test
npm run check
```

发布 tag `v*` 时，`.github/workflows/release.yml` 会构建中文版、英文版、Windows 一键安装包和 Scripts 插件，并上传到对应 GitHub Release。

## 限制

- 是 Fusion 内对 AMLL 单行逐词行为的近似实现，不是完整播放器：未移植相邻歌词行的焦点、弹簧滚动、行级模糊、翻译／Ruby 排版和交互。
- 强调短词按字符错落；超过 8 码点的中文长段改用整词强调，避免节点随歌词无限增长。极密集段落会优先让已唱文字提前稳定，并显示容量提示。
- 一个分词应放在同一排版行；跨换行的单词、多行文字的混合扫亮、复杂连写、组合 Emoji 和字形簇没有完整宿主验证。
- 光晕半径和强度是 Fusion 映射值，不等同于浏览器 text-shadow 的像素语义；不能保证所有字体、色彩管理、4K/HDR 设置下相同。
- Resolve 19、免费版、macOS 没有本轮实机验证；Windows 启动入口需要 64 位 Python 3.8+ 和可用的外部 Resolve API。
- 字体不随模板分发；中文默认 `Microsoft YaHei UI`，英文默认 `Arial`。

完整测试证据见 [`docs/validation.md`](docs/validation.md)。
