# 捕获与回放

## 脚本起点

`scripts/capture.mjs` 适用于匿名公开、单 origin 页面。它不是通用的一键克隆器：跨域 CDN、后台 API、多页 SPA、RSC、CSP 和业务动作要依据原站适配。

在本 skill 包目录运行 `npm ci` 并准备 Chromium，脚本从自身位置解析依赖，不修改用户全局 Node 配置。用绝对路径替换 `<skill-dir>`：

```bash
node <skill-dir>/scripts/capture.mjs capture-config.json
node <skill-dir>/scripts/replay.mjs snapshots/example 5180
```

模板的本地集成测试：`node <skill-dir>/scripts/smoke-test.mjs`。它会启动临时源站、抓取、关闭源站，再验证离线页面、原始字节、查询隔离及交互；不访问真实外站，也不改动现有项目页面。

配置示例（文件路径相对配置文件目录）：

```json
{
  "url": "https://example.com/models?tab=response-time",
  "out": "snapshots/example-models",
  "resourcePrefixes": ["/_next/static/", "/_next/image", "/img/", "/data/"],
  "rawBytePrefixes": ["/data/"],
  "blockedPrefixes": ["/analytics/"],
  "scenario": "scenario.mjs",
  "settleMs": 1500
}
```

先检查网络请求，按实际路径填写资源前缀。JSON API 可以明确添加，但不能捕获账号/会话 API。`rawBytePrefixes` 必须来自 `resourcePrefixes` 的范围，脚本会通过 Node fetch 重新获取对应匿名 GET 响应的原始字节。需要 Cookie 或签名请求时停止使用匿名重取路径，改用经过验证的授权字节通道；不要将浏览器凭据写入配置或日志。

输出非空时脚本拒绝覆盖。刷新捕获应使用新目录，验收通过后再由项目操作替换旧快照。捕获任务和失败记录都会落盘，失败时返回非零退出码。

情景模块必须基于浏览器实际观察编写，不能把示例角色名当成站点约定：

```js
export default async function scenario(page) {
  const section = page.locator('#intelligence-comparisons');
  await section.scrollIntoViewIfNeeded();
  await section.getByRole('tab', {
    name: 'Intelligence Index vs. End-to-End Response Time', exact: true
  }).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('#intelligence-comparisons circle[data-chart-item-id]').length > 15
  );
  // Add observed, reversible actions for the requested scope.
}
```

## 文件契约

- `source.html`：导航主文档的服务器响应。
- `index.html`：初始与 source 相同，供项目做有记录的最小适配。
- `manifest.json`：`origin`、`document`、`resources`。资源以绝对 URL 为键，包含 `file`、`type`、`sha256`、`bytes`。
- `capture-report.json`：捕获时间、最终 URL、请求失败、浏览器错误。含错误的报告不能视为离线验收通过。
- `evidence/`：情景执行后的截图和 DOM 状态，不冒充所有视口/状态的完整验证。

保留查询字符串，尤其 `/_next/image?url=...&w=...&q=...`。源 origin 加进键，防止多个 CDN 同路径碰撞。哈希文件名避免文件系统特殊字符，MIME 单独存储，不依赖后缀识别资源类型。

还要记录内容协商：相同图片 URL 在浏览器的 Accept 请求头下可能返回 WebP，在 Node 默认请求头下返回 PNG/JPEG。不能让多个抓取器用 URL 哈希文件名互相覆盖不同响应。按响应内容哈希保存文件，由 manifest 记录 URL、请求变体、MIME、字节数和内容哈希；回放优先使用目标浏览器实际观察到的版本。验收时核对 manifest 哈希与磁盘字节，避免“路径正确但文件被覆盖”的隐蔽误差。

不要对整个 HTML 全局替换 CDN 地址。Next.js Flight 脚本可能包含按字节长度编码的文本记录；替换其中的 URL 会让长度失效，导致 `Connection closed.` 和 hydration 后正文消失。只修改 HTML 资源属性，并在运行时映射动态创建的图片、音视频及 fetch；原始 Flight 脚本保持不变。用包含长度前缀记录的测试样本验证这一点。

全站任务把页面清单、HTML 保存、资源补齐和浏览器交互验证分别计数。语言版本不自动算作独立功能页；按用户选择保留语言。公开链接返回的原站 404 单独记录，PDF、Excel 等下载按资源保存。资源任务定期落盘，允许从已验证格式的文件恢复；媒体回放应支持 HTTP Range，并验证播放及拖动进度。

## 字节陷阱

Playwright 的 `response.body()` 依赖浏览器/CDP；某些二进制数据标注为文本 MIME 时可能被转码。JSON 解码失败、解密失败、数据数量只有 SSR 子集时应首先查字节长度和哈希。

公开资源可通过 `fetch(url).arrayBuffer()` 获取。HTTP gzip/br 传输编码与数据本身 gzip 是两层：fetch 通常已解开传输编码，不应盲目再解一次；加密数据须先按应用算法解密，再处理应用层压缩。

同 URL 二次 GET 可能返回不同版本。检查原响应状态、重定向、MIME、ETag 和字节特征，验证数据能和当前 HTML 中的密钥/版本配对。已知 hash、magic bytes、AES 验证标签和可解析的结构是实质证据。

## 接入现有服务

`replay.mjs` 导出 `createSnapshotMiddleware(root)`，可在 Vite dev/preview 中注册：

```js
import { createSnapshotMiddleware } from './replay.mjs';
// configureServer: root 指向 public 下的快照目录。
server.middlewares.use(await createSnapshotMiddleware(snapshotRoot));
// configurePreviewServer: 指向构建后 dist 下的同一目录。
```

模板只接受抓取主文档的 pathname + query，并忽略 URL fragment。变化的 query、多个路由和尾斜杠要显式注册，并证明页面能恢复状态。资源严格匹配，不做 query 降级。已识别资源路径缺少 query 版本返回 404，避免静默拿错数据。

多个快照之间若同 URL 的字节不同，不能按 middleware 顺序随机选一个。应固定兼容版本、拆分服务 origin，或为每页资源做完整重映射。绝对远程 URL、内联模块中的 URL、CSS 引用和 runtime publicPath 都要核对。仅改 `<img src>` 不足以覆盖动态请求。

## 适配原则

- 使用 Cheerio/标准 DOM 解析 HTML；注入到 head/body 内，保留闭合标签。
- CSS 限定到新增页面/视图。原图拥挤或手机标签重叠也不能擅自改数据布局；先报告与原站的一致性，只有用户要求优化才另行调整。
- 只对确认可省略的遥测静默处理。隐藏 API 错误会造成图表看似正常却只有少量初始数据。
- 不将所有链接强制转本地；维护已捕获路径清单。跨路径使用完整本地导航是 SSR 快照常用适配，保留 modifier click、新窗口与锚点。
- 注入脚本不要因 MutationObserver 不断修改自身而形成循环。SSR 节点已出现不意味着 React 事件已经绑定。
