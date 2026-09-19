# 第三方来源与许可

## jitwxs/163MusicLyrics

参考仓库：https://github.com/jitwxs/163MusicLyrics
参考 commit：26d8a73471ea88ab6d4c97406853391b2fadad19
许可：Apache License 2.0，全文位于 `docs/163MusicLyrics-LICENSE.txt`。

参考文件：
- `cross-platform/MusicLyricApp/Core/Service/Music/NetEaseMusicNativeApi.cs`
- `cross-platform/MusicLyricApp/Core/Service/Music/QQMusicNativeApi.cs`
- `archive-winform/MusicLyricApp/Api/Music/QQMusicNativeApi.cs`

本插件改用 JavaScript / Node.js HTTPS 重写请求封装，使用独立数据模型和错误处理。
`lib/providers.js` 的网易云 WEAPI 参数、公开常量和 AES/RSA 封装方式及 QQ 搜索／LRC 请求参考上述代码。
未复制其完整应用、UI、Cookie 管理或 QQ QRC 解密实现。

## amll-dev/amll-ttml-db

来源：https://github.com/amll-dev/amll-ttml-db
使用元数据索引和用户选择的 TTML 文件，保留来源、提交版本与作者信息。
上游声明：外来数据遵循原数据提供方的共享协议，提交者自主编写部分采用 CC0 1.0。
该声明不等于所有歌曲歌词版权均已放弃；使用者仍需确认发布／商业用途的权限。

## @xmldom/xmldom

通过 npm 使用，锁定版本记录在 package-lock.json，许可证随依赖包提供。
用于结构化 XML 解析；显式禁用含 DTD 和实体声明的输入。

## Blackmagic Design

仅参考用户本机 Resolve Developer 的 Scripting API 文档，以及 Electron 的安全模型文档。
普通脚本宿主通过 Resolve 官方 Python Scripting API 与本地 Electron 界面通信，不分发 WorkflowIntegration.node。
本项目不是 Blackmagic Design、Apple、网易云或 QQ 的官方产品。

## amll-dev/applemusic-like-lyrics（视觉行为参考）

参考仓库：https://github.com/amll-dev/applemusic-like-lyrics
固定参考提交：2ca8e58051d1df306cbbd6bd8e66cb0293565b1b
许可：上游仓库声明 AGPL-3.0，完整许可证见上游 `LICENSE`。

本项目没有复制上游 TypeScript、CSS 或动画代码。当前 Fusion 模板仅参考其公开视觉行为：逐词渐变遮罩、轻微上浮、字符强调缩放与辉光，并用独立的 Resolve 原生 Text+、Custom、Transform、SoftGlow、Merge 节点重新实现。

0.5.0 单行参数映射及与上游的差异详见仓库 `docs/amll-motion-research.md`；没有将上游 TypeScript/CSS 渲染器纳入分发。
