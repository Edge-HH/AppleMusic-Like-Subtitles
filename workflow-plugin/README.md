# AMLL Resolve 歌词助手

这是一个通过 **工作区 → 脚本 → Utility → AMLL 歌词助手** 启动的 DaVinci Resolve 歌词助手：Lua 菜单入口启动独立 Python 宿主，再连接本地 Electron 界面。它与仓库根目录生成的 `AM Lyrics` Fusion 标题预设配合使用。

## 为什么不再使用“工作流程集成”

旧版本安装到 Studio 专属的 `Workflow Integration Plugins` 目录，只有支持该功能的 Studio 环境才会在 **工作区 → 工作流程集成** 中显示。Resolve Free 没有这个菜单，Resolve 20 的常规脚本入口是 **工作区 → 脚本**，因此使用普通 Scripts 目录中的 Lua 入口，而不依赖 Workflow Integration 菜单。外部 Python API 是否可写还受 Resolve 版本和偏好设置约束，不能据此宣称免费版完整兼容。

普通脚本启动后，会在本机回环地址创建一次性 JSON-RPC 宿主，再打开 Resolve 自带 Electron 运行时显示原有歌词界面。歌词搜索、SRT/LRC/TTML/YRC 导入、范围选择和现有时间线写入逻辑仍由同一个界面处理；Resolve API 写入由 Python 宿主执行。

## 安装

在仓库根目录运行：

```powershell
npm ci --prefix .\workflow-plugin
npm test --prefix .\workflow-plugin
npm run check --prefix .\workflow-plugin
powershell -ExecutionPolicy Bypass -File .\Install-Windows.ps1
```

安装器会：

1. 安装当前语言的 `AM Lyrics.setting` 标题预设。
2. 把 `AMLL 歌词助手.lua` 和 `amll-app.path` 安装到当前用户 `Fusion\Scripts\Utility`；应用放在 `Fusion\AMLL-Lyrics-App`，不混入脚本菜单扫描目录。
3. 如果发现旧版 `com.edgehh.amll.lyrics` Workflow 插件或旧脚本，会先复制到 `D:\CodexBackup`，再删除旧安装。
4. 自动记录 Resolve Electron 的路径；找不到时，脚本也会尝试常见的 Resolve 安装位置。

安装完成后请完全重启 Resolve，再从 **工作区 → 脚本 → Utility → AMLL 歌词助手** 打开。Resolve 会在启动时扫描 Scripts 目录，安装后当前已经运行的 Resolve 不会自动刷新菜单。

## 使用

1. 搜索歌曲名／歌手，粘贴单曲链接，或导入本地 SRT、LRC、TTML、YRC。
2. 选择与音源一致的歌词版本，核对逐字／逐行精度与预览。
3. 在“导入范围”中填写开始行和结束行；预览中范围外歌词会变淡。
4. 选择时间线锚点与歌词偏移。所选范围第一行的起点会落在锚点加偏移的位置，而不是保留整首歌开头的空白。
5. 选择放置方式：顶部新轨道散落为顶层可编辑的 Fusion 文字，或合并为一个外层复合片段；不再逐句套内层歌词片段。
6. 选择自动英文词间空格或自定义连接符（可留空）；预览与导入一致。`AM Lyrics` 保留真实逐字时间，最终文字上限为 256 个 Unicode 码点。
7. 点击“导入所选歌词到时间线”。界面显示进度和耗时，不再在 120 秒后误报超时；导入期间不要切换项目、时间线或重复提交。

## 普通脚本宿主文件

- `launcher.lua`：Resolve 菜单入口，不要求嵌入式 Python。
- `launch.ps1`：查找 64 位 Python，以隐藏控制台启动宿主；支持 `-CheckOnly`。
- `script-host.py`：连接当前运行的 Resolve，串行处理本地 RPC；启动失败显示诊断并记录日志。
- `main.js`：Electron 界面入口，同时保留 Studio Workflow Integration 的兼容入口。
- `lib/resolve.js`：根据启动参数选择 Studio 原生桥接或普通脚本 RPC 桥接。
- `adapters/renderer.js`：Studio 原生桥接模式下的渲染器；普通脚本模式由 `script-host.py` 执行等价写入。

本地 RPC 只监听 `127.0.0.1`，每次启动使用随机令牌，插件窗口关闭后宿主进程随脚本退出。

## 生成插件包

在仓库根目录运行：

```powershell
./Build-Plugin-Package.ps1
```

脚本会按锁文件安装生产依赖、执行基础测试和语法检查，并生成 `dist/AMLL-Resolve-Script-v0.4.0.zip` 与 SHA-256 文件。

## 限制

- 需要独立的 Python 3.8+ 64 位；未设置 `RESOLVE_SCRIPT_API` 时，从标准 Developer 目录加载 `DaVinciResolveScript.py`，不会误用当前目录。
- 外部 API 可能被 Free／Studio 版本或脚本偏好设置限制；免费版完整导入尚未实测。
- 需要先启动 Resolve，并打开项目和时间线。
- 普通脚本模式默认使用 `AM Lyrics` 标题来源；媒体池中的其他 Fusion 标题仍保留在 Studio Workflow 兼容路径中。
- 运行中的 Resolve 会缓存 Scripts 菜单；更新脚本后必须完全重启 Resolve。
- 远程歌词索引和平台接口可能受到网络、地区、登录、限流或接口变化影响。

## 菜单未出现／点击没有反应

1. 完全退出并重开 Resolve，以刷新 Scripts 菜单；安装不会更新正在运行的菜单缓存。
2. 可在完整解压的一键安装包中双击 `Open-Lyrics.cmd`，不必等待菜单缓存。
3. 安装器输出备用 `launch.ps1` 路径；`-CheckOnly` 可检查 Python 和宿主文件而不打开界面。
4. 启动错误弹窗会指出原因，详细日志在 `%LOCALAPPDATA%\AMLL-Lyrics\logs\host.log`。
5. 已修复空 `RESOLVE_SCRIPT_API` 被当成当前目录、PowerShell BOM 污染路径、Python 3.8+ 的 DLL 查找，以及官方 SDK 替换模块对象后的引用问题；DLL 设置仅对本次宿主进程生效。
6. 若需要设置外部脚本访问，请在 Resolve 中自行核对偏好设置；安装器不会降低脚本安全限制。


## 时间线检查停住 / undefined.name

脚本宿主的 `context` RPC 返回扁平的时间线元数据；JavaScript 桥接层将它包装为与原生宿主一致的 `{ info }`，供连接状态、导入任务和 JSON 导出共用。此处缺少包装曾导致界面读取 `timeline.name`、任务构建读取 `context.frameRate` 时出错。

连接失败或数据不完整时会清除旧的可写状态、结束两个检查提示，并显示原因；恢复连接后可刷新重试。更新运行中的插件需要关闭歌词助手窗口后重新打开，不需要重新安装或更换 Fusion 标题。


## 扁平导入更新

- 每批只创建一份共享空白定位源，不再每句 CreateFusionClip；各时间线片段自身只保留一套独立标题合成。
- **容器类型仍是 Fusion 片段，而非效果库原生标题。** 在 Fusion 页面直接编辑本句文字，无需进入内层歌词时间线。此方式用于克服原生插入 API 无目标轨道参数的限制。
- 合并仅增加一个外层复合片段；已有旧片段不会自动迁移。
- 任务等待实际完成结果；若真正断线，提示“结果不确定”，不要直接重复导入。
- 连接符作用于已有分词；没有逐字分段的行只替换原有水平词间空白，不给连续中文猜分词、不伪造时间。

结构、响应协议、验证记录与限制见 [docs/direct-import.md](docs/direct-import.md)。此次更新只需关闭歌词助手再重新打开，不必重装标题；新增菜单入口才需要重启 Resolve。
