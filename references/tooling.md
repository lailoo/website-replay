# 多页工具契约

## 配置与执行

`scripts/site.mjs` 提供 discover、checklist、capture、verify、serve 五个子命令，第二个参数是 JSON 配置。路径相对配置文件解析；`scenarios` 的键为准确 pathname + query，值为可信本地 ES module 文件，导出 `async function(page)`。入口无需安装到技能目录才能执行。

| 字段 | 含义 |
| --- | --- |
| `url` | 同 origin 发现/捕获的起点，不带凭据 |
| `out` | 产物根目录，每个网站/快照版本使用独立目录 |
| `resourcePrefixes` | 要保存的同源 GET 路径前缀；先从网络观察确定 |
| `rawBytePrefixes` | 使用匿名 fetch 重取原始字节的已观察资源 |
| `blockedPrefixes` | 捕获时明确阻止的同源请求，如已识别遥测、认证 API |
| `startUrls` | 已确认的额外页面/状态入口，可带 query |
| `sitemaps` | 同源 urlset XML 地址列表；不会自动递归 sitemap index |
| `includePrefixes` / `excludePrefixes` | 页面发现范围，排除优先；显式列表替换默认值 |
| `includePaths` | 可选的准确 pathname 白名单，适合有限范围的验证 |
| `followQueryLinks` | 默认 false，记录 query 链接但不自动入队，避免组合爆炸 |
| `statePathPatterns` | 用于独立页分类的正则删除模式；不影响实际抓取 URL |
| `maxPages` | 每轮最多探查/捕获项数，默认 25；不代表整个网站页数 |
| `scenarios` | 路由到场景 module 的映射，在源站及本地重复执行并断言 |
| `viewport` | 本轮捕获和对比的统一视口，默认 1440 × 1000 |
| `settleMs` | 场景后的等待；重要异步请求应在场景内等待明确条件 |
| `scroll` / `maxScrollSteps` | 发现阶段的页面滚动，默认开启，上限 20 步；嵌套容器需适配 |
| `delayMs` | 每次发现导航后的间隔，默认 150ms；按源站要求增加 |
| `localBase` | 清单里的预期服务地址，默认 `http://127.0.0.1:5180` |

示例中 `resourcePrefixes: ["/"]` 为演示配置，不意味着应保存账号接口或所有请求。通用工具不导入 Cookie、存储状态和凭据。

## 产物和恢复

`inventory.json` 是清单事实来源，`CHECKLIST.md` 每次 checkpoint 自动生成。每个记录保留来源链接、控件、观察到的请求、页面归属、捕获结果和验证结果。这里的入口是观察到的链接，只有场景实际点击并断言时才有点击跳转证据。

每次捕获尝试写入新的 `snapshots/<id>-<attempt>`，不覆盖旧快照。通过项在配置和场景指纹不变时跳过；改变已捕获项的设置时，使用新输出目录，以免旧截图与新设置混用。失败项下次重试，旧失败证据保留。不要同时运行多个写同一输出目录的进程。

发现队列耗尽仅记为 `queue-exhausted-within-policy`，不是全站功能穷举完成。捕获场景切换到新 URL 时会追加该 URL 到队列；不改变 URL 的状态需由场景断言和截图证据记录。再次运行 discover 可以补充新条目的控件/入口观察。

## 验证与退出码

verify 启动临时本地服务，在新 context 中阻止所有非本地网络。逐页检查资源哈希、主文档、正确 MIME、图片加载、JS/网络错误，再重复配置的场景并与捕获时截图比较。结束时关闭临时浏览器和服务。

清单中的 `passed` 只指这次已记录的检查。`scenario: false` 表示没有场景测试，不能认为交互已通过；`visual` 含差异像素、尺寸错误或待审状态。脚本不自动把动画差异判为可接受，也不自动忽略远程请求。

capture/verify 有失败、未捕获项或未通过项时退出码为 1。discover 在正常达到预算时保存不完整状态并正常退出；调用方必须检查 `discoveryStatus`，不能只检查退出码。

serve 精确匹配页面和资源 query，未捕获 API 返回 501，其他缺失路径返回 404。它不会重写原站绝对链接、runtime、RSC 或跨域请求，遇到这些情况应按捕获与回放参考文档添加站点适配。检测到同 URL 不同资源版本或重复最终页面时拒绝启动，需要先解决版本或路由冲突。

配置了原站到本地适配后，保存 `source.html` 不变，只修改 `index.html` 或明确的适配模块。适配代码和验证脚本属于开源工具；捕获的原站资产不应随工具一起发布。
