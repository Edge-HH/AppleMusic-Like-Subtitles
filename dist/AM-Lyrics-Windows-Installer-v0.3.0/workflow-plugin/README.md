# AMLL Resolve 歌词助手

面向 **DaVinci Resolve Studio 19+ / Windows** 的 Workflow Integration 插件，与仓库根目录生成的单一 `AM Lyrics` Fusion 标题预设配合使用。

## 当前能力

- 搜索 AMLL 逐字歌词，并在无结果时回退网易云／QQ 平台候选。
- 导入本地 SRT、LRC、TTML、YRC，或直接粘贴歌词内容；本地文件不会上传。
- 保留逐字／逐行／混合精度、翻译、音译、和声与演唱者数据。
- 在导入前按连续行号选择歌词范围；所选第一行自动对齐时间线插入起点。
- 支持播放头、时间线起点、绝对帧号和正负毫秒偏移。
- 直接把真实逐字时间写入 `AM Lyrics` 的 `Lyrics` 与 `Timings` 控件；普通 LRC/SRT 只按整行显示，不会均分文字伪造逐字时间。
- 支持两种落点：
  - **散落到最上层新轨道**：每句一个 Fusion 源片段，主唱／和声重叠时自动增加额外顶部轨道。
  - **合并为一个新 Fusion 片段**：先精确放置所有行，再用 Resolve 的 `CreateFusionClip` 合并。
- 可扫描并选择媒体池中的其他 `Fusion` 类型项目作为标题来源；此路径只替换整行 Text+ 文本，明确降级为逐行歌词。
- 仍可导出与当前范围、锚点和来源设置一致的 JSON 渲染任务，或导出所选范围的普通 SRT。

> 自动时间线导入会创建 `AMLL 歌词生成` 媒体池文件夹保存每行的独立 Fusion 源。不要在仍使用这些歌词片段时删除该文件夹。

## 安装

需先安装 Node.js 18+（推荐受支持的 LTS）用于开发依赖和测试；插件运行使用 Resolve 自带 Electron。

在本目录运行：

```powershell
npm ci
npm test
npm run check
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

安装脚本会把既有插件备份到 `D:\CodexBackup`，再从本机 Resolve 官方开发示例复制匹配版本的 `WorkflowIntegration.node`；仓库与 ZIP 不分发 Blackmagic Design 专有二进制。

同时安装根目录生成的标题预设：

```powershell
..\Build-Title-Preset.ps1
..\tools\install.ps1
```

重启 Studio 后打开：**工作区 → 工作流程集成 → AMLL 歌词助手**。
macOS 理论上支持 Workflow Integration，但此版本没有 macOS 安装器或验证；Linux 不在支持范围。

### 生成可分发插件包

在仓库根目录运行：

```powershell
./Build-Plugin-Package.ps1
```

脚本会按锁文件安装生产依赖、执行测试和语法检查，并生成 `dist/AMLL-Resolve-Workflow-v0.3.0.zip` 与 SHA-256 文件。

## 使用

1. 搜索歌曲名／歌手，粘贴单曲链接，或导入本地歌词。
2. 选择与音源一致的歌词版本，核对逐字／逐行精度与预览。
3. 在“导入范围”中填写开始行和结束行；预览中范围外歌词会变淡。
4. 选择时间线锚点与歌词偏移。所选范围第一行的起点会落在锚点加偏移的位置，而不是保留整首歌开头的空白。
5. 选择放置方式：顶部新轨道散落，或合并为一个 Fusion 片段。
6. 选择标题来源：
   - `AM Lyrics` 会写入真实逐字时间，单句上限为 256 个 Unicode 码点。

   - 媒体池 Fusion 标题只写整行文本；如果项目没有可编辑 Fusion 合成或可写 Text+ `StyledText`，导入会停止并说明原因。
7. 点击“导入所选歌词到时间线”。导入期间不要切换项目或时间线。

## 时间线写入策略

- 插件先在临时时间线实例化标题、写入 Text+ 参数，再转换成独立 Fusion 源；因此最终可以用公开 Resolve API 精确指定轨道、记录帧和片段长度。
- 所有目标轨道都追加在现有最高视频轨道之上，不波纹移动、不覆盖原有剪辑。
- 主唱与和声等重叠行采用区间分配算法放到不同顶部轨道；不重叠行复用同一轨道。
- 合并模式只合并本次导入生成的片段；合并成功后清理空的中间轨道。
- 失败时会尽力删除已经写入的目标片段、空轨道、临时时间线和未完成媒体项；若发生部分写入，错误消息会提示检查 `AMLL 歌词` 轨道。

## 网络与平台限制

AMLL 使用仓库 `metadata/raw-lyrics-index.jsonl` 与对应 `raw-lyrics/*.ttml`，索引缓存 24 小时；网络故障时会使用可用旧索引并显示时间。
平台接口不是平台承诺稳定的开放 API，可能受到登录、地区、限流和接口变化影响；插件不收集账号密码，也不绕过访问限制。
Apple Music／Spotify 不直接抓取平台歌词，只使用链接 ID 匹配 AMLL。

## 歌词精度与限制

- 普通 LRC、SRT 只有逐行时间，不会均分文字假装逐字。
- LRC `[offset:+N]` 按格式规范在解析阶段应用；UI 的正偏移表示让歌词延后，两者不要重复计算。
- AM Lyrics 的 `|` 是分段符。歌词正文或逐字 token 中包含 `|` 时，自动导入会拒绝该行，避免写入错误文本。
- AM Lyrics 单行最多 256 个 Unicode 码点；超过时需先拆行。媒体池标题不受此容量规则约束，但只支持逐行文本。
- 媒体池来源必须能在时间线实例化后提供可编辑 Fusion comp 与 Text+ `StyledText` 输入；复杂自定义宏可能需要在 Fusion 页手动适配。
- 自动导入目前不写入翻译、音译或歌手标签到画面，只保留在歌词文档和 JSON 中。
- 真实 UI 回归目前只覆盖本机 Resolve Studio 20.3.2 的底层 API 路径；Resolve 19、19.0.2、免费版和其他平台仍需验证。

## 开发与测试

```powershell
npm test       # 确定性离线测试
npm run check  # JavaScript 语法检查
npm run smoke  # 联网冒烟测试，会向 GitHub／网易云／QQ 发请求
```

查看 [渲染协议](docs/renderer-contract.md)、[验证记录](docs/verification.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。
