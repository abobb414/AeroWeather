/**
 * 彩云天气 · 服务端代理（Vercel Serverless Function）
 *
 * 存在的唯一理由：把 Token 藏起来。
 *
 * 2026-09-29 事故：本站是纯静态站，任何进入部署目录的文件都是公网可
 * `curl` 下载的 —— `js/config.local.js` 里的真 Token 因此裸奔了三天
 * （`.gitignore` 那一行管不到 Vercel，必须靠 `.vercelignore`）。
 * 静态站没有「藏密钥」这个选项，所以彩云通道改由这个函数转发：
 *
 *     Token  → Vercel 环境变量 CAIYUN_TOKEN（不进任何静态文件）
 *     前端   → 同源 `/api/caiyun`，拿到普通 JSON，连 JSONP 都不需要了
 *
 * 🔴 路径白名单不是可选项。少了它这就是一台「拿我的额度给全网跑彩云」
 *    的开放代理（也是 SSRF 入口）。`p` 只允许是彩云的坐标路径。
 * 🔴 这里不写任何 Token 兜底值。环境变量没配就明确返回 503，
 *    让前端降级并如实标注数据源，绝不假装成功。
 */
const CAIYUN_BASE = 'https://api.caiyunapp.com/v2.6';

// 只放行 /经度,纬度/(weather|realtime|forecast).json 及其查询串。
// 各段单独锚定，杜绝 `../` 穿越、跨 host 跳转与任意路径拼接。
const PATH_RE =
  /^\/-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?\/(?:weather|realtime|forecast)\.json(?:\?[^#]*)?$/;

const sendJson = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
};

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const token = process.env.CAIYUN_TOKEN;

  // 探活：前端在发业务请求之前先问一句「这条通道通不通」。
  // 不通就不必浪费一次彩云配额去试（也省掉一次必然失败的往返）。
  if (url.searchParams.has('health')) {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 200, { ok: true, hasToken: Boolean(token) });
  }

  if (!token) {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 503, {
      status: 'failed',
      error: 'CAIYUN_TOKEN 未配置（在 Vercel 项目设置里加环境变量）',
    });
  }

  const pathAndQuery = url.searchParams.get('p') || '';
  if (!PATH_RE.test(pathAndQuery)) {
    res.setHeader('Cache-Control', 'no-store');
    return sendJson(res, 400, { status: 'failed', error: 'invalid path' });
  }

  try {
    const upstream = await fetch(`${CAIYUN_BASE}/${token}${pathAndQuery}`, {
      signal: AbortSignal.timeout(8000),
    });
    const body = await upstream.text();

    // 原样透传：限流（429）的语义必须留给前端那套「串行 + 指数退避」去处理，
    // 这里私自吞掉或改写只会让上层误判成业务错误。
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 彩云试用版配额很紧，同一城市 5 分钟内命中 CDN 就别再打扰上游。
    // 🔴 失败一律不缓存 —— 否则一次 429 会被 CDN 放大成整整 5 分钟的持续不可用。
    res.setHeader('Cache-Control', upstream.ok
      ? 'public, s-maxage=300, stale-while-revalidate=600'
      : 'no-store');
    res.statusCode = upstream.status;
    res.end(body);
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    sendJson(res, 504, {
      status: 'failed',
      error: 'upstream ' + ((err && err.name) || 'error'),
    });
  }
};
