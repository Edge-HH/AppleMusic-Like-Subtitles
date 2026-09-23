# 构建与发布自动化

## 本地入口

- `Build-Title-Preset.ps1`：生成 `dist/zh/AppleMusic样式标题.setting`、`dist/en/AppleMusic样式标题.setting`、中文 DRFX 和英文 DRFX。
- `Build-Plugin-Package.ps1`：测试并生成版本化 Resolve Scripts ZIP。
- `Build-Release-Packages.ps1`：组合完整 Release 资产，包括两个语言标题包与 Windows 一键安装包。

## CI

`.github/workflows/build.yml` 在 push、PR 和手动触发时构建测试产物。

`.github/workflows/release.yml` 在推送 `v*` tag 时：

1. 安装 Python 与 Node 测试依赖。
2. 运行标题和插件测试。
3. 构建：
   - `AppleMusic-Style-Title-ZH-v*.zip`
   - `AppleMusic-Style-Title-EN-v*.zip`
   - `AppleMusic-Style-Title-Windows-Installer-v*.zip`
   - `AppleMusic-Style-Title-Script-v*.zip`
   - 对应 SHA-256 文件。
4. 创建或更新同名 GitHub Release 并上传上述资产。

中文和英文标题包使用相同的模板显示名 `AppleMusic样式标题`，用户选择一个语言安装，不会在检查器同时看到双语标签。
