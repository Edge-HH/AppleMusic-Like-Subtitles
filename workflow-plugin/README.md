# AMLL 达芬奇歌词助手

面向 **DaVinci Resolve Studio 19+ / Windows** 的 Workflow Integration 插件。
该目录独立于仓库中的 Fusion 歌词样式开发，不修改其 `src/`、`dist/` 或构建流程。

## 当前状态

- 已实现：歌曲名／歌手搜索 AMLL、查看历史歌词版本、来源与作者展示。
- 已实现：网易云、QQ、Apple Music、Spotify 单曲链接定位 AMLL。
- 已实现：AMLL 没有匹配时，网易云／QQ 平台候选搜索及歌词回退。
- 已实现：网易云 YRC 逐字歌词；QQ 平台回退为逐行 LRC，不支持其加密 QRC。
- 已实现：本地 SRT、LRC、TTML、YRC 导入，以及直接粘贴歌词内容。
- 已实现：UTF-8、UTF-16 BOM、GB18030/GBK 解码；可手动指定编码。
- 已实现：逐字／逐行／混合精度标记、翻译、音译、和声和演唱者数据保留。
- 已实现：播放头／时间线起点／绝对帧号锚点、毫秒偏移、JSON 对接任务与普通 SRT 导出。
- **未接入：Apple Music 样式生成及自动添加到时间线。** `adapters/renderer.js` 明确返回不可用，添加按钮禁用，等待样式模块完成后接入。
- **未完成：真实 Resolve 19、19.0.2、20+ 宿主的完整安装与 UI 回归矩阵。** 当前按照本机官方沙箱化 Electron 示例实现，不宣称所有 19+ 版本已实测。

## 安装

需先安装 Node.js 18+（推荐受支持的 LTS）用于开发依赖和测试；插件运行使用 Resolve 自带 Electron。

在本目录运行：

```powershell
npm ci
npm test
npm run check
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

如系统安装目录拒绝写入，请使用管理员 PowerShell 执行安装脚本。

### 生成可分发插件包

在仓库根目录运行：

```powershell
./Build-Plugin-Package.ps1
```

脚本会按锁文件安装生产依赖、执行测试和语法检查，并生成 `dist/AMLL-Resolve-Workflow-v0.1.0.zip` 及对应 SHA-256 文件。ZIP 不分发 Blackmagic Design 专有的 `WorkflowIntegration.node`；最终安装时仍由包内 `scripts/install.ps1` 从用户本机 Resolve 开发示例复制桥接文件。
脚本从本机 Resolve 开发示例复制 `WorkflowIntegration.node`，不将该专有二进制提交或再分发到仓库。
更新前会将旧安装备份到 `D:\CodexBackup`，不会删除仓库或安装目录。
更换 Resolve 版本后建议重新安装，以采用对应版本的原生桥接文件。

重启 Studio 后打开：**工作区 → 工作流程集成 → AMLL 歌词助手**。
macOS 理论上支持该插件机制，但此版本未提供 macOS 安装器或验证；Linux 不在此工作流插件的支持范围。

## 使用

1. 搜索歌曲名／歌手，或粘贴单曲链接。默认仅在 AMLL 无匹配时请求平台；勾选“同时查询平台候选”可以主动查询。
2. AMLL 列出历史提交版本，较新的优先展示，最多显示 100 个；用更精确关键词缩小范围。
3. 点击候选预览；平台候选会再次按 ID 检查 AMLL，优先给出可用逐字版本。“直接尝试平台歌词”跳过这次检查。
4. 可导入自己的 SRT/LRC，或展开“直接粘贴歌词内容”。本地文件不会上传。
5. 正偏移延后歌词，负偏移提前歌词。JSON 使用当前时间线帧率及添加／导出时的播放头；SRT 只使用歌词偏移，不混入时间线锚点。
6. 样式模块未接入时只能预览和导出，选择歌词本身不会改动时间线。

## 网络与平台限制

AMLL 使用仓库 `metadata/raw-lyrics-index.jsonl` 以及对应 `raw-lyrics/*.ttml`，不依赖 GitHub 搜索 API。
索引缓存 24 小时，可手动刷新；网络故障时使用可用旧索引并显示其时间。歌词正文目前不做离线缓存。
平台调用仅参考 163MusicLyrics 的客户端接口方式，不是平台承诺稳定的开放 API。
可能受到登录、地区、限流和接口变化影响；不收集账号密码、不绕过访问限制，本版不提供 Cookie 登录配置。
网易云需要登录时可使用歌曲链接尝试歌词获取，或导入本地文件；不能保证所有歌曲可取得。
QQ 平台回退使用 `songmid`，纯数字 QQ ID 可匹配 AMLL，但不能直接执行 QQ 平台回退。
短分享链接仅支持白名单 HTTPS 服务端重定向；依赖网页 JavaScript 跳转的短链需要复制最终单曲链接。
Apple Music／Spotify 不直接抓取平台歌词，只用链接 ID 匹配 AMLL。

## 歌词精度与时间

普通 LRC、SRT 只有逐行时间，不会均分文字假装逐字。
LRC 缺少行结束时间时使用下一条不同起点；末行默认 5 秒。增强 LRC 缺失末字结束时间时使用行结束，因此需核对音源。
LRC `[offset:+N]` 按规范提前 N 毫秒，与 UI 中“正值延后”的语义相反；解析阶段已应用文件 offset。
不接受负起点、反向时间、越界单词、超过 8 MB 的文件和带 DTD/实体声明的 XML。
TTML 面向 AMLL 绝对时间格式，不支持 `timeContainer="seq"`、帧／tick 时间表达式或任意 TTML 相对时间布局。
AMLL 不同平台 ID 可能对应不同音源时长，选择后必须自行核对版本和偏移。

## 开发与测试

```powershell
npm test       # 确定性离线测试
npm run check  # JavaScript 语法检查
npm run smoke  # 联网冒烟测试：会向 GitHub/网易云/QQ 发请求
```

联网测试失败时以具体源的响应为准，不应删除错误检查来“修复”测试。
查看 [对接协议](docs/renderer-contract.md)、[测试记录](docs/verification.md) 与 [第三方声明](THIRD_PARTY_NOTICES.md)。
