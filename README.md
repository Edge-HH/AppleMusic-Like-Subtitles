# AM Lyrics — Apple Music 风格逐字字幕

面向 **DaVinci Resolve 19+** 的原生 Fusion 标题预设，无外部运行脚本、无字体打包、无 Studio 专属 OFX 节点。

> **当前状态：已在 Windows / Resolve Studio 20.3.2 做真实时间线导出验证。**
> 32 / 64 字版、自定义时间、逐字出现、错误输入回退和简单英文空格已验证；另有 16 项自动测试通过。
> Resolve 19、免费版、macOS / Linux 尚未实测，19+ 是兼容目标而非全版本保证。鼠标拖入与检查器界面布局尚未做 Computer Use 验收。
> [查看真实导出预览与测试记录](docs/validation.md)。

## 下载 / 安装

仓库内已经生成可安装文件，不需要 Python。

- **方式 A：** 双击 [`dist/AM-Lyrics.drfx`](dist/AM-Lyrics.drfx)，在 Resolve 中确认安装。
- **方式 B（Windows）：** 关闭 Resolve 后双击 [`Install-Windows.cmd`](Install-Windows.cmd)。脚本把两份 `.setting` 放入当前用户标题目录，遇到同名文件会先备份至 `D:\CodexBackup`。
- **只选一种方式**，不要把 DRFX 和独立 setting 同时安装，以免重复显示。

重新打开 Resolve，在 **剪辑页 → 效果库 → 标题** 搜索 `AM Lyrics`，拖到视频上方轨道。

| 预设 | 建议 |
| --- | --- |
| AM Lyrics 32 | 通常优先使用，每句最多 32 个 Unicode 码点 |
| AM Lyrics 64 | 较长句，最多 64 个码点，合成负担更高 |

空格、标点、换行也计入容量。超长输入不会偷偷截掉后半句，而是退回完整静态文字，在 Status 中说明原因。

## 最简单的使用方式

1. 拖入 `AM Lyrics 32`，将片段长度设为约 **5 秒**。
2. 在检查器的 **Lyrics / 用 | 分段** 输入：

   ```text
   我|想要|留住|这一刻
   ```

3. **Timings 留空**，Auto duration 设为 `4`，Offset 保持 `0.3`：片段开始 0.3 秒后，从左到右逐字变亮，在约 4.3 秒时唱完。
4. 需要逐字出现，而不是提前看到整句：把 **Idle opacity / 未唱透明度** 调成 `0`。
5. 改颜色、字体、粗细、位置、字号，在 **Style** 页调整。

`|` 只用于分段，不会出现在画面中。不填时间时，按照**字符数**均分整句时长，而不是每段分配一样多时间。

## 跟着演唱自定义节奏

对应上面的四段，填四组时间：

```text
0-0.5|0.5-1.5|1.8-2.6|2.6-4.2
```

每组都是 `开始秒数-结束秒数`，相对于片段起点，**再统一叠加 Offset**。要把填写时间直接当片段时间，请设 `Offset = 0`。

- `想要` 的两字均分 `0.5–1.5` 秒；`留住` 在 `1.8` 秒开始，中间允许留空拍。
- 每个字要独立对拍：写成 `我|想|要|留|住|这|一|刻`，填八组时间。
- 所有时间必须递增、不能重叠，结束必须大于开始。
- 无需手动打关键帧；复制片段再改词和时间即可复用。
- 不做音频识别，不会自动知道歌词或唱词时刻。

更多例子：[examples/lyrics.md](examples/lyrics.md)。

## 外观参数

| 参数 | 默认 | 作用 |
| --- | --- | --- |
| Font / Style | Microsoft YaHei / Bold | Windows 中文优先；更换字体后选择该字体实际提供的字重 |
| Size | 0.065 | Fusion 归一化字号，不是像素 |
| Position | 画面中心 | 整句位置，不影响各字相对布局 |
| Color | 白色 | 已唱文字 RGB，未唱文字以该颜色乘亮度系数 |
| Idle opacity | 0.35 | 未唱部分透明度；0 为逐字出现 |
| Active opacity | 1 | 已唱部分透明度 |
| Idle brightness | 0.85 | 未唱颜色的亮度系数，和透明度分开 |
| Idle blur | 1.5 | 未唱文字的 Fusion 原生 Blur 大小，不承诺等同 CSS 像素 |
| Active blur | 0 | 已唱文字模糊 |
| Transition | 0.85 | 每字时间里用于平滑变化的比例；数值越大越柔和 |
| Overall opacity | 1 | 整体透明度 |
| FPS | 0 | 读取合成帧率；若时间不一致，手动填项目帧率 |

默认是白色粗字、暗字预显、逐字清晰化。**这是风格近似，不是 Apple Music 完整播放器移植**：不包含多句弹簧滚动、整词内连续扫光、长音弹跳、背景流体或音频同步。当前每字是整体渐亮，不是字形内部从左到右填充。

## 限制和注意事项

- 19+ 是兼容目标，后续版本并不自动等于已验证；请见 [验证清单](docs/validation.md)。
- 只用了 Text+、Blur、Merge 和 Lua 表达式，设计上不要求 Studio；免费版仍须实际验证。
- 中文基本字符、简单拉丁文字是优先目标。Emoji 组合、组合音标、阿拉伯连写、字体连字等，码点数量不等于字形数量，**不保证逐字隔离正确**。
- 简单英文空格已实测；换行以及不同字体的连字索引行为仍需实际画面验证。首轮建议使用短句单行中文。
- 推荐每个标题片段放一句歌词。不会自动拆行、分页或把整首歌词切成多个片段。
- 长句超出画面时请缩小字号或拆成多个片段；不自动缩小文字。
- 每个字槽使用独立 Text+、Blur、Merge；32 字版有 97 个节点，64 字版有 193 个。没有实时播放性能保证，4K 或多条叠加建议降低预览分辨率、使用 Fusion 缓存。
- 裁剪或变速后的对拍以实际片段为准；动画使用合成 RenderStart 作为零点，不会随拉长片段自动拉伸手填时间。
- 字体不随预设分发，Mac/Linux 需改为本机有的中文无衬线粗体；不提供 Apple 专有字体。

## 开发与维护

仓库根目录提供两个一键构建入口：

```powershell
./Build-Title-Preset.ps1   # 生成两份 .setting 与 AM-Lyrics.drfx
./Build-Plugin-Package.ps1 # 测试并生成版本化 Workflow Integration 插件 ZIP 与 SHA-256
```

标题预设的开发测试仍可单独执行：

```powershell
# 仅开发测试需要 lupa；普通使用预设无需安装任何 Python 依赖。
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

- `src/timing.lua`：唯一的分段、时间、UTF-8 计数和错误处理逻辑。
- `tools/build.py`：生成原生节点树以及可复现的 DRFX 压缩包。
- `Build-Title-Preset.ps1`：面向本地与 CI 的标题预设一键入口。
- `Build-Plugin-Package.ps1`：安装锁定依赖、测试并生成可分发插件包。
- `tools/install.ps1`：非管理员安装，支持 `-WhatIf`、`-Destination`、`-BackupRoot`。
- `tests/test_preset.py`：执行真实 Lua 5.1，而不是用 Python 另写一套计时逻辑。
- `docs/research.md`：一手资料、参考范围和未验证假设。
- `docs/validation.md`：测试证据与 Resolve 内验收步骤。
- `docs/automation.md`：一键构建、GitHub Actions 与 `main` 保护规则。

修改源码后必须重新构建并测试，避免提交与源码不同步的 dist。现有标题片段是否随重新安装更新取决于 Resolve 的模板实例化行为；测试新版时请重新拖入。

## 参考与归属

视觉方向参考 [amll-dev/applemusic-like-lyrics](https://github.com/amll-dev/applemusic-like-lyrics)，本项目没有复制其渲染代码。与 Apple、Blackmagic Design、AMLL 团队无隶属或官方授权关系。
