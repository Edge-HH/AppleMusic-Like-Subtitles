# AMLL 动效参数与 Fusion 映射

## 固定来源

参考仓库：<https://github.com/amll-dev/applemusic-like-lyrics>

固定提交：`2ca8e58051d1df306cbbd6bd8e66cb0293565b1b`。
本轮通过读取固定提交文件核对参数，不将“main 的当前状态”当作稳定依据：

- `packages/core/src/lyric-player/dom/animation/float/index.ts`
- `packages/core/src/lyric-player/dom/animation/emphasize/index.ts`
- `packages/core/src/lyric-player/dom/animation/mask/animator-calc.ts`
- `packages/core/src/lyric-player/dom/animation/mask/utils.ts`
- `packages/core/src/lyric-player/base/line.ts`
- `packages/core/src/styles/lyric-player.module.css`

本项目独立实现时间状态和原生节点组，没有将上游 TypeScript、CSS 或 DOM 渲染器嵌入发布包；上游许可证为 AGPL-3.0。数学行为映射不代表浏览器与 Fusion 的字形和光晕渲染能逐像素一致。

## 已映射的单行规则

| 项目 | 参考行为／参数 | Fusion 实现 |
| --- | --- | --- |
| 活动行亮暗 | bright = 1、dark = 0.4 | 一次预乘 alpha 调制，不再先叠一层暗字 |
| 遮罩前沿 | 相对字体高度，默认 0.5 | 默认 0.5em，按原生词的 DataWindow 范围线性扫描 |
| 普通上浮 | 0 → -0.05em，ease-out，至少 1000ms，fill both | 求解 CSS cubic-bezier 的 x，再算 y；Fusion 正 Y 是向上，唱完仍继续至终点 |
| 背景人声 | 上浮加倍 | `BackgroundVocal`，导入和声时自动设置 |
| 强调门槛 | CJK 至少 1000ms；其他文本还要求去空白后长度为 2–7 | 默认门槛 1 秒；中文检测和码点计数是近似，不是完整 Intl.Segmenter |
| 强调幅度 | duration / 2000，短时立方、长时平方根；×0.6，上限 1.2 | 同样的持续时间响应，并提供整体倍率 |
| 光晕幅度 | duration / 3000，短时立方、长时平方根；×0.5，上限 0.8 | 单独随包络变化，零值绕过 SoftGlow |
| 句尾长词 | amount ×1.6，blur ×1.5，duration ×1.2 | 可关闭的句尾加强开关 |
| 强调包络 | 前半 `(0.2,0.4,0.58,1)`，后半 `(0.3,0,0.58,1)` | 连续按当前帧求值，非每字重新开始的统一脉冲 |
| 字符错落 | duration / 2.5 / 字符数 | 短强调词按字错落；常规词共用一个动画槽 |
| 缩放与位移 | scale = 1 + 0.1×amount×envelope；X 0.03em、Y 0.025em 量级 | 以每个截取字形真实中心为 Pivot，不绕整帧中心缩放 |
| 附加上浮 | sin 曲线，0.05em；比辉光提前 400ms，持续时间 ×1.4 | 与常规上浮叠加，跨切词继续计算，不突然截断 |

## 结构与性能边界

时间状态只在 `Controller.State` 计算一次，其余数值字段读取序列化结果。
整张原生图固定 100 个节点：控制器、稳定／未来区域及合并，再加 16 组 Text+ / 词边界测量 Text+ / Custom / Transform / SoftGlow / Merge。
当前无动画的槽位会跳过 Merge；零光晕会旁路 SoftGlow；无位移和缩放时将 Transform 的 Blend 设为 0。

词边界表达式仅在平滑扫亮进行中读取图像：整词槽复用 Glyph 的 DataWindow；同词后续字符槽复用前一槽的 NumberIn2/3，避免各自请求 WordBounds。未开始、已完成和禁用扫亮时直接返回零，像素公式显式处理两个端点，避免丢失边界后整词变暗。无缩放时 Pivot 固定在中心，不额外读取图像。

五个效果开关默认为开启以保留原动效；关闭逐字错落时，每个强调词只需一个动画槽。关闭上浮包含强调的附加垂直位移，稳定前缀也保持原位；关闭强调同时抑制其派生的错落和光晕。时间与分词数据不受开关影响。

Text+ 的第二着色元素以同色细轮廓加厚（Thickness2 默认 0.006），颜色和透明度跟随主体，边界测量使用相同设置；0 关闭该元素。输入 ID 参考本机 Blackmagic 官方 Templates.drfx 的 Deep / Blue Prints 模板，真实字形观感仍需宿主验收。

稳定前缀、活动槽、未来后缀划分不重叠。容量紧张时，只允许已经唱完的段提前稳定，不把尚未唱到的字提前变亮，也不丢字。

这些是减少不必要计算的结构措施，**不是实时性能测试结果**。本轮尚未取得新版完整渲染的有效帧率和图像证据，尤其不能把 640×360 的验证外推到 4K。

## 尚未等同上游的部分

1. DOM 版本的完整行布局、焦点弹簧、滚动、非活跃行模糊、行透明度状态机没有移植到这个单句标题。
2. 上游强调动画生成 32 个关键帧；这里直接对包络连续求值，结果更连续但不声称逐帧一致。
3. 字体 em 与 Fusion Size／SoftGlow 参数的换算是近似，色彩管理也会影响结果。
4. 大于 8 码点的强调中文段落使用整词强调；16 槽同时占满时有明确降级。
5. 单个分词必须在一行内；跨行词的 DataWindow 不是阅读顺序路径。
6. 字形簇、Emoji、连字、Ruby 和标点分词并非浏览器 Intl.Segmenter 的完整实现。

## 验证原则

Lua 数学回归只证明时间和区域划分；原生回调执行只证明按钮逻辑；最终图像和实时性能必须另用 Resolve 实测，结果见 `validation.md`。
