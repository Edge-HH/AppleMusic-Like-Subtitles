# 自动构建与 GitHub 保护

仓库提供两个根目录 PowerShell 脚本，分别生成 DaVinci Resolve 标题预设和 Workflow Integration 插件包。

## 本地一键构建

### 标题预设

```powershell
./Build-Title-Preset.ps1
```

默认输出到 `dist/`：

- `AM Lyrics 32.setting`
- `AM Lyrics 64.setting`
- `AM-Lyrics.drfx`

可用 `-OutputDirectory <目录>` 修改输出位置。该脚本只要求 Python 3，不安装测试依赖。

### 工作流插件包

```powershell
./Build-Plugin-Package.ps1
```

脚本会执行以下步骤：

1. 按 `workflow-plugin/package-lock.json` 执行 `npm ci --omit=dev --ignore-scripts`。
2. 执行插件的 27 项离线测试与 JavaScript 语法检查。
3. 校验 `package.json` 与 `manifest.xml` 的版本一致。
4. 生成 `dist/AMLL-Resolve-Workflow-v<版本>.zip`。
5. 生成对应的 `.sha256` 校验文件。

仅在已经单独完成测试时，才可使用 `-SkipTests` 跳过第 2 步。分发包包含锁定的生产依赖，但不包含 Blackmagic Design 专有的 `WorkflowIntegration.node`；安装脚本会从用户本机 Resolve 开发示例中复制与当前版本匹配的桥接文件。

## GitHub Actions

`.github/workflows/build.yml` 在以下情况运行：

- 推送到 `main`。
- 向 `main` 提交 Pull Request。
- 在 Actions 页面手动触发。

工作流包含两个并行检查：

- `🎬 标题预设`：构建标题文件、执行 Python/Lua 测试并上传 DRFX 与 setting。
- `🧩 工作流插件`：测试插件、生成版本化 ZIP 与 SHA-256 文件并上传。

工作流、任务和步骤名称统一使用前置 emoji 与中文描述，便于在 Pull Request 检查列表中快速辨认。

## main 分支保护

远端 `main` 应启用以下保护：

- 只能通过 Pull Request 合并。
- 必须通过 `🎬 标题预设` 与 `🧩 工作流插件` 两个状态检查。
- 分支必须与最新 `main` 保持同步。
- 必须解决所有审查对话。
- 管理员同样受保护规则约束。
- 禁止强制推送和删除分支。

仓库首次推送前 GitHub 上不存在 `main`，保护规则只能在首次提交推送后创建。
