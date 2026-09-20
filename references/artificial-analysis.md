# Artificial Analysis 案例与诊断

本流程来自 Models、Trends、Qwen 模型详情和独立 Intelligence/Response Time 图表的实作。以下是站点特定经验，不是所有 Next.js 站点的固定协议。

## 已验证架构

- 每页独立 `source.html`、`index.html`、`assets/`、`manifest.json`，共享必要适配文件。
- Vite middleware 回放源资源 URL；dev 与 preview 均配置。
- `/models` 与 `/trends` 保留完整原站组件；模型详情页使用自己的 HTML 初始状态，而不是把总榜改标题。
- 独立图表通过保留挂载树并隐藏无关兄弟节点完成，不重新创建 SVG/点位。

## 数据损坏与校验

原站某批次数据为 `/data/*.txt`，实际上是 AES-GCM 密文。CDP 把字节当文本时可能发生损坏，页面会只剩初始模型子集，且不一定明显报错。

提取密钥/资源清单的步骤：

1. 用 Cheerio 解析 `source.html` 的 script。
2. 找到 `self.__next_f.push(...)`；对已观察到的 JSON 参数用 `JSON.parse`，不能 `eval` 任意 HTML。
3. 拼接/分析 Flight 字符串时注意跨 chunk 分片。仅当本次记录中的 `"manifest": { ... }` 对象确实完整且无嵌套时，才可使用限定正则抽取后再 `JSON.parse`；否则使用对应解析方法。
4. 从对象读取 `path` 和十六进制 `key`，获取该 path 的原始字节。

本批次客户端采用以下算法，使用前需核对当前发布代码：

```js
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const raw = Buffer.from(keyHex, 'hex');
const iv = crypto.createHash('sha256').update(raw).digest().subarray(0, 12);
const key = await crypto.webcrypto.subtle.importKey(
  'raw', raw, 'AES-GCM', false, ['decrypt']
);
const plain = await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes);
const data = JSON.parse(gunzipSync(Buffer.from(plain)).toString('utf8'));
```

成功快照中曾验证 650 个模型和 957 个 endpoint 记录；这些是该次快照的证据，不应硬编码成未来所有版本的通过标准。比较源站同版本记录数、模型 ID 和关键字段。

## 图表状态

`Intelligence Index vs. End-to-End Response Time` 的该批次模块输入包括：

- `models`、`allModels`、`selector`、`focusModelIds`、`border`。
- X = `endToEndResponseTime`，输出 500 tokens 的秒数（包含推理等待）。
- Y = `intelligenceIndex`；两项均大于 0 才纳入，按智能指数降序排列。
- 左上象限表示较优区域；前沿 hook 可能自动添加候选模型。
- `focusModelIds` 使详情页的 Qwen 点持续高亮，其他点淡化。这与鼠标 hover 状态不同。

相关 query：`intelligence-comparison=intelligence-vs-end-to-end-response-time`。`capability-index=engineering` 控制另一个指标区，不能用它替换智能指数的 Y 轴。

## 常见故障

| 现象 | 检查与处理 |
| --- | --- |
| 图显示了，但模型选择很少 | 校验完整数据加载与解密，不以有 SVG 为通过 |
| URL 正确但标签没切换 | 检查 hydration 和事件类型；用真实点击验证 |
| `.click()` 无效 | 该批次 Radix tab 监听 mousedown；查明后再适配 |
| 新详情页变成默认应用 | 新增 middleware 后确认服务重载；先有 manifest 再注册 |
| 本地跳转卡住 | Next RSC 未捕获；对已保存页面整页跳转 |
| 下载触发却没有内容 | 验证文件签名、大小、图像尺寸和图像内容 |
| 轴范围与旧截图不同 | 检查模型集合、数据版本、前沿自动添加和 focus，不强行改坐标凑图 |

源码交付时，本次图表入口的 webpack 模块 ID 为 `64977`；散点图为 `56208`，前沿逻辑为 `59471`。ID 与哈希 bundle 名随发布变化，必须重新查找标题和模块注册表，不能固定匹配。
## 整站先探查的实际执行过程

以下记录来自 2026-09-15 至 16 日的这次项目。数量描述当时的快照，不能作为未来网站的预设通过阈值。通用清单规范见 [site-discovery-checklist.md](site-discovery-checklist.md)。

1. **从已有产物起步。** 读取 Models、Trends、Qwen 和提取图表的现有文件、manifest 与 Vite middleware，保留已完成路由。读取英文 sitemap 获得 5,845 个 URL；用户明确只要英文，语言不计为独立页。
2. **分组并探查代表入口。** 访问首页、模型推荐、榜单、模型/供应商详情、Agents、图像/视频/语音、文章、方法说明及工具等模板。滚动触发懒加载，保存标题、DOM 控件、URL、网络请求和桌面/手机截图，再操作标签、筛选、设置与说明。接触到 Arena 验证或提交界面时记录后台边界，不投票或提交。
3. **边发现边扩展队列。** 合并 sitemap、原始 HTML 的站内链接、浏览器动作发现的新地址和已有快照。探查时曾误点顶部 Inference 导航，导致后续手机截图来自错误页面；修正为排除导航控件、每次核对准确 URL 并恢复基线。这说明截图必须绑定状态而非只绑定脚本中的原始 route。
4. **实际点击 Apply 才发现隐藏状态。** Prompt Options 的 radio 选择尚未生效，Apply 才导航到 `/prompt-options/single/medium`、`single/long`、`single/100k` 或 `multiple/medium`。这些路径不在初始 sitemap/普通链接中。解析已观察到的 Flight 属性 `defaultWorkloadOnly`、`hundredKPromptsUnsupported` 排除不适用组合，再补原有 Models/Qwen 状态；最终保存 2,586 个输入规模状态，归在所属页面下。
5. **跟踪真实导航和新增资源。** 原适配把所有 RSC 返回 204，Apply 导航因而可能空白。改为区分 `Next-Router-Prefetch`/`Next-Router-Segment-Prefetch` 与真实导航，后者走本地整页加载。新状态引用了另一版 CSS、webpack runtime 和路由模块，资源复查补齐 12 项。
6. **追踪异步图表数据。** 历史标签切换后才加载公开接口；快速点完标签会漏掉请求。检查原发布模块确认请求 schema，匿名捕获供应商历史、模型供应商历史、缓存命中率历史，以及按选中模型/端点请求的模型历史。针对缺失 API 的本地 SPA fallback 曾返回 200 HTML，改为显式错误才能暴露缺口。
7. **按动作链断网验证。** 新浏览器上下文禁止外网，依次选择输入规模、Apply、等待准确路由、点击历史标签、等待数据并断言。直接访问原站与本地核对：Models 的并发历史标签显示 `Over time charts are only available with parallel_queries=1`；Qwen 供应商比较在并发状态下没有该标签。保留这些源站限制，不能为通过测试编造曲线。
8. **生产预览发现选择错误。** 旧单页 middleware 优先返回一份固定历史响应，忽略 POST 的选择。状态码、JSON 和有曲线都正常，直到核对返回 ID 才发现。让这些历史接口绕过旧 handler，并增加中间件集成测试和请求 ID 断言。重启 Vite 后才加载了修改；最后复查生产预览的直接路由、POST 选择、源站 404 和媒体 Range。

这次存量证据分散在 `inventory.json`、`discovered-urls.json`、`interaction-report.json`、`prompt-states.json`、资源 manifests、`verification.json`、`prompt-history-verification.json` 和截图对比报告中。后续应从这些结构化记录生成统一清单，而不是在结尾仅汇总下载数。此次只对代表页面做浏览器验证，没有证明每页每个组合都已操作；不能把保存量当成完整交互覆盖。

## 历史接口的具体处理

| 公开读取接口 | 请求身份与回放方式 |
| --- | --- |
| `/api/providers/performance-over-time` | GET，保留 `host-id`、`prompt-type` |
| `/api/models/providers/performance-over-time` | GET，保留 `model-id`、`prompt-type` |
| `/api/models/providers/cache-hit-rate-over-time` | GET，保留 `model-id` |
| `/api/models/performance-over-time` | POST，正文包含 `modelIds`、`hostModelIds`、`promptType` |

本次捕获了 50 家供应商的 200 份响应；模型相关读取执行了 2,956 次请求，涉及 714 个模型和 1,184 个端点。POST 按 ID 分批读取，按实际选择组装 `modelSeries` 和 `hostModelSeries`。保持 `restrictedByPlan`、`planLimitDays`；原站确实返回空数据与本地未捕获 ID 分开处理，后者显式报不可用。

这些操作使用项目中的 `discover-full-site.mjs`、`explore-full-site.mjs`、`discover-prompt-states.mjs`、`capture-model-history.mjs` 等脚本。它们是项目实例，不是本 skill 自带的通用爬虫；复用时先检查目标项目和当前原站协议，不硬编码这些路径、模块 ID 或数据规模。
