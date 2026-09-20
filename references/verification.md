# 离线与视觉验收

## 独立上下文

使用新 browser context，并禁用 service worker。仅允许任务的本地 origin，记录所有远程请求并阻断。`localhost` 本身不足以保证请求去了正确端口。

```js
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [], failures = [], remote = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => {
  if (r.status() >= 400) failures.push({ url: r.url(), status: r.status() });
});
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === localOrigin) return route.continue();
  remote.push(url.href);
  return route.abort();
});
```

必须逐项解释剩余远程请求；不能把未加载字体、图片或数据归为“正常遥测”。更强的验收可记录 WebSocket、worker 和浏览器网络日志，按网站使用情况选择。

## 交互证据

- 等目标标签 `aria-selected=true`，而非仅等待固定毫秒数。
- 检查模型数量、已知模型、合理坐标值和高亮 opacity。SVG 存在、点数大于零都不能证明数据完整。
- 切换全部任务相关标签并检查内容或轴语义变化。
- 搜索已知模型，切换选择并核对点集合变化，重置后核对恢复。
- 检查固定高亮与 hover/legend 交互；点离开后应恢复正确状态。
- 展开/折叠说明、过滤器与设置；验证 `aria-expanded`/`aria-checked` 及实际效果。
- 下载 PNG 检查签名、尺寸、非空内容；CSV/JSON 检查解析、表头和行数。保留实际权限限制，不能用认证弹窗通过来宣称数据下载已实现。
- 刷新带 query 的直接链接，检查状态恢复与原路径。

## 视觉证据

桌面 1440、平板 768、手机 390 是常用起点，按任务调整。原站和本地应使用相同 viewport、缩放、滚动、选中模型、展开状态、字体加载完成条件。

保存整页与局部截图。检查标题裁切、菜单覆盖、图例换行、轴标签和点位、字体图标、颜色、固定导航。`scrollWidth <= innerWidth` 只能证明页面不横向溢出，不能证明局部文字未被裁切或遮挡。

发现差异时使用 [difference-diagnosis.md](difference-diagnosis.md) 的顺序与记录格式。区分有证据的快照差异、已授权的视图适配、原站已有问题、后台范围限制和需要修复的本地缺陷。

对于 canvas/WebGL 内容，检查像素非空、场景 framing、动画/交互及资产加载；截图正常不代表导出图片正常。原站本身的布局缺陷应记录并保留，除非用户要求优化。

## 回归与交付

新增页面只测试其相关行为及共享路由风险，不无目的地重复全部测试。构建通过后启动 preview 用同一路径和关键 query 再验路由与 MIME，停止临时测试服务，保留用户要访问的 dev 服务。

报告通过/失败、剩余错误、数据捕获时间、源/本地 URL、截图路径和后台限制。线上变化、默认前沿模型变化会导致不同快照截图不一致，不能改数据凑图。
