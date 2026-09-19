# AMLL 动效参考研究（2026-09-19）

本项目没有复制 AMLL 的 TypeScript/CSS 实现；这里只记录从一手源码确认的视觉原则，再用 Resolve/Fusion 原生节点独立实现近似效果。

## 已确认的动效原则

- AMLL 的逐词亮起不是整词瞬间切换，而是用可配置宽度的线性渐变遮罩沿单词移动；默认 `wordFadeWidth` 为 `0.5`（相对词高）。来源：`packages/core/src/lyric-player/dom/animation/mask/animator-calc.ts`、`mask/utils.ts`、`base/index.ts`。
- 常规词带轻微向上移动，主歌词幅度约 `0.05em`，使用 `ease-out`；背景歌词幅度加倍。来源：`packages/core/src/lyric-player/dom/animation/float/index.ts`。
- 强调词按字符做缩放、上浮和白色辉光；源码限制了缩放、位移和 glow 幅度，并对最后一个词加强。来源：`packages/core/src/lyric-player/dom/animation/emphasize/index.ts`。
- 非活跃歌词使用较低遮罩 alpha；活动行提高 bright/dark mask alpha，并以短过渡切换。来源：`packages/core/src/styles/lyric-player.module.css`。
- 行级布局还使用带质量、阻尼、刚度参数的 spring 处理位置与缩放。来源：`packages/core/src/lyric-player/base/index.ts`。

## Fusion 映射

- 使用两层 Text+：底层负责低亮、低透明度和轻微模糊；上层负责高亮颜色。
- 使用一个柔边 RectangleMask 推进高亮层，近似单字内渐变遮罩，而不是为每个字符创建一套节点。
- 使用 Text+ 的 Size 与 Center 表达式做短促轻微缩放和上浮；不声称与网页 spring 求解器逐帧一致。
- 使用 SoftGlow 只作用于高亮层，形成轻微炫光。
- 整个标题固定 8 个节点，相比旧版 32/64 预设的约 97/193 个节点显著降低合成负担。

## 许可证边界

参考仓库采用 AGPL-3.0。当前实现只依据公开行为和参数范围做独立 Fusion 节点设计，没有复制其源码到运行时或发布包。来源：参考仓库 `LICENSE`。

## 固定参考版本

调研对应提交：`2ca8e58051d1df306cbbd6bd8e66cb0293565b1b`。
