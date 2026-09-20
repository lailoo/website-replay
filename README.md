# Website Replay · 网站回放

先探查，再列清单，保存公开前端，最后用证据验证离线副本。

这是一个可安装的 Codex skill，同时附带 Node.js / Playwright 脚本。它保留网站已经发布的 HTML、样式、JavaScript 和数据，通过最小适配在本地回放。适用于图表、榜单、文档和多页网站的高保真离线保存。

它不还原作者的工程源码，也不自动复制登录、支付、投票、实时生成或付费后台。多页 SPA、跨域资源、Next.js RSC、私有数据协议仍需要针对实际站点适配。

## 工作流程

1. **探查**：从指定 URL、sitemap、导航和实际操作发现页面、控件、状态、资源及跳转。
2. **维护清单**：记录原站/本地地址、入口、保存进度、证据和下一步；语言、query 和工作负载归为状态。
3. **捕获**：保存服务器原始 HTML 和浏览器观察到的资源；保留 MIME、query、字节和内容哈希。
4. **回放**：精确匹配页面/资源，明确报告缺失；不会用首页或伪造 JSON 掩盖失败。
5. **验收**：关闭源站依赖，在新浏览器上下文执行场景、检查数据和截图，回写清单。

“文件已下载”“能够打开”“交互正确”“视觉一致”分别核对。抽样通过不等于每页每个功能已完全复制。

## 安装为 Skill

将本仓库放在 `~/.codex/skills/website-replay`，或安装到你的 Codex 技能目录。无需运行脚本即可使用其中的流程与诊断规范。

调用示例：

```text
使用 $website-replay 复刻 https://example.com。
先探查并逐步整理页面、状态与跳转清单，再保存公开前端。
按清单验证直接打开、点击跳转、状态恢复、数据、交互和视觉差异。
```

## 运行脚本

需要 Node.js 20.19+、npm 和 Chromium。以下命令在仓库根目录运行：

```bash
npm ci
npx playwright install chromium
npm test
```

编辑 [examples/site.config.json](examples/site.config.json)，填入目标地址、输出路径及实际资源前缀。示例 URL 是占位地址，不代表已经适配了目标网站。输出目录不应提交到开源仓库。

```bash
npm run discover -- examples/site.config.json
npm run checklist -- examples/site.config.json
npm run capture -- examples/site.config.json
npm run verify -- examples/site.config.json
npm run replay -- examples/site.config.json 5180
```

清单在配置的输出目录 `CHECKLIST.md`，逐项证据在 `inventory.json` 和各快照的 `evidence/` 中。本地默认地址为 `http://127.0.0.1:5180`；使用清单中的完整路径/query 打开。

`maxPages` 限制每轮发现/捕获数量，重复运行可继续处理队列。发现阶段只读取链接和控件，不自动点击任意按钮。按实际观察编写场景，再通过 `scenarios` 为具体路由配置；场景会在源站和本地各执行一次，必须使用明确、可逆的操作及真实结果断言。

更完整的配置、恢复方法、返回码与限制见 [脚本说明](references/tooling.md)。单页脚本仍可直接使用：

```bash
node scripts/capture.mjs capture-config.json
node scripts/replay.mjs snapshots/example 5180
```

## 包内内容

| 路径 | 用途 |
| --- | --- |
| [SKILL.md](SKILL.md) | Agent 的工作入口 |
| [探查与清单规范](references/site-discovery-checklist.md) | 页面/状态/跳转模型、清单字段与核销规则 |
| [捕获与回放](references/capture-and-replay.md) | 字节、请求、资源映射和最小适配 |
| [故障排查](references/difference-diagnosis.md) | 现象、证据、处理与回归检查 |
| [验收规范](references/verification.md) | 断网、交互、视觉和生产预览 |
| [Artificial Analysis 案例](references/artificial-analysis.md) | 实际发现过程、失误和修复依据 |
| [源码提取说明](references/source-extraction.md) | 原始工程源码、构建模块与重写版的区别 |
| `scripts/` | 单页及多页发现、捕获、回放和测试 |
| `examples/` | 配置和显式交互场景示例 |

## 验证范围

本流程来源于 Artificial Analysis 项目的实际离线保存经验。站点特定逻辑与实例证据记录在案例文档中，不作为通用脚本的一键适配承诺。

`npm test` 使用两个可重复创建的本地测试站点，验证单页原始字节、多页发现与状态归类、断点续跑、关闭源站后的交互与 CSS/图片、截图对比、query 隔离、Range、资源损坏检测和路径限制。这验证了工具机制，不等同于第二个真实生产站点的完整复刻。

真实小范围验证也已执行：`example.com` 静态页断网对比为零差异；`quotes.toscrape.com` 两页的 Next 跳转和内容断言通过，但外部 Google Fonts 未保存，视觉验收失败。完整结果和复现范围见 [验证记录](references/validation.md)。

尚未完成独立 Agent 的真实整站复刻验收。欢迎贡献带有可公开重现步骤的适配和失败样例；不要把截图正常或构建通过当作全站通过。

## 已知边界

- 当前通用捕获脚本保存同 origin 的公开 GET 资源。跨域 CDN、只读 POST 数据和 SPA 导航需要显式适配；文档包含处理方法。
- 自动发现不会穷举搜索字符串、数值范围、登录态或无限组合。sitemap index 需要先展开为子 sitemap 地址。
- 多页回放遇到相同 URL 对应不同资源哈希时拒绝启动，避免随意混用构建版本。
- 视觉检查默认比较一个配置视口的整页截图。动画、时间、随机内容及抗锯齿差异需要人工诊断，不能一律忽略。
- 场景断言的质量决定交互验证深度；未配置场景的页面仍保留“交互待验证”。

## 贡献与许可

提交修改前运行 `npm test`。修复请附可重复的最小页面、请求或匿名数据样例，说明原站现象、修复依据和回归结果。涉及新站点时写清适配范围与尚未验证的功能。

工具代码与本项目文档采用 [MIT License](LICENSE)。被保存的网站代码、图片、数据、字体和商标仍归原权利人所有，MIT 不授予这些内容的再发布权。本仓库不包含 Artificial Analysis 的网页快照、资产、数据或账号信息。请遵守目标网站条款和访问范围，不绕过身份验证或付费限制。
