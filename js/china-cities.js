/**
 * 中国行政区划本地检索（省 / 市 / 区县）
 * ---------------------------------------------------------------------------
 * 数据：`assets/china-cities.json`（3252 条，源自阿里云 DataV.GeoAtlas 行政区划）。
 *      懒加载 —— 首次搜索时才拉取，不影响首屏；gzip 后约 53 KB。
 *
 * 为什么需要这一层：
 *   原先唯一的检索源是 Open-Meteo Geocoding（底层是 GeoNames）。它把地级市登记为
 *   「大连**市**」，且不随后缀归一化 —— 搜「大连」时返回的是福建/江苏/广西等地的
 *   同名小地方（连人口字段都没有），真正的大连（491 万人口）反而不出现。
 *   本地库用行政区划标准名 + 后缀归一化 + 层级加权，能把这类查询稳稳命中。
 *
 * 数据源合规：阿里云 DataV 属国内行政区划数据，港澳台在库中均为标准省级条目
 *   （台湾省 710000 / 香港特别行政区 810000 / 澳门特别行政区 820000），
 *   与《中华人民共和国行政区划代码》一致。
 */

const DATA_URL = new URL('../assets/china-cities.json', import.meta.url).href;

/**
 * 行政区划通名后缀。用于「大连」↔「大连市」、「浦东」↔「浦东新区」这类归一化。
 * 长后缀必须排在前面，否则「自治区」会被「区」先吃掉。
 */
const SUFFIX_RE = /(特别行政区|自治区|自治州|自治县|自治旗|地区|新区|林区|矿区|市|省|区|县|旗)$/;

/** 剥离通名后缀。叠后缀（如「内蒙古自治区」）会连续剥离，最多 3 次防死循环。 */
function normalizeName(input) {
  let out = String(input || '').trim();
  for (let i = 0; i < 3; i++) {
    const next = out.replace(SUFFIX_RE, '');
    if (!next || next === out) break;
    out = next;
  }
  return out;
}

/** 层级加权：查天气多是查「市」，所以市级略微靠前；省级次之；区县只在没有更优项时出现 */
const LEVEL_BONUS = { 1: 20, 2: 30, 3: 0 };

let rows = null;      // 已解析并预归一化的条目
let pending = null;   // 进行中的加载（并发去重）

async function loadRows() {
  if (rows) return rows;
  if (pending) return pending;

  pending = fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`行政区划数据加载失败 HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      rows = (data.list || []).map(([code, name, lng, lat, level, parent]) => ({
        code,
        name,
        lng,
        lat,
        level,
        parent,
        // 归一化结果预计算，避免每次按键都重算 3252 次正则
        norm: normalizeName(name),
      }));
      return rows;
    })
    .catch((err) => {
      pending = null;   // 允许下次搜索重试
      throw err;
    });

  return pending;
}

/**
 * 预热。首屏渲染完、浏览器空闲时调用一次，
 * 用户真正开始搜索时数据已在内存里，不会有首次加载的停顿。
 */
export function preloadChinaCities() {
  loadRows().catch(() => {});
}

/** 打分：完全一致 > 去后缀一致 > 前缀 > 子串。名与归一化名各算一遍取高者。 */
function scoreOf(name, norm, q, qnorm) {
  if (name === q) return 1000;
  if (norm && norm === qnorm) return 900;
  if (name.startsWith(q)) return 700;
  if (norm && norm.startsWith(qnorm)) return 650;
  if (name.includes(q)) return 400;
  if (norm && norm.includes(qnorm)) return 350;
  return 0;
}

/**
 * 检索中国行政区划。
 * @returns {Promise<Array<{name,admin1,country,lat,lon}>>} 与在线源同构，便于上层混用
 */
export async function searchChinaCities(query, limit = 8) {
  const q = String(query || '').trim();
  if (!q) return [];
  const qnorm = normalizeName(q);

  let list;
  try {
    list = await loadRows();
  } catch (err) {
    console.warn('本地行政区划库不可用，改走在线检索:', err);
    return [];
  }

  const scored = [];
  for (const row of list) {
    const base = scoreOf(row.name, row.norm, q, qnorm);
    if (!base) continue;
    scored.push({ row, s: base + (LEVEL_BONUS[row.level] || 0) });
  }
  if (!scored.length) return [];

  // 同分时：层级高的在前（省 → 市 → 区县），再按行政区划代码稳定排序
  scored.sort((a, b) => b.s - a.s
    || a.row.level - b.row.level
    || a.row.code - b.row.code);

  return scored.slice(0, limit).map(({ row }) => ({
    name: row.name,
    admin1: row.parent || '',
    country: '中国',
    lat: row.lat,
    lon: row.lng,
    // 1 省 / 2 市 / 3 区县。上层据此判断这次匹配的置信度：
    // 命中了省或市就是硬答案，只命中区县则还要拉在线结果一起比。
    level: row.level,
  }));
}
