/**
 * api.js
 * 气象数据聚合中枢 (Weather Data Aggregator)
 * 主数据源：彩云天气 Caiyun (分钟级雷达降水、国标空气质量、逐时/逐日预报)
 * 辅助源：Open-Meteo (仅在彩云逐日预报不足 7 天时补齐剩余天数)
 * 城市检索：本地中国行政区划库（js/china-cities.js，主力）
 *          + Open-Meteo Geocoding（国外城市与兜底）
 */

import { searchChinaCities } from './china-cities.js';
import { toTraditional, hasLatin } from './zh-variant.js';

// ==========================================
// 1. 全国各大区域地市导航数据底座
//    （仅内部使用：POPULAR_CITIES 取它拍平，定位失败时落在 index 0 = 北京）
// ==========================================
const REGIONAL_CITIES_NAV = [
  {
    region: '华北地区',
    cities: [
      { name: '北京', admin1: '北京市', country: '中国', lat: 39.9042, lon: 116.4074 },
      { name: '天津', admin1: '天津市', country: '中国', lat: 39.1256, lon: 117.1902 },
      { name: '石家庄', admin1: '河北省', country: '中国', lat: 38.0428, lon: 114.5149 },
      { name: '太原', admin1: '山西省', country: '中国', lat: 37.8706, lon: 112.5489 },
      { name: '呼和浩特', admin1: '内蒙古', country: '中国', lat: 40.8427, lon: 111.7492 },
    ]
  },
  {
    region: '华东地区',
    cities: [
      { name: '上海', admin1: '上海市', country: '中国', lat: 31.2304, lon: 121.4737 },
      { name: '杭州', admin1: '浙江省', country: '中国', lat: 30.2741, lon: 120.1551 },
      { name: '南京', admin1: '江苏省', country: '中国', lat: 32.0603, lon: 118.7969 },
      { name: '合肥', admin1: '安徽省', country: '中国', lat: 31.8206, lon: 117.2272 },
      { name: '福州', admin1: '福建省', country: '中国', lat: 26.0745, lon: 119.2965 },
      { name: '济南', admin1: '山东省', country: '中国', lat: 36.6512, lon: 117.1201 },
      { name: '南昌', admin1: '江西省', country: '中国', lat: 28.6829, lon: 115.8582 },
    ]
  },
  {
    region: '华南地区',
    cities: [
      { name: '广州', admin1: '广东省', country: '中国', lat: 23.1291, lon: 113.2644 },
      { name: '深圳', admin1: '广东省', country: '中国', lat: 22.5431, lon: 114.0579 },
      { name: '南宁', admin1: '广西', country: '中国', lat: 22.8170, lon: 108.3665 },
      { name: '海口', admin1: '海南省', country: '中国', lat: 20.0440, lon: 110.1999 },
      { name: '香港', admin1: '特别行政区', country: '中国', lat: 22.3193, lon: 114.1694 },
      { name: '澳门', admin1: '特别行政区', country: '中国', lat: 22.1987, lon: 113.5439 },
    ]
  },
  {
    region: '华中地区',
    cities: [
      { name: '武汉', admin1: '湖北省', country: '中国', lat: 30.5928, lon: 114.3055 },
      { name: '长沙', admin1: '湖南省', country: '中国', lat: 28.2282, lon: 112.9388 },
      { name: '郑州', admin1: '河南省', country: '中国', lat: 34.7466, lon: 113.6253 },
    ]
  },
  {
    region: '西南地区',
    cities: [
      { name: '成都', admin1: '四川省', country: '中国', lat: 30.5728, lon: 104.0668 },
      { name: '重庆', admin1: '重庆市', country: '中国', lat: 29.5630, lon: 106.5516 },
      { name: '贵阳', admin1: '贵州省', country: '中国', lat: 26.6470, lon: 106.6302 },
      { name: '昆明', admin1: '云南省', country: '中国', lat: 24.8797, lon: 102.8332 },
      { name: '拉萨', admin1: '西藏', country: '中国', lat: 29.6525, lon: 91.1721 },
    ]
  },
  {
    region: '西北与东北',
    cities: [
      { name: '西安', admin1: '陕西省', country: '中国', lat: 34.3416, lon: 108.9398 },
      { name: '兰州', admin1: '甘肃省', country: '中国', lat: 36.0611, lon: 103.8343 },
      { name: '西宁', admin1: '青海省', country: '中国', lat: 36.6171, lon: 101.7782 },
      { name: '乌鲁木齐', admin1: '新疆', country: '中国', lat: 43.8256, lon: 87.6168 },
      { name: '沈阳', admin1: '辽宁省', country: '中国', lat: 41.8057, lon: 123.4315 },
      { name: '哈尔滨', admin1: '黑龙江省', country: '中国', lat: 45.8038, lon: 126.5350 },
    ]
  }
];

export const POPULAR_CITIES = REGIONAL_CITIES_NAV.flatMap(r => r.cities);

// ==========================================
// 2. 彩云天气 Caiyun · 数据源配置与请求通道
// ==========================================
/**
 * 两个实测结论（2026-09-25 逐条验证过，别绕开）：
 *
 * ① 浏览器直连会被 CORS 拦。`https://api.caiyunapp.com/v2.6/...` 的响应
 *    不带 Access-Control-Allow-Origin（OPTIONS 预检也不回），页面里 fetch
 *    实测 `TypeError: Failed to fetch`。官方对所有端点额外提供 JSONP 形态：
 *    把末尾改成 `weather.json` / `realtime.json` 并追加 `?callback=fn`，
 *    返回 `fn({...})`。因为它不是 fetch，浏览器不做跨域校验，可直接用。
 *
 * ② 试用版 Token 限流很紧。逐日只给 3 天（请求 dailysteps=7 也只回 3 天），
 *    逐时 24 小时；连发 6 次实测只成功 1~3 次，超限返回
 *    `{status:"failed", error:"Rate limit exceeded"}`（HTTP 429）。
 *    因此这里强制「串行队列 + 429 指数退避 + 10 分钟本地缓存」，
 *    任何一步都不能改回并发。
 *
 * Token 不写死在这里。取值顺序：
 *   ① `js/config.local.js` 注入的 `window.__CAIYUN_TOKEN__`（**该文件不入库**，
 *      见 README「本地运行」；仓库里只提供 config.example.js 模板）；
 *   ② 都没有时落到下面的占位符，页面会提示未配置。
 * Token 申请：https://dashboard.caiyunapp.com/
 */
const FALLBACK_CAIYUN_TOKEN = 'YOUR_CAIYUN_TOKEN';

export const CAIYUN_TOKEN =
  (typeof window !== 'undefined' && window.__CAIYUN_TOKEN__) || FALLBACK_CAIYUN_TOKEN;

/** Token 是否为真实可用值（占位符视为未配置，UI 据此给出提示） */
export const hasCaiyunToken = () =>
  Boolean(CAIYUN_TOKEN) && CAIYUN_TOKEN !== FALLBACK_CAIYUN_TOKEN;

const CAIYUN_BASE = 'https://api.caiyunapp.com/v2.6';
const CAIYUN_CACHE_KEY = 'aeroweather_caiyun_cache_v1';

/**
 * Open-Meteo：完全免费、免 Key、带 Access-Control-Allow-Origin，浏览器可直接 fetch。
 * 定位为「保底的真实数据源」——没有彩云 Token、或彩云被限流/挂掉时接管，
 * 保证页面永远不会把假数据当真数据展示（详见第 5 节 fetchOpenMeteoWeather）。
 */
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_AIR_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const CAIYUN_TTL_FRESH = 10 * 60 * 1000;      // 10 分钟内直接用缓存，一次请求都不发
const CAIYUN_TTL_STALE = 6 * 60 * 60 * 1000;  // 被限流时可退回 6 小时内的旧数据
const CAIYUN_MAX_RETRY = 3;
const CAIYUN_CACHE_MAX_CITIES = 12;

/** 彩云 skycon 天气现象 → WMO 代码（本站图标与文案体系全部基于 WMO） */
const SKYCON_TO_WMO = {
  CLEAR_DAY: 0, CLEAR_NIGHT: 0,
  PARTLY_CLOUDY_DAY: 2, PARTLY_CLOUDY_NIGHT: 2,
  CLOUDY: 3,
  LIGHT_HAZE: 45, MODERATE_HAZE: 45, HEAVY_HAZE: 45,
  FOG: 45,
  DUST: 30, SAND: 31,
  WIND: 3,
  LIGHT_RAIN: 61, MODERATE_RAIN: 63, HEAVY_RAIN: 65, STORM_RAIN: 82,
  LIGHT_SNOW: 71, MODERATE_SNOW: 73, HEAVY_SNOW: 75, STORM_SNOW: 86,
};

const skyconToWmo = (skycon) => SKYCON_TO_WMO[String(skycon || '').toUpperCase()] ?? 3;
const skyconIsNight = (skycon) => /_NIGHT$/.test(String(skycon || '').toUpperCase());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 彩云链路的总时间预算：超时就降级，不允许单条链路的反复重试拖住整页首屏 */
const CAIYUN_DEADLINE_MS = 6000;

/**
 * 给一个 promise 套上「限时」。
 * 落败分支之后即使 reject 也已被 race 内部订阅，不会冒成 unhandledRejection；
 * 彩云那次请求本身会自然跑完并写入缓存，下次加载直接命中，配额不算白花。
 */
const withDeadline = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label}超过 ${ms / 1000}s 未返回`)), ms);
  }),
]);

/**
 * 彩云返回的是「带时区偏移的 ISO 串」（如 2026-09-25T20:00+08:00）。
 * 看板里的逐时/逐日组件按「本地墙上时间」渲染，所以统一转成
 * 无时区的 YYYY-MM-DDTHH:mm，语义与 Open-Meteo 的返回保持一致。
 */
function isoToLocalNaive(iso) {
  const abs = new Date(iso).getTime();
  if (Number.isNaN(abs)) return '';
  const localMs = abs - new Date().getTimezoneOffset() * 60000;
  return new Date(localMs).toISOString().slice(0, 16);
}

let jsonpSeq = 0;

/** JSONP 取数：解析失败 / 脚本加载失败 / 超时都会 reject，并清理全局回调 */
function caiyunJsonp(pathAndQuery, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const cbName = `__caiyun_cb_${Date.now().toString(36)}_${++jsonpSeq}`;
    const sep = pathAndQuery.includes('?') ? '&' : '?';
    const script = document.createElement('script');
    let timer = null;

    const cleanup = () => {
      clearTimeout(timer);
      try { delete window[cbName]; } catch { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    };

    window[cbName] = (payload) => {
      cleanup();
      resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('彩云接口网络不可达'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('彩云接口请求超时'));
    }, timeout);

    script.src = `${CAIYUN_BASE}/${CAIYUN_TOKEN}${pathAndQuery}${sep}callback=${cbName}`;
    script.async = true;
    document.head.appendChild(script);
  });
}

// 串行队列：限流窗口很窄，并发只会互相挤掉配额
let caiyunChain = Promise.resolve();

/** 发起一次彩云请求（自动串行 + 限流退避重试） */
function caiyunRequest(pathAndQuery) {
  // Token 没配就直接报清楚原因，别让用户对着 JSONP 的 404 猜
  if (!hasCaiyunToken()) {
    return Promise.reject(new Error(
      '未配置彩云 Token：请复制 js/config.example.js 为 js/config.local.js 并填入自己的 Token'
    ));
  }
  const run = async () => {
    let lastErr = null;
    // 网络类错误（不可达 / 超时）单独计数：兜底源是即时的，让用户多盯几秒空白页
    // 只为重试一个可能根本不存在的网络抖动并不划算，所以只给一次机会。
    // 与此相对，限流是「等一会儿再来」就好的错误，仍按指数退避多试几次。
    let netRetry = 0;

    for (let attempt = 0; attempt <= CAIYUN_MAX_RETRY; attempt++) {
      let payload;
      try {
        payload = await caiyunJsonp(pathAndQuery);
      } catch (netErr) {
        lastErr = netErr;
        if (netRetry++ < 1) {
          await sleep(600);
          continue;
        }
        throw netErr;
      }

      if (payload && payload.status === 'ok' && payload.result) return payload;

      const msg = (payload && payload.error) || '彩云接口返回异常';
      lastErr = new Error(msg);
      if (/rate limit/i.test(msg) && attempt < CAIYUN_MAX_RETRY) {
        await sleep(1200 * Math.pow(2, attempt));   // 1.2s → 2.4s → 4.8s
        continue;
      }
      // 其余业务错误（Token 无效等）重试没有任何意义，立刻放弃交给兜底源
      throw lastErr;
    }
    throw lastErr || new Error('彩云接口请求失败');
  };

  const queued = caiyunChain.then(run, run);
  caiyunChain = queued.catch(() => {});   // 队列自身不因单次失败而中断
  return queued;
}

// ---- 本地缓存（限流的最后一道缓冲：命中就不发请求） ----
let caiyunCacheMem = null;

function loadCaiyunCache() {
  if (caiyunCacheMem) return caiyunCacheMem;
  try {
    caiyunCacheMem = JSON.parse(localStorage.getItem(CAIYUN_CACHE_KEY) || '{}') || {};
  } catch {
    caiyunCacheMem = {};
  }
  return caiyunCacheMem;
}

function readCaiyunCache(key, maxAge) {
  const all = loadCaiyunCache();
  const hit = all[key];
  if (!hit || !hit.data) return null;
  if (Date.now() - (hit.at || 0) > maxAge) return null;
  return hit.data;
}

function writeCaiyunCache(key, data) {
  const all = loadCaiyunCache();
  all[key] = { at: Date.now(), data };
  const keys = Object.keys(all);
  if (keys.length > CAIYUN_CACHE_MAX_CITIES) {
    keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
    keys.slice(0, keys.length - CAIYUN_CACHE_MAX_CITIES).forEach((k) => delete all[k]);
  }
  try {
    localStorage.setItem(CAIYUN_CACHE_KEY, JSON.stringify(all));
  } catch {
    caiyunCacheMem = null;   // 配额写满就丢缓存，不影响主流程
  }
}

// ==========================================
// 3. 城市搜索与地理逆编码
// ==========================================
/** 港澳台前缀：这些地区的 country 字段在 GeoNames 里是地区名，必须归到「中国」 */
const HMT_RE = /^(台湾|台灣|臺灣|香港|澳门|澳門)/;

/** 在线结果规范化：统一字段名，并把港澳台的归属纠正为「中国」 */
function normalizeOnlineResult(item) {
  const name = item.name || '';
  const hmt = HMT_RE.test(name);
  return {
    name,
    admin1: item.admin1 || '',
    // 绝不允许出现像是独立国家/地区的标注
    country: hmt ? '中国' : (item.country || ''),
    lat: item.latitude,
    lon: item.longitude,
    population: item.population || 0,
  };
}

/**
 * Open-Meteo Geocoding 检索（国外城市与本地库兜底）。
 *
 * ⚠️ GeoNames 把地级市登记成「大连市」，搜「大连」时不做后缀归一化，
 *    返回的全是各地同名小地方，真正的大连市反而不出现。
 *    所以这里并发补一次「原词 + 市」，再按 population 降序 ——
 *    真城市都有人口数据，同名小地方没有，大城市自然浮到最前。
 */
async function searchCitiesOnline(q) {
  const base = 'https://geocoding-api.open-meteo.com/v1/search';

  // 变体：原词 + 繁体 + 补「市」。 GeoNames 的中文别名简繁混杂
  // （「东京」查不到日本，「東京」才行；反过来「洛杉磯」又不如「洛杉矶」），
  // 单发一个请求必定漏，所以并发多发几个再合并，让人口数决定胜负。
  const variants = new Set([q]);
  if (!hasLatin(q)) {
    variants.add(toTraditional(q));
    if (!/[省市区县旗州]$/.test(q)) variants.add(`${q}市`);
  }

  const batches = await Promise.all([...variants].map((v) => fetch(
    `${base}?name=${encodeURIComponent(v)}&count=8&language=zh&format=json`,
  )
    .then((res) => (res.ok ? res.json() : null))
    .then((d) => (d && d.results) || [])
    .catch(() => [])));

  const map = new Map();
  batches.flat().forEach((item) => {
    if (!item || !item.name) return;
    const r = normalizeOnlineResult(item);
    const key = `${r.name}|${r.admin1}`;
    if (!map.has(key)) map.set(key, r);
  });

  const sorted = Array.from(map.values()).sort((a, b) => b.population - a.population);

  // 已经出现百万级大城市时，把那些连同名小地方都算不上的噪声滤掉
  //（典型如「莫斯科」：正确答案只有一条，后面却跟着七个美国小镇）。
  if (sorted.length && sorted[0].population >= 1e6) {
    const meaningful = sorted.filter((c) => c.population >= 1e5);
    if (meaningful.length) return meaningful;
  }
  return sorted;
}

/**
 * 城市检索入口。
 * ① 本地中国行政区划库优先 —— 覆盖全国省/市/区县，离线、零延迟、中文匹配准；
 *    有结果就直接返回，不再打网络（既快，也避开在线源的限流）。
 * ② 本地无结果才走在线，主要服务国外城市。
 */
export async function searchCities(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const local = await searchChinaCities(q, 8);

  // 本地命中了「省或市」就是硬答案（如「大连」→ 大连市），直接返回：
  // 又快，也避免为一次已经确定的查询去打扰在线源。
  if (local.some((c) => c.level <= 2)) return local;

  let online = [];
  try {
    online = await searchCitiesOnline(q);
  } catch (err) {
    console.warn('在线城市检索失败:', err);
  }
  if (!online.length) return local;

  // 走到这里说明本地最多只匹到区县（如「浦东」「鼓楼」），或者压根没匹到。
  // 若在线结果里存在真正的大城市，用户找的多半是它 ——
  // 「东京」在本地库里是江苏/浙江的区县，而答案其实是 973 万人口的日本东京。
  const big = online.filter((c) => c.population >= 2e6);
  const small = online.filter((c) => c.population < 2e6);
  return [...big, ...local, ...small].slice(0, 8);
}

// ==========================================
// 4. 数据源实现：彩云天气（主源）+ Open-Meteo（补足逐日）
// ==========================================

/*
 * 日出日落 → 天空锚点用的「当地时钟小数小时」。
 *  - 彩云 astro 形如 ["06:12","17:45"]
 *  - Open-Meteo（timezone=auto）形如 ["2026-09-27T06:12", ...]
 * 都取字符串尾部的 HH:MM 换算，不做跨时区换算 —— 页面全程按浏览器
 * 本地时钟走（定位场景下城市时区=浏览器时区），口径一致。
 */
function parseAstro(pair) {
  const toHour = (s) => {
    const m = /(\d{1,2}):(\d{2})\s*$/.exec(String(s || ''));
    if (!m) return NaN;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return NaN;
    return h + min / 60;
  };
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const sunrise = toHour(pair[0]);
  const sunset = toHour(pair[1]);
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset)) return null;
  return { sunrise, sunset };
}

/** 把彩云 weather 响应规范化成本站统一的内部数据模型 */
function normalizeCaiyun(payload) {
  const result = payload.result || {};
  const rt = result.realtime || {};
  const air = rt.air_quality || {};
  const hourly = result.hourly || {};
  const daily = result.daily || {};

  const mapArr = (arr, fn) => (Array.isArray(arr) ? arr.map(fn) : []);
  const hourTimes = mapArr(hourly.temperature, (o) => isoToLocalNaive(o.datetime));
  const dayTimes = mapArr(daily.temperature, (o) => isoToLocalNaive(o.date).slice(0, 10));
  const uvSource = (daily.life_index && daily.life_index.ultraviolet) || [];

  return {
    sourceName: '彩云天气 Caiyun',
    // 彩云招牌的「一句话预报」，例如「晴，今天晚间22点钟后转小雨」
    keypoint: result.forecast_keypoint || '',
    weather: {
      current: {
        time: new Date().toISOString(),
        temperature_2m: Number(rt.temperature),
        relative_humidity_2m: Math.round((Number(rt.humidity) || 0) * 100),
        apparent_temperature: Number(rt.apparent_temperature),
        is_day: skyconIsNight(rt.skycon) ? 0 : 1,
        precipitation: Number(rt.precipitation && rt.precipitation.local && rt.precipitation.local.intensity) || 0,
        weather_code: skyconToWmo(rt.skycon),
        // 彩云给的是帕斯卡，本站统一按百帕展示
        surface_pressure: Math.round((Number(rt.pressure) || 0) / 100),
        wind_speed_10m: Number(rt.wind && rt.wind.speed) || 0,
        wind_direction_10m: Number(rt.wind && rt.wind.direction) || 0,
        skycon: rt.skycon || '',
      },
      hourly: hourTimes.length ? {
        time: hourTimes,
        temperature_2m: mapArr(hourly.temperature, (o) => Number(o.value)),
        weather_code: mapArr(hourly.skycon, (o) => skyconToWmo(o.value)),
        // 彩云 v2.6 的 probability 实测就是百分数（如 60 表示 60%），
        // 2026-09-26 打接口核对：晴天时段为 0、有雨时段为 60。
        // 早期按「0~1 小数」又乘了一次 100，导致界面出现 6000% 这种数值。
        // 这里只做范围收敛：确实是小数（0<p<=1）时才按比例换算，其余按百分数直接用。
        precipitation_probability: mapArr(hourly.precipitation, (o) => {
          const raw = Number(o.probability) || 0;
          const pct = raw > 0 && raw <= 1 ? raw * 100 : raw;
          return Math.max(0, Math.min(100, Math.round(pct)));
        }),
      } : null,
      daily: dayTimes.length ? {
        time: dayTimes,
        weather_code: mapArr(daily.skycon, (o) => skyconToWmo(o.value)),
        temperature_2m_max: mapArr(daily.temperature, (o) => Number(o.max)),
        temperature_2m_min: mapArr(daily.temperature, (o) => Number(o.min)),
        uv_index_max: mapArr(uvSource, (o) => Number(o.index) || 0),
      } : null,
    },
    // 彩云 daily.astro = ["06:12","17:45"]（日出/日落，当地时钟），取今天第一组。
    // 供 sky-gradient 把黎明/黄昏锚点绑到真实太阳上。
    sun: parseAstro(Array.isArray(daily.astro) && daily.astro[0]),
    airQuality: {
      current: {
        time: new Date().toISOString(),
        pm2_5: Number(air.pm25) || 0,
        pm10: Number(air.pm10) || 0,
        us_aqi: Number(air.aqi && air.aqi.usa) || 0,
        chn_aqi: Number(air.aqi && air.aqi.chn) || 0,
      },
    },
  };
}

/** 缓存键：坐标统一收敛到 3 位小数，同城不同精度不重复占用配额 */
const coordKey = (lat, lon) => `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;

/** 取某城市气象数据：10 分钟内命中缓存则一次请求都不发；被限流时退回旧缓存 */
async function fetchCaiyunWeather(lat, lon) {
  const key = coordKey(lat, lon);

  const fresh = readCaiyunCache(key, CAIYUN_TTL_FRESH);
  if (fresh) return { data: fresh, cached: true, stale: false };

  try {
    // weather 一次返回实时/逐时/逐日/空气质量，在限流下必须只发这一个请求
    const payload = await caiyunRequest(`/${lon},${lat}/weather.json?alert=true&dailysteps=7&hourlysteps=24`);
    const data = normalizeCaiyun(payload);
    writeCaiyunCache(key, data);
    return { data, cached: false, stale: false };
  } catch (err) {
    const stale = readCaiyunCache(key, CAIYUN_TTL_STALE);
    if (stale) return { data: stale, cached: true, stale: true };
    throw err;
  }
}

/**
 * 试用版 Token 的逐日预报只给 3 天，剩余天数用 Open-Meteo 全球模型补齐。
 * 彩云已经给出的日期，气温与天气现象一律以彩云为准，只追加缺失日期，最多凑满 7 天。
 *
 * ⚠️ 紫外线是「彩云优先」的唯一例外，**一律以 Open-Meteo 为准**。
 *    彩云试用版的 `daily.life_index.ultraviolet` 实测是占位值：
 *    2026-09-27 用同一坐标核对，彩云三天全部返回 `index="1" / desc="最弱"`，
 *    而同日 Open-Meteo 是 6.7 / 5.25 / 0.85。照搬会把「较强」的紫外线显示成「最弱」，
 *    所以下面按日期强行覆盖 UV；只有 Open-Meteo 整条挂掉时才退回彩云的值。
 *    （也正因如此，这里不能再用 `have.size >= 7` 提前返回省请求 —— 补天数可以省，
 *      拿 UV 不能省。）
 */
async function fillDailyFromOpenMeteo(lat, lon, daily) {
  const have = new Set((daily && daily.time) || []);

  const merged = daily ? {
    time: [...daily.time],
    weather_code: [...daily.weather_code],
    temperature_2m_max: [...daily.temperature_2m_max],
    temperature_2m_min: [...daily.temperature_2m_min],
    uv_index_max: [...daily.uv_index_max],
  } : { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], uv_index_max: [] };

  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset&forecast_days=7&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) return daily;
    const d = (await res.json()).daily || {};
    if (!Array.isArray(d.time)) return daily;

    // ① 追加彩云没覆盖到的日期（试用版只给 3 天，这里补齐到 7 天）
    d.time.forEach((t, i) => {
      if (have.has(t) || merged.time.length >= 7) return;
      merged.time.push(t);
      merged.weather_code.push(d.weather_code[i]);
      merged.temperature_2m_max.push(d.temperature_2m_max[i]);
      merged.temperature_2m_min.push(d.temperature_2m_min[i]);
      merged.uv_index_max.push(d.uv_index_max[i] ?? 0);
    });

    // ② 按日期覆盖紫外线：彩云的值是占位符，不能信（原因见函数头注释）
    const uvByDate = new Map();
    d.time.forEach((t, i) => {
      const v = Number(d.uv_index_max[i]);
      if (Number.isFinite(v)) uvByDate.set(t, v);
    });
    merged.uv_index_max = merged.time.map((t, i) => (
      uvByDate.has(t) ? uvByDate.get(t) : (merged.uv_index_max[i] ?? 0)
    ));

    // ③ 日出日落原样透传（彩云路径缺 astro 时兜底用），取今天第一组
    if (Array.isArray(d.sunrise) && Array.isArray(d.sunset)) {
      merged.sunrise = d.sunrise;
      merged.sunset = d.sunset;
    }

    return merged;
  } catch (err) {
    console.warn('Open-Meteo 补齐逐日预报失败，仅展示彩云自带天数:', err);
    return daily;
  }
}

/** Open-Meteo 空气质量：独立子域，同样免 Key */
async function fetchOpenMeteoAir(lat, lon) {
  const qs = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'pm2_5,pm10,us_aqi',
    timezone: 'auto',
  });
  const res = await fetch(`${OPEN_METEO_AIR_BASE}?${qs}`);
  if (!res.ok) throw new Error(`Open-Meteo 空气质量返回 HTTP ${res.status}`);
  const cur = (await res.json()).current || {};
  return {
    current: {
      time: new Date().toISOString(),
      pm2_5: Number(cur.pm2_5) || 0,
      pm10: Number(cur.pm10) || 0,
      // Open-Meteo 不提供国标 AQI，前端 aqiIndex 取 `chn_aqi ?? us_aqi`，
      // 这里只给 us_aqi，界面自然落到美国 AQI 口径。
      us_aqi: Number(cur.us_aqi) || 0,
    },
  };
}

/**
 * Open-Meteo 主源（免 Key 保底链路）。
 *
 * 2026-09-27 逐字段核对过：
 * ① 字段名与本站内部模型几乎一一对应，单位也一致（°C / % / hPa / km/h / mm），
 *    唯一要做的是 Number() 归一，不像彩云那样需要换算出气压、湿度量纲。
 * ② `timezone=auto` 返回的就是「本地墙上时间」字符串（如 2026-09-27T15:00），
 *    与彩云经 isoToLocalNaive 处理后的语义完全相同，**不要再做时区转换**。
 * ③ `forecast_hours=24` 实测确实从「当前小时」起算，正好对齐彩云 hourlysteps=24。
 * ④ 逐日 `uv_index_max` 直接可用，不需要另外补紫外线。
 */
async function fetchOpenMeteoWeather(lat, lon) {
  const qs = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,'
      + 'precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,sunrise,sunset',
    timezone: 'auto',
    forecast_days: '7',
    forecast_hours: '24',
  });
  const res = await fetch(`${OPEN_METEO_BASE}?${qs}`);
  if (!res.ok) throw new Error(`Open-Meteo 返回 HTTP ${res.status}`);
  const d = await res.json();

  const cur = d.current || {};
  const h = d.hourly || {};
  const dl = d.daily || {};
  const nums = (arr) => (Array.isArray(arr) ? arr.map((v) => Number(v)) : []);

  // 空气质量是另一个子域，它挂了不该拖垮整个天气链路
  let airQuality = null;
  try {
    airQuality = await fetchOpenMeteoAir(lat, lon);
  } catch (err) {
    console.warn('Open-Meteo 空气质量取数失败，本次不展示空气数据:', err);
  }

  return {
    sourceName: 'Open-Meteo',
    // 该源没有彩云那种「一句话预报」，交给前端兜底文案
    keypoint: '',
    // 今天日出/日落（当地时钟小数小时），给天空引擎绑锚点
    sun: parseAstro(Array.isArray(dl.sunrise) && dl.sunset
      ? [dl.sunrise[0], dl.sunset[0]] : null),
    weather: {
      current: {
        time: new Date().toISOString(),
        temperature_2m: Number(cur.temperature_2m),
        relative_humidity_2m: Number(cur.relative_humidity_2m),
        apparent_temperature: Number(cur.apparent_temperature),
        is_day: Number(cur.is_day),
        precipitation: Number(cur.precipitation) || 0,
        weather_code: Number(cur.weather_code) || 0,
        surface_pressure: Math.round(Number(cur.surface_pressure)),
        wind_speed_10m: Number(cur.wind_speed_10m) || 0,
        wind_direction_10m: Number(cur.wind_direction_10m) || 0,
      },
      hourly: Array.isArray(h.time) && h.time.length ? {
        time: h.time,
        temperature_2m: nums(h.temperature_2m),
        weather_code: nums(h.weather_code),
        // 与彩云路径统一收敛到 0~100 的百分数
        precipitation_probability: (h.precipitation_probability || []).map((p) => {
          const n = Number(p) || 0;
          return Math.max(0, Math.min(100, Math.round(n)));
        }),
      } : null,
      daily: Array.isArray(dl.time) && dl.time.length ? {
        time: dl.time,
        weather_code: nums(dl.weather_code),
        temperature_2m_max: nums(dl.temperature_2m_max),
        temperature_2m_min: nums(dl.temperature_2m_min),
        uv_index_max: nums(dl.uv_index_max),
      } : null,
    },
    airQuality,
  };
}

// ==========================================
// 5. 统一调度入口
// ==========================================
/**
 * 三级取数策略（顺序不能颠倒）：
 *   ① 配了 Token → 彩云（分钟级降水 + 国标 AQI，本站优选源）
 *   ② 没配 / 彩云挂了 → Open-Meteo 真实数据（免 Key）
 *   ③ 两条路都断了 → 才退回本地示例数据（isMock，前端会明确提示）
 *
 * ②这一级是 2026-09-27 补的。在此之前只有 ①③，导致「没配 Token」这种
 * 极常见的情形直接跳到假数据 —— 页面照样渲染出一整套自洽的数值
 * （23° 湿度 54% 气压 1013 全都来自 getMockWeatherReport 的硬编码），
 * 用户只有一个转瞬即逝的 toast 能察觉，极易误认为数据是真实的。
 * 任何情况下都不该让「配置缺失」表现为「数据看起来很正常」。
 */
export async function getCompleteWeatherReport(cityObj) {
  const { lat, lon } = cityObj;
  const failures = [];

  if (hasCaiyunToken()) {
    try {
      const { data, cached, stale } = await withDeadline(
        fetchCaiyunWeather(lat, lon), CAIYUN_DEADLINE_MS, '彩云取数',
      );
      const daily = await fillDailyFromOpenMeteo(lat, lon, data.weather.daily);

      // 把补齐后的逐日预报写回缓存。彩云试用版只给 3 天，若不回写，
      // 每次页面加载都要额外向 Open-Meteo 补一次（纯属浪费）。
      if (daily && daily !== data.weather.daily) {
        writeCaiyunCache(coordKey(lat, lon), { ...data, weather: { ...data.weather, daily } });
      }

      return {
        city: cityObj,
        weather: { ...data.weather, daily },
        airQuality: data.airQuality,
        sourceName: data.sourceName,
        keypoint: data.keypoint,
        // 彩云的 astro 优先；缺了就退到补齐数据里 Open-Meteo 带回来的那组
        sun: data.sun
          || parseAstro(daily && daily.sunrise && daily.sunset
            ? [daily.sunrise[0], daily.sunset[0]] : null),
        fromCache: cached,
        isStale: stale,
        isMock: false,
      };
    } catch (err) {
      console.warn('彩云取数失败，降级到 Open-Meteo:', err);
      failures.push('彩云 ' + ((err && err.message) || '未知错误'));
    }
  } else {
    failures.push('彩云 未配置 Token');
  }

  try {
    const data = await fetchOpenMeteoWeather(lat, lon);
    return {
      city: cityObj,
      weather: data.weather,
      // 空气子域可能单独失败，缺数据时给空结构，别让 renderAir 拿到 undefined
      airQuality: data.airQuality || {
        current: { time: new Date().toISOString(), pm2_5: 0, pm10: 0, us_aqi: 0 },
      },
      sourceName: data.sourceName,
      keypoint: data.keypoint,
      sun: data.sun || null,
      fromCache: false,
      isStale: false,
      // 不是假数据，只是换了源，前端不弹任何提示
      isMock: false,
      degraded: true,
      failureReason: failures.join('；'),
    };
  } catch (err) {
    console.warn('Open-Meteo 取数失败:', err);
    failures.push('Open-Meteo ' + ((err && err.message) || '未知错误'));
  }

  console.error('所有实时数据源均不可用，启用本地示例数据:', failures.join('；'));
  const mock = getMockWeatherReport(cityObj);
  mock.failureReason = failures.join('；');
  return mock;
}

/**
 * 离线容灾兜底
 * 时间串一律用「本地墙上时间」（与彩云 / Open-Meteo 路径保持同一语义），
 * 且数值全部可复现——容灾数据也要能稳定复现，才便于排查与回归。
 */
export function getMockWeatherReport(cityObj) {
  const now = new Date();
  const currentHour = now.getHours();
  const p2 = (n) => String(n).padStart(2, '0');

  const hourlyTimes = [];
  const hourlyTemps = [];
  const hourlyCodes = [];
  const hourlyPops = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date(now);
    d.setHours(currentHour + i, 0, 0, 0);
    hourlyTimes.push(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:00`);
    hourlyTemps.push(Math.round(21 + Math.sin(i / 3) * 5));
    hourlyCodes.push(i % 6 === 0 ? 1 : 0);
    // 固定波形而非随机数：同一个时刻反复打开看到的是同一份容灾数据
    hourlyPops.push(Math.max(0, Math.round(Math.sin(i / 2.2) * 22)));
  }

  const dailyTimes = [];
  const dailyCodes = [0, 1, 2, 61, 0, 1, 2];
  const dailyMax = [25, 26, 23, 21, 24, 26, 27];
  const dailyMin = [15, 16, 17, 14, 15, 16, 18];
  const dailyUv = [5.5, 6.2, 4.0, 2.1, 5.8, 6.5, 7.0];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    // toISOString() 取的是 UTC 日期，UTC+8 的清晨会整体差一天，必须按本地年月日拼
    dailyTimes.push(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`);
  }

  return {
    city: cityObj,
    sourceName: '本地容灾聚合缓存',
    weather: {
      current: {
        time: now.toISOString(),
        temperature_2m: 22.5,
        relative_humidity_2m: 54,
        apparent_temperature: 23.0,
        is_day: currentHour >= 6 && currentHour < 18 ? 1 : 0,
        precipitation: 0.0,
        weather_code: 0,
        surface_pressure: 1013.2,
        wind_speed_10m: 10.4,
        wind_direction_10m: 135,
      },
      hourly: {
        time: hourlyTimes,
        temperature_2m: hourlyTemps,
        weather_code: hourlyCodes,
        precipitation_probability: hourlyPops,
      },
      daily: {
        time: dailyTimes,
        weather_code: dailyCodes,
        temperature_2m_max: dailyMax,
        temperature_2m_min: dailyMin,
        uv_index_max: dailyUv,
      }
    },
    airQuality: {
      current: {
        time: now.toISOString(),
        pm2_5: 26.5,
        pm10: 48.0,
        us_aqi: 60,
        european_aqi: 25,
      }
    },
    isMock: true,
  };
}
