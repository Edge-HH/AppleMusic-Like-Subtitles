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

仅参考用户本机 Resolve Developer 的 Workflow Integrations 示例及 API 文档。
安装脚本在用户本机复制 WorkflowIntegration.node，不在本项目分发该专有二进制。
本项目不是 Blackmagic Design、Apple、网易云或 QQ 的官方产品。
