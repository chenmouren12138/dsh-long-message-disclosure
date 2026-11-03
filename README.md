# dsh-long-message-disclosure

包名：`@local/dsh-long-message-disclosure`；显示名（zh / en locale 一致）：`dsh-long-message-disclosure`。

长消息渐进披露（Progressive Disclosure for Long Messages）。

在对话时间线里，超过可配置阈值的**用户消息正文**默认折叠成有意义的裁剪预览；触发器遵循
[WAI-ARIA Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) 模式。折叠态只挂载预览
切片，完整正文不进入 DOM，因此也不进入可访问性树与 Tab 序列；展开/收起时保持触发器在视口中的位置，
避免长会话回看时的滚动跳变。

## 安装（其他电脑）

本插件以 DSH profile bundle 分发，从 Git 仓库安装即可：

1. 打开 DSH 的「插件」页 → 「添加插件」。
2. 填入仓库地址（GitHub 托管的仓库地址会被 DSH 识别为 git 依赖）：

   `https://github.com/chenmouren12138/dsh-long-message-disclosure`

3. 安装完成后刷新页面；发送一段超过 `threshold`（默认 1200 字）的消息即可看到折叠效果。

> 包内声明了 `private: true`，仅用于 Git 安装，不发布到 npm。
> Host 半需要一个可用的 `webServer` 服务来发布运行时配置（Web / Desktop 版 DSH 默认具备）；缺失时 Client 使用内置默认策略。

## 挂载点（为什么是这个槽位）

| | |
|---|---|
| Client 槽位 | `conversation.user.text.node`，cell `text` |
| 声明者 | `@deepseek-ai/dsh-client-ui-conversation` 的 `conversation.user.text` Factory |
| 作用域 | `session` |
| 替换风险 | `shadows-shipped-ui`（只替换消息正文的纯文本 cell，其余 cell 不动） |

`conversation.chat.node` 的消息行、`conversation.chat.user.content` 内容栈、附件与引用 chip 都由宿主
继续负责。本插件只接管「一段用户消息正文文本」这一层，因此：

- 短消息、`enabled: false`、以及队列预览/本地回显等非交互面（`interactive !== true`）原样输出纯文本；
- 长消息输出一个可组合的披露容器：裁剪预览 + 渐变遮罩 + 展开/收起触发器；
- 引用 chip（`@file`、`@session`…）仍然由宿主各自 cell 渲染。

## 配置

Host 行配置（`cordis.patch.yml`）经 `Config` 校验后，由 Host 半在
`GET /dsh-long-message-disclosure/config` 上以 `no-store` 发布；Client 半在插件 effect 内读取一次，
把结果作为**运行时 props** 交给披露容器。配置改动后刷新页面即可生效。

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关闭时正文渲染与宿主一致（不折叠）。 |
| `threshold` | `1200` | 触发折叠的正文长度（字符，200–200000）。 |
| `previewChars` | `480` | 折叠态最多挂载的预览字符数（80–20000，且必须小于 `threshold`）。 |
| `previewLines` | `8` | 预览可见高度（按换行后的行数裁剪，与气泡行高对齐）。 |
| `previewStrategy` | `boundary` | `boundary` 在预算后 45% 内优先取段落 / 句末 / 词边界；`hard` 精确切在预算处。 |
| `labels.expand` | `''` | 展开触发器文案覆盖；留空用 locale 词典（zh/en）。 |
| `labels.collapse` | `''` | 收起触发器文案覆盖。 |
| `labels.count` | `''` | 字数提示覆盖，`{count}` 会被替换。 |

预览预算永远小于触发阈值：否则「折叠」等于没有折叠。Host 校验与 Client 兜底归一化都会夹紧这个不变量。

## 可访问性

- 触发器是原生 `<button type="button">`，带 `aria-expanded` 与指向正文容器的 `aria-controls`；
  键盘 Enter / Space 原生可用，焦点在切换后保持在同一元素上。
- 折叠态只渲染预览切片（`previewChars` 内），完整正文**未挂载**，因此自动从可访问性树和 Tab 序列中消失，
  不需要额外的 `aria-hidden` 或 `inert`。
- 预览容器带 `title`（"已折叠，仅显示前 N 字"），字数用 `toLocaleString()` 分位。
- 只在 `prefers-reduced-motion` 之外给 chevron 加 120ms 旋转，减少动效偏好下直接切换。

## 视口锚定与宿主测量协同

切换时先记录触发器相对视口的 `top`，在 `useLayoutEffect` 里比较切换后的 `top`，把差值写回最近的滚动
祖先的 `scrollTop`——这是宿主自己的滚动容器（transcript 根是 `overflow-y: clip`，真正的滚动口在其上层）。

- 差值补偿发生在布局之后、绘制之前，不产生可见跳动；
- 读者**跟随尾部**（距底 ≤ 8px）时跳过补偿，把位置交给宿主 follow / `ResizeObserver` 机制，
  不与它争夺滚动权；
- 展开让内容在触发器上方增长，锚定触发器等于把视口停在「预览结束处」，新展开的正文自然接在下方。

## 生命周期

所有副作用都在 `apply` 内由 effect 拥有：样式注入、locale 词典、配置请求（`AbortController` + 3s 超时）、
槽位注册。配置到达后若与默认值不同，会重建 entry 以传入新的 props；插件卸载时逐一回收。
渲染函数本身无副作用，组件内部没有订阅、定时器或 DOM 写入。

## 已知边界

- **只覆盖用户消息正文。** 助手回复的 Markdown 正文在当前 DSH 组合里没有等价的 body 槽位
  （`conversation.chat.node` 的 `assistant-step` 会整体替换消息行渲染器，代价与回归面都过大），
  因此助手长回复的折叠不在本插件范围内。
- **配置改动需要刷新页面**：Client 每个页面生命周期只读一次策略路由。
- 折叠态挂载的是 `previewChars` 内的预览文本；完整字符串仍在 React props 里（来自会话日志），
  只是不进入 DOM。
- 展开状态不持久化：重新挂载（例如重新打开会话）后回到默认折叠，符合「默认截断」。

## 验证状态

本次交付已核对：

- `plugin_manager install_bundle` → `application: applied`，无 warnings；bundle 列表显示
  `@local/dsh-long-message-disclosure` 已安装、启用，Host 行 `dsh-long-message-disclosure` 存在。
- `GET /dsh-long-message-disclosure/config` 返回 200 与解析后的策略 JSON。
- `Slots.listSubTree('conversation.user.text.node')` 中本插件的 `text` cell（priority 10）为
  `active: true`，宿主原 `text` cell（priority 100）转为 `active: false`。
- 离线单测覆盖策略归一化与预览裁剪；渲染冒烟测试覆盖 ARIA 接线、折叠只挂载预览、展开挂载全文、
  短消息/非交互面/关闭策略的原样透传，以及文案覆盖。

未验证：实际浏览器中的像素级呈现（没有页面控制通道）。刷新页面后粘贴一段超过 1200 字的输入即可目视确认。

