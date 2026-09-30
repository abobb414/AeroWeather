# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.0.4] - 2026-09-30

### 新增

- **彩云天气改由服务端代理取数，Token 不再进入任何静态文件。**

  本站是纯静态站：任何进部署目录的文件都是公网可 `curl` 下载的。`js/config.local.js`
  里的真 Token 曾因此在公网裸奔三天（2026-09-29 核对部署时才发现，自首次发版起一直如此）。
  当时把它加进了 `.vercelignore` 止血，代价是**线上再也拿不到 Token** ——
  `HAS_CAIYUN` 恒为 false，连请求都不发，页脚如实写着 Open-Meteo。这是必然结果，不是故障。

  现在新增 `api/caiyun.js`（Vercel Serverless Function）承接这条链路：

  | 场景 | 取数通道 | Token 位置 |
  |---|---|---|
  | 本地开发 | JSONP 直连彩云 | `js/config.local.js`（不入库、不部署） |
  | 线上 | 同源 `/api/caiyun` 代理 | Vercel 环境变量 `CAIYUN_TOKEN`（Encrypted） |

  于是彩云特有的**国标 AQI** 与**一句话预报**重新回到线上，而公网拿不到 Token。

### 工程

- 代理的四条硬约束，缺一条都是事故：
  1. `?p=` 只放行锚定正则匹配的彩云坐标路径（`/经度,纬度/(weather|realtime|forecast).json`），
     否则它是一台「拿本项目额度给全网打工」的开放代理，同时是 SSRF 入口；
  2. 未配置 Token 时明确返回 503 并说明原因，**不写兜底值假装成功**；
  3. **失败响应一律 `no-store`**，成功才下 `s-maxage=300` —— 否则一次 429 会被 CDN
     放大成整段 TTL 的持续不可用；上游状态码与 body 原样透传，退避逻辑留给前端；
  4. `/api/caiyun?health=1` 探活端点，让前端在发业务请求前就知道通道通不通。
- 前端 `fetch` **不要**加 `cache: 'no-store'` —— 它会让浏览器带上 `Cache-Control: no-cache`
  请求头，把上面那条 CDN 缓存整个绕过（`curl` 侧看着 MISS→HIT 一切正常，浏览器请求却永远回源，
  等于白设）。响应头只有 `s-maxage` 没有 `max-age`，浏览器本来就不缓存，拿掉无副作用。
- 换 Token 从此只动环境变量，不碰代码：
  `vercel env rm CAIYUN_TOKEN production` → `printf '%s' "$T" | vercel env add CAIYUN_TOKEN production`
  → 重新部署。
- `js/config.example.js` 重写为「只给本地开发用」，并说明线上走环境变量。

## [1.0.3] - 2026-09-30

### 变更

- **站点图标整套重做**。原先 `favicon.ico` 只有 16 / 32 / 48 三档，最大帧 48px，
  再往上都是放大插值 —— 在大尺寸场景（书签栏、标签页切换器、分享卡片）下发虚。

  现从 icons8 官方 `pulsar-color / partly-cloudy-day` 的 **1600px 源图**原样等比缩放重出：

  | 文件 | 规格 |
  |---|---|
  | `favicon.ico` | 七档 16 / 24 / 32 / 48 / 64 / 128 / **256**（256 为原生帧，非放大） |
  | `favicon.svg` | **新增**，内嵌位图，浏览器优先取它，任意尺寸不糊 |
  | `favicon-16.png` · `favicon-32.png` | 与 ICO 的对应帧**逐像素差 0** |
  | `favicon-180.png` | apple-touch，不透明底（iOS 会把透明区渲成黑块） |

- 页面改为五条 `<link>` 且全部带 `?v=2` —— 浏览器对 favicon 的缓存极其顽固，
  只换文件不改 URL 可能几个月看不到新图标。`storm.html` 原先**一个图标都没有**，一并补上。

### 说明

- **源图右侧本身是被裁的**：icons8 CDN 上这一 slug 的 16 / 32 / 64 / 256 / 512 / 1024 / 1600
  **每一档**最右一列都还有内容（云的右侧圆角切在画布外），同族的 `clouds`、
  `partly-cloudy-day--v1/--v2` 亦然。按「以源图为准」的原则原样采用，未做补画或对齐裁切。
- 因此新版在同一像素尺寸下会比旧版**略小约 5%** —— 旧图是在同一张被裁的图上又放大约 5%，
  新图回到源图原始构图，这是必然结果。
- 该图标描边为深靛蓝，**在深色标签栏上本就几乎看不见** —— 新旧一致，非本次引入。

### 工程

- 回归测试 A 段的静态资源清单补上 `assets/favicon.svg`（新增资源必须一起守）。
- 软化「数据源标注为彩云」这条断言：彩云是**外部依赖**，试用版 Token 会限流
  （实测 2026-09-30 返回 `{"status":"failed","error":"Rate limit exceeded"}`），
  此时页面正确地降级到 Open-Meteo 并如实标注 —— 这本来就是设计行为，不该判 FAIL。
  现在先独立探一次彩云可用性再决定断言强度：**可用则必须标彩云**（守住「本地有 Token
  就必须真的走彩云」，防止链路悄悄断掉），**不可用则只要求页脚如实标注了某个源**
  （不能空白、不能写死）。与「紫外线必须来自 Open-Meteo」是同一路数 ——
  **结果随环境漂移的断言，比没有断言更糟**。

## [1.0.2] - 2026-09-29

### 修复

- **刷新瞬间视口上下各闪一条亮带，几秒后自行消失**：起因是「贴边渲染 tint 采样带」
  （`.sky-edge-tint`）带了 `transition: background-color 3s`。天空层用的是
  `linear-gradient`（即 `background-image`），而 **CSS 不对渐变做插值** —— 天色一变
  它是一步跳到位；采样带却是纯色 `background-color`，**会**插值，于是它要花 3 秒去追
  一个早就跳完的天空。这 3 秒里带色与身后天色相差几十个色阶，观感就是上下两条亮带，
  追平即「消失」。天气数据回来后把天色从晴天基准切到真实天气的那一下，每次加载必现。
  另删掉 `.sky-backdrop` 上那句 `transition: background 3s` —— 对渐变根本不生效，
  留着反而会制造「天空硬跳、带子平滑」的反向不同步。`storm.html` 有同样两处，一并删。

### 工程

- `test/edge-tint.mjs` 新增 **E 段**（40 → 44 条）：主动制造跨昼夜跳变
  （`__skyTime(14) → (1) → (14)`），以 `requestAnimationFrame` 逐帧比对待色与天空渐变
  端点色，断言全程 ≤8 色阶；并配一条前置断言「天色确实出现过 ≥2 种端点色」，
  避免天色恒定场景下这条断言永远为绿。原先 D 段那种稳态像素 A/B 比对拦不住它
  （稳态下 maxΔ=2 一切正常），瞬态完全落在盲区。

## [1.0.1] - 2026-09-29

### 修复

- **移动端滚动时玻璃水珠 / 窗外粒子反复刷新**：`glass-layer.js` 与 `scene-weather.js`
  的 `resize()` 原先照单全收 `window.innerHeight`（视觉视口）并每次都重新播种粒子。
  移动端滚动收放地址栏与工具栏时该值会在约 100px 区间反复跳动、连带狂发 resize，
  于是「滚一下换一批水珠」；桌面没有工具栏收展，复现不出来。
  现在高度**只增不减**，且**只有宽度变化（含横竖屏）才重建** —— 单纯长高时按比例平移
  已有水珠并补铺水膜，一颗不重播。

### 变更

- **图层序调整**：正文与 logo 整块浮到玻璃水珠之上（`.sheet` / `.brand-bar`
  `z-index: 50` > 水珠 `40`）。此前水珠压在报告正文与站名字标上，笔画发虚；
  现在水珠只糊在字与字的空处，可读性优先。两层均为透明底，水珠照旧满屏可见。
  搜索框随 `.sheet` 一并浮起，下拉结果不再被水珠遮挡。

### 工程

- 新增 `test/layers.mjs`（33 条断言）：图层序（含沿祖先链检查层叠上下文）、
  视口抖动下游珠与窗外粒子身份不变、反向断言「宽度变化必须重建」；
  图层序另有一条不读 `z-index` 的端到端像素判据（把玻璃层刷成品红后量文字墨色占比）。
- `weather.js` 暴露 `window.__glassLayer` / `window.__sceneWeather` 调试句柄，
  与 `storm.js` 的暴露方式对齐，便于自动化断言。
- **（同日补充）`config.local.js` 此前会被一并部署到 CDN**：`.vercelignore` 只排除了
  `test` / `shots` / `.workbuddy`，而 `.gitignore` 里那行 `js/config.local.js` 对 Vercel
  无效 —— 结果是 `https://weather.abobb.com/js/config.local.js` 可直接下载，里面的彩云
  Token 暴露在公网。现已加 `**/config.local.js` 排除并重新部署（该 URL 现返回 404）。
  ⚠️ 纯静态站无法真正隐藏前端 Token，本仓库的做法是「不上传、本地才启用彩云」，
  线上因此回落到 Open-Meteo（页脚如实标注数据源）。要同时兼顾安全与彩云能力，
  需把请求移到自建 Worker 代理，把 Token 放在服务端环境变量里。

## [1.0.0] - 2026-09-29

第一个正式版。零构建、无依赖的纯静态天气看板：彩云天气驱动，三层 Canvas 视觉体系，
毛玻璃质感与玻璃水珠特效。

### 核心视觉

- **三层 Canvas 渲染体系**：动态天空渐变层（按小时插值 + 按天气调制）、窗外世界层
  （雨 / 雪 / 闪电 / 星空 / 雾霾）、玻璃水珠层（近景精灵化水珠），视差纵深。
- **玻璃水珠**：六层不透明度拆为「全屏统一量 × 逐珠量」，烘进 24 枚离屏精灵，
  一帧一次 `drawImage`；水珠带真实折射取景（能看见身后的天空）、暗边、玻璃水膜与
  挂珠合并滑落。
- **闪电状态机**：逐帧状态驱动（无定时器句柄，天然无泄漏），分叉用递归生成，
  三层描边（蓝紫辉光 → 白锐核心 → 紫色余辉）。
- **强对流实验台** `storm.html`：独立页面，可自由切换天气 / 时刻 / 定格闪电，
  带焦点虚化平滑过渡。

### 数据与功能

- **数据源三级降级**：彩云天气（JSONP 绕 CORS，国标 AQI + 一句话预报）→
  Open-Meteo（免 Key 兜底）→ 本地示例数据（页脚如实标注）。
- **国标 AQI**：优到严重渐变标尺 + 游标取色，随空气质量滑动。
- **动态天空绑定真实日出日落**：黎明 / 黄昏分段锚点按当地 `sunrise/sunset` 重排
  （彩云 `daily.astro` / Open-Meteo），未注入时回落内置默认值。
- **墨色自适应**：`<html data-ink>` 由天空亮度驱动，logo 与图标走 CSS mask +
  `currentColor` 跟随变色。
- **本地城市检索**：全国 34 省 / 363 市 / 2855 区县离线库（含中心点，gzip 53 KB），
  剥离行政区划通名后缀匹配 + 层级加权评分；在线 geocoding 兜底，简繁字形变体并发查询。
- **iOS 26 工具栏白条绕法**：两条视口边缘纯色采样带，喂饱 Safari 26 的 DOM
  tint 采样器（该机制已作为 Bug 325446 提交给 WebKit）。

### 工程

- **零构建**：无打包器、无包管理，任意静态服务器直接打开。
- **回归测试**：Playwright 全站回归 + 水珠设计值断言 + 强对流实验台专项，
  含「摘掉修复必须变红」的反向验证约定。
- **密钥外置**：彩云 Token 走 `config.example.js` 模板 + `config.local.js`
  （gitignore），页面优雅降级并给出配置指引。

[1.0.3]: https://github.com/abobb414/AeroWeather/releases/tag/v1.0.3
[1.0.2]: https://github.com/abobb414/AeroWeather/releases/tag/v1.0.2
[1.0.1]: https://github.com/abobb414/AeroWeather/releases/tag/v1.0.1
[1.0.0]: https://github.com/abobb414/AeroWeather/releases/tag/v1.0.0
