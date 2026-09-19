# 验证记录

日期：2026-09-19。

## 自动化验证

- Node.js v22.23.1：离线自动化测试 32 项通过。
- 新增范围与渲染测试覆盖：连续行范围重新归零、逐字相对时间、逐行降级、单一 AM Lyrics 的 256 字符上限、重叠歌词轨道分配。
- 所有项目 JavaScript 文件通过 `node --check`。
- PowerShell 安装／构建脚本通过现有测试链路。
- npm 生产依赖按锁文件安装，初始审计无已知漏洞。

## Resolve Studio 20.3.2 底层 API 实测

在仅用于 QA 的 `AM Lyrics QA ...` 项目中执行脚本验证，并在完成后清理本轮测试创建的时间线、媒体项和文件夹：

- `Timeline.SetMarkInOut(0, 47)` + `InsertFusionTitleIntoTimeline("AM Lyrics")` 创建 48 帧标题。
- 可通过 `GetFusionCompByIndex(1)` 找到 `AMLLyrics` 宏并写入 `Lyrics`、`Timings`、`Offset`、`Duration`、`FPS`。
- `CreateFusionClip` 生成可复用媒体池 Fusion 源。
- `MediaPool.AppendToTimeline` 使用 `trackIndex`、`recordFrame`、`startFrame`、`endFrame` 精确写入顶部新轨道；两句测试分别得到正确的 24 帧长度和绝对起点。
- 两个已放置歌词片段可通过 `CreateFusionClip` 合并，合并片段范围与首尾歌词一致。
- 现有最高轨道之外新增轨道可独立命名，测试没有波纹移动已有项目。

以上验证的是渲染适配层采用的公开 API 组合，不等于 Electron 插件界面的完整点击回归。

## 歌词源验证

- 真实 AMLL 索引加载：支持多作者文件名中的逗号；`YOASOBI Idol` 找到 2 个历史版本。
- 真实 AMLL TTML 下载解析：所选版本 92 行、逐字时间戳。
- 网易云歌曲 2048982668：返回并解析 90 行逐字 YRC。
- QQ 歌曲 001KEjQl07j8DG：返回并解析 55 行逐行 LRC。
- QQ 歌曲名搜索曾返回代码 2001，另一次成功返回 20 个候选，说明远端状态不稳定。

## 已知限制／未验证

- 本轮没有调用 Computer Use，因此尚未完成插件窗口的点击、滚动、下拉选择和真实用户安装回归。
- Resolve 19、19.0.2、免费版、macOS 与其他 Resolve 20 版本尚未形成完整兼容矩阵。
- 媒体池自定义 Fusion 标题结构差异很大；只支持能在时间线实例化后提供可编辑 Fusion comp 与可写 Text+ `StyledText` 的项目。不兼容项目会停止并报错。
- 网易云歌曲名搜索的匿名请求可能返回需要登录，本版本没有 Cookie 登录功能。
- QQ QRC 逐字解密不在本版本；AMLL／YRC 逐字与 QQ 平台逐行来源必须区分。

`npm run smoke` 会真实请求外部服务；任一平台受限时以非零状态退出，这是诊断结果而不是离线测试失败。
- 安装新标题文件后，Resolve 需要重启才能刷新标题目录；未重启的进程可能把 `InsertFusionTitleIntoTimeline("AM Lyrics")` 解析为空 Fusion 合成。
