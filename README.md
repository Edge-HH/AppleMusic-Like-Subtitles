# AM Lyrics — Apple Music 风格逐字字幕

面向 **DaVinci Resolve Studio 19+** 的原生 Fusion 标题与歌词导入插件。

> 当前版本改为单一标题模板，不再向用户暴露旧版 `32 / 64` 节点容量区别。
> 已在 Windows / Resolve Studio 20.3.2 验证 8 节点标题的真实时间线渲染，以及插件的精确轨道写入 API。

## 下载与语言版本

每个 Release 同时发布：

- `AM-Lyrics-Windows-Installer-v*.zip`：Windows 一键安装标题和 Workflow 插件，自动按系统界面语言选择中文或英文标题。
- `AM-Lyrics-Title-ZH-v*.zip`：仅中文检查器标题；其中也包含可双击安装的 `AM-Lyrics-ZH.drfx`。
- `AM-Lyrics-Title-EN-v*.zip`：仅英文检查器标题；其中也包含可双击安装的 `AM-Lyrics-EN.drfx`。
- `AMLL-Resolve-Workflow-v*.zip`：仅 Workflow 插件。

同一台机器只安装一个语言的标题版本；中文和英文包里的模板文件名都叫 `AM Lyrics.setting`，不会同时在效果库出现两套语言。

### Windows 一键安装

1. 解压 `AM-Lyrics-Windows-Installer-v*.zip`。
2. 双击 `Install-Windows.cmd`，接受管理员权限提示。
3. 安装器会备份旧标题／旧插件到 `D:\CodexBackup`，删除旧的旧版 AM Lyrics 模板文件，再安装当前系统语言对应的单一标题与歌词助手。
4. 重启 Resolve。

也可以手动指定语言：

```powershell
./Install-Windows.ps1 -Language zh
./Install-Windows.ps1 -Language en
```

## 标题模板

效果库中只显示 **AM Lyrics**。它不再用每字符一套 Text+／Blur／Merge，而是固定 8 个原生节点：

- 底层 Text+：未唱文字的低亮、透明度和模糊。
- 上层 Text+：已唱文字的高亮颜色。
- 柔边 RectangleMask：从左向右推进，形成单字内部的渐变过渡。
- SoftGlow：只给高亮部分添加轻微白色炫光。
- Size / Center 表达式：歌词唱到时产生短促的轻微缩放与上浮。

旧 32 字版约 97 个节点，旧 64 字版约 193 个节点；新模板固定 8 个节点，减少预览和缓存压力。单句安全上限改为 256 个 Unicode 码点，超限会静态回退并提示，不会截断。

## 检查器

- **控制页**：歌词、逐字时间、自动时长、延后、渐变宽度、跳动、上浮、帧率和“重置动画参数”。
- **Style 页**：字体、字重、字号、位置、字距、颜色、未唱／已唱明暗和模糊、炫光及“重置样式参数”。
- 不再存在空白“控制”页或单独的 Lyrics 页。
- 中文包只显示中文标签，英文包只显示英文标签。

默认风格调整为更接近 Apple Music 的白色粗体、大字号、暗灰未唱文字、轻模糊、柔边逐词亮起、轻微上浮缩放和克制炫光。实现原则参考 AMLL 一手源码的渐变遮罩、上浮和强调动画，但 Fusion 实现为独立节点设计，详见 [`docs/amll-motion-research.md`](docs/amll-motion-research.md)。

## 手动使用

1. 从效果库拖入 `AM Lyrics`。
2. 在控制页输入 `我|想要|留住|这一刻`。
3. 可留空逐字时间并使用自动时长，或输入：

   ```text
   0-0.5|0.5-1.5|1.8-2.6|2.6-4.2
   ```

4. `|` 是分段符，不会显示；每组时间对应一个分段。
5. 需要恢复推荐值时，使用控制页和 Style 页底部的重置按钮。

## 从歌词助手直接导入

打开 **工作区 → 工作流程集成 → AMLL 歌词助手**：

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

发布 tag `v*` 时，`.github/workflows/release.yml` 会构建中文版、英文版、Windows 一键安装包和 Workflow 插件，并上传到对应 GitHub Release。

## 限制

- 这是 Apple Music 风格近似，不是 Apple Music 官方播放器或 AMLL 网页渲染器的逐帧移植。
- 固定 8 节点方案优先流畅性；单字渐变遮罩按整行几何估算，不承诺复杂换行、阿拉伯连写、字体连字和组合 Emoji 的字形级准确性。
- 免费版、Resolve 19、macOS 尚未形成完整实测矩阵。
- 字体不随模板分发；中文默认优先 `Microsoft YaHei UI`，英文默认 `Arial`。

完整测试证据见 [`docs/validation.md`](docs/validation.md)。
