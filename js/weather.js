/**
 * 天气 · 极简页
 * 只消费既有数据层（api.js / weather-codes.js），不改动任何接口。
 */

import { POPULAR_CITIES, searchCities, getCompleteWeatherReport } from './api.js';
import { preloadChinaCities } from './china-cities.js';
import {
  getWeatherInfo,
  evaluatePM25,
  getWindDirection,
  getBeaufortScale,
  getUVDescription,
  getSvgIcon,
} from './weather-codes.js';
import { applySkyTheme, setSunAnchors, resetSunAnchors } from './sky-gradient.js';
import { weatherScene } from './scene-weather.js';
import { glassLayer } from './glass-layer.js';

/* ---------- 元素 ---------- */

const ui = {};
[
  'searchInput', 'locationBtn', 'searchResults',
  'markDot', 'region', 'cityName', 'temperature',
  'conditionIcon', 'condition', 'range', 'facts',
  'timeline', 'curve', 'hourlyList', 'hourlyNote',
  'dailyList', 'dailyNote',
  'pm25', 'pm10', 'aqiIndex', 'aqiPin', 'aqiAdvice',
  'stamp', 'toast', 'sourceNote',
].forEach((id) => { ui[id] = document.getElementById(id); });

const SVG_NS = 'http://www.w3.org/2000/svg';
const HOUR_W = 58;      // 与 .hour 宽度一致
const SLOT_H = 54;      // 与 .hour-slot 高度一致
const PAD_TOP = 20;     // 顶部留给温度数字，曲线不会穿字
const PAD_BOT = 6;

/* ---------- 工具 ---------- */

let toastTimer = null;
function toast(msg) {
  if (!msg) return;
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3200);
}

const num = (v, digits = 0) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '--');
const round = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * 地区标签：去掉与城市名重复的层级，也去掉赘余的「中国」。
 * 例外：港澳台的 country 一律显示为「中国」——这些地区的条目本身是中国的省级
 * 行政区划，标签上不能出现任何像是独立国家/地区的写法。
 */
function regionLabel(city) {
  if (city?.country === '中国' && /^(台湾|台灣|臺灣|香港|澳门|澳門)/.test(city?.name || '')) {
    return '中国';
  }
  const parts = [city?.admin1, city?.country]
    .filter(Boolean)
    .filter((p) => p !== city?.name && p !== '中国');
  return parts.join(' · ');
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/* ---------- 天气效果系统 ---------- */

/* 全部交给 Canvas 场景引擎（js/scene-weather.js）。
   这里原先住着 150 个 .rain-drop / 100 个 .snow-flake 的 DOM 节点，
   外加一个自己排期的闪电定时器。那套的根本问题是 —— CSS 动画只能让
   元素整体平移，画不出逐粒子景深、柔和雪花球和分叉闪电路径；而定时器
   要手工清理，曾经泄漏过（切走雷暴后旧定时器继续闪，且每切一次多留一个）。
   换成逐帧状态机后没有可泄漏的句柄，这个 bug 在结构上不再成立。 */

/** 图标名 → 场景天气键。图标表比 bg 分得更细：毛毛雨和暴雨不是一回事 */
const SCENE_KEY = {
  'clear-day': 'clear',
  'partly-cloudy-day': 'cloudy',
  'overcast': 'overcast',
  'fog': 'fog',
  'drizzle': 'drizzle',
  'rain': 'rain',
  'snow': 'snow',
  'thunderstorm': 'thunderstorm',
};

/* 先记着当前天气：天色要按它调制，而天色每分钟还会自己刷一次 */
let currentSceneKey = 'clear';

/* 时间覆盖：自动化测试要拍五个时段的渐变，总不能蹲到半夜逐个等。
   设成小时数后一切按它算，设回 null 恢复跟随真实时间。 */
let simulatedHour = null;

/**
 * 水珠环境光：tint 是「被打亮的水」该有的颜色。
 *
 * 这里必须偏离「天色多大我就多亮」的直觉。夜里的水珠在物理上确实只剩微弱
 * 天光可反射，照实算出来的 tint 是 (55,51,68) —— 跟夜空 (23,26,38) 几乎同色，
 * 水珠等于隐形（实测画布覆盖率 1.1%、峰值 alpha 106/255）。
 *
 * 解决方式就是把真实世界里缺掉的那一环补上：玻璃是被路灯、窗内的灯打亮的。
 * 所以夜间给 tint 混入暖白并抬一个亮度下限，水珠才立得起来。
 * 这不是"为了好看而失真"—— 城市夜景里玻璃上的雨珠本来就是这样被看见的。
 */
const WET_LIT = [214, 224, 244];      // 白天：天光散射后的水色
const WET_LAMP = [255, 233, 198];     // 夜间：路灯的暖白

function waterTint(bot, darkK) {
  // 白天跟着天色走（正午偏青、黄昏偏暖），夜里转向路灯
  const day = mix(WET_LIT, bot, 0.34);
  const base = mix(day, WET_LAMP, darkK);
  // 亮度下限：夜里再暗也不低于 0.42，否则高光/焦散都没有立足的对比
  const lum = (base[0] * 0.299 + base[1] * 0.587 + base[2] * 0.114) / 255;
  const floor = 0.42;
  return lum >= floor ? base : base.map((c) => Math.min(255, c * (floor / lum)));
}

/**
 * 天空渐变 + 全页墨色 + 天气场景，三者一次刷新。
 * 顺序不能反：Canvas 要用「调制后」的天色给雨丝和雪球上色，
 * 得等天空算完再把结果喂给它，否则雷暴天的粒子还是晴天的配色。
 */
function updateSkyGradient() {
  const now = new Date();
  const hour = simulatedHour ?? (now.getHours() + now.getMinutes() / 60);
  const theme = applySkyTheme(hour, currentSceneKey);
  weatherScene.setSky(theme.colors, theme.luminance);
  glassLayer.setSky(theme.colors);   // 折射取景要知道玻璃后面的天色

  // 水珠的六层高光全部由环境光染色，环境光跟着天色走。
  // dark 也抬一个下限：浸润圈、透镜中段、珠体边缘全靠它压出轮廓，
  // 纯黑在深色天空上完全看不出边界。
  const { top, bot } = theme.colors;
  const darkK = clamp01((0.44 - theme.luminance) / 0.38);
  const tint = waterTint(bot, darkK);
  glassLayer.setLight({
    tint,
    sky: mix(tint, [255, 255, 255], 0.22),
    dark: mix([22, 26, 36], tint, 0.16),
    intensity: clamp01(0.30 + theme.luminance * 1.05),
  });

  return theme;
}

/**
 * 天气现象 → 屏幕效果。
 * 分类直接取自 WMO 图标表，不再手写一遍代码清单：
 * 早先那份清单漏了 56/57/66/67（冻雨），它们有雨却没雨效。
 */
function applyWeatherEffects(weatherCode) {
  const { icon } = getWeatherInfo(weatherCode, 1);
  currentSceneKey = SCENE_KEY[icon] || 'clear';
  weatherScene.setWeather(currentSceneKey);
  glassLayer.setWeather(currentSceneKey);
  // 天气变了天色也得变（晴天转雷暴会整体压暗），墨色要跟着重算
  updateSkyGradient();
}

/** 顶栏小圆点：唯一的一处色彩，跟着天气走 */
const DOT_COLOR = {
  clear:  '#e0a63c',
  cloudy: '#93a1b0',
  rain:   '#4a6fa5',
  snow:   '#8fb4cc',
  fog:    '#a8a8a2',
};

function dayLabel(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '--';
  const diff = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  return WEEK[d.getDay()];
}

/** 本地墙钟时间前缀，用来在 hourly 数组里定位「现在」 */
function localHourKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}`;
}

/* ---------- 渲染：主报告 ---------- */

function renderReport(report) {
  const { city, weather } = report;
  const cur = weather.current || {};
  const day0 = weather.daily || {};
  const info = getWeatherInfo(cur.weather_code, cur.is_day);

  ui.region.textContent = regionLabel(city) || ' ';
  ui.cityName.textContent = city?.name || '未知位置';
  document.title = `${city?.name || 'Weather'} ${round(cur.temperature_2m) ?? '--'}° · Weather`;

  ui.temperature.textContent = round(cur.temperature_2m) ?? '--';
  ui.condition.textContent = info.label || ' ';
  ui.conditionIcon.innerHTML = getSvgIcon(info.icon) || '';
  ui.markDot.style.background = DOT_COLOR[info.bg] || 'var(--ink-3)';

  const hi = round(day0.temperature_2m_max?.[0]);
  const lo = round(day0.temperature_2m_min?.[0]);
  ui.range.textContent = hi !== null && lo !== null ? `↑ ${hi}°   ↓ ${lo}°` : ' ';

  renderFacts(cur, day0);

  // 应用天气效果（内部会连带把天空与墨色按新天气刷新一遍）
  applyWeatherEffects(cur.weather_code);
}

function renderFacts(cur, day0) {
  const wind = Number(cur.wind_speed_10m);
  const uv = day0.uv_index_max?.[0];
  const uvInfo = getUVDescription(uv);

  const t = round(cur.temperature_2m);
  const feel = round(cur.apparent_temperature);
  const rh = Number(cur.relative_humidity_2m);
  const rain = Number(cur.precipitation);
  const hpa = Number(cur.surface_pressure);

  const facts = [
    {
      label: '体感', value: feel ?? '--', unit: '°',
      note: feel === null || t === null ? ''
        : feel === t ? '与气温相当'
        : `比气温${feel > t ? '高' : '低'} ${Math.abs(feel - t)}°`,
    },
    {
      label: '湿度', value: num(rh), unit: '%',
      note: !Number.isFinite(rh) ? ''
        : rh < 30 ? '干燥' : rh <= 70 ? '舒适' : '潮湿',
    },
    {
      label: '风', value: num(wind, 1), unit: 'km/h',
      note: Number.isFinite(wind)
        ? `${getWindDirection(cur.wind_direction_10m)} · ${getBeaufortScale(wind).split(' ')[0]}`
        : '',
    },
    {
      label: '降水', value: num(rain, 1), unit: 'mm',
      note: !Number.isFinite(rain) ? '' : rain > 0 ? '正在降水' : '当前无降水',
    },
    {
      label: '气压', value: num(hpa), unit: 'hPa',
      note: !Number.isFinite(hpa) ? ''
        : hpa < 1005 ? '偏低' : hpa > 1020 ? '偏高' : '正常',
    },
    {
      label: '紫外线',
      value: Number.isFinite(Number(uv)) ? num(uv, 1) : '--',
      note: Number.isFinite(Number(uv)) ? uvInfo.text : '',
    },
  ];

  ui.facts.innerHTML = facts.map((f) => `
    <div class="fact">
      <dt>${escapeHtml(f.label)}</dt>
      <dd>${escapeHtml(f.value)}${f.unit ? `<i>${escapeHtml(f.unit)}</i>` : ''}</dd>
      <div class="fact-note">${escapeHtml(f.note || '')}</div>
    </div>
  `).join('');
}

/* ---------- 渲染：24 小时 ---------- */

function renderHourly(weather) {
  const h = weather.hourly || {};
  const times = h.time || [];
  if (!times.length) {
    ui.hourlyList.innerHTML = '';
    ui.curve.innerHTML = '';
    ui.hourlyNote.textContent = '';
    syncTimelineFade();
    return;
  }

  const key = localHourKey();
  let start = times.findIndex((t) => String(t).startsWith(key));
  if (start < 0) start = 0;

  const slice = [];
  for (let i = start; i < Math.min(start + 24, times.length); i += 1) {
    slice.push({
      time: times[i],
      temp: round(h.temperature_2m?.[i]),
      code: h.weather_code?.[i],
      pop: round(h.precipitation_probability?.[i]),
    });
  }
  if (!slice.length) return;

  const temps = slice.map((s) => s.temp).filter((t) => t !== null);
  // 全为 null 时 Math.min(...[]) 会得到 Infinity，后面的 --y 就成了 NaNpx
  const min = temps.length ? Math.min(...temps) : 0;
  const max = temps.length ? Math.max(...temps) : 1;
  const span = max - min || 1;
  const yOf = (t) => (t === null
    ? SLOT_H / 2
    : PAD_TOP + (1 - (t - min) / span) * (SLOT_H - PAD_TOP - PAD_BOT));

  ui.hourlyNote.textContent = temps.length ? `${min}° – ${max}°` : '';

  ui.hourlyList.innerHTML = slice.map((s) => {
    const d = new Date(s.time);
    // 「现在」按这一格的时间是不是当前小时判定，而不是「是不是第一格」：
    // 若接口给的逐时里没有当前小时，start 会退回 0，此时第一格其实是别的小时。
    const isNow = String(s.time).startsWith(key);
    const label = isNow ? '现在' : `${String(d.getHours()).padStart(2, '0')}时`;
    const isDay = d.getHours() >= 6 && d.getHours() < 19 ? 1 : 0;
    const info = getWeatherInfo(s.code, isDay);
    return `
      <div class="hour${isNow ? ' is-now' : ''}">
        <div class="hour-time">${escapeHtml(label)}</div>
        <div class="hour-icon">${getSvgIcon(info.icon) || ''}</div>
        <div class="hour-slot">
          <div class="hour-temp" style="--y:${yOf(s.temp).toFixed(1)}px">${s.temp ?? '--'}°</div>
        </div>
        <div class="hour-pop">${s.pop !== null && s.pop > 10 ? `${s.pop}%` : ''}</div>
      </div>
    `;
  }).join('');

  drawCurve(slice.map((s) => yOf(s.temp)));
  syncTimelineFade();
}

/**
 * 横向时间轴两端淡出的开关：
 * 滚到最左就撤掉左淡出，滚到最右就撤掉右淡出，避免白白吃掉半列内容。
 */
const timelineWrap = ui.timeline.parentElement;

function syncTimelineFade() {
  const el = ui.timeline;
  if (!el || !timelineWrap) return;
  const atStart = el.scrollLeft <= 1;
  const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
  timelineWrap.classList.toggle('at-start', atStart);
  timelineWrap.classList.toggle('at-end', atEnd);
}

ui.timeline.addEventListener('scroll', syncTimelineFade, { passive: true });
window.addEventListener('resize', syncTimelineFade);

/** 用 SVG 折线把逐时温度连起来，并与 .hour-slot 垂直对齐 */
function drawCurve(ys) {
  const width = ys.length * HOUR_W;
  ui.curve.setAttribute('viewBox', `0 0 ${width} ${SLOT_H}`);
  ui.curve.setAttribute('width', width);
  ui.curve.setAttribute('height', SLOT_H);
  ui.curve.style.width = `${width}px`;

  const pts = ys.map((y, i) => [i * HOUR_W + HOUR_W / 2, y]);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');

  ui.curve.innerHTML = '';
  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', path);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1');
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('opacity', '0.28');
  ui.curve.appendChild(line);

  pts.forEach(([x, y]) => {
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', x.toFixed(1));
    dot.setAttribute('cy', y.toFixed(1));
    dot.setAttribute('r', '1.4');
    dot.setAttribute('fill', 'currentColor');
    dot.setAttribute('opacity', '0.32');
    ui.curve.appendChild(dot);
  });

  // 字体度量因平台而异，按实际布局对齐而不是写死偏移
  const slot = ui.hourlyList.querySelector('.hour-slot');
  if (slot) ui.curve.style.top = `${slot.offsetTop}px`;
}

/* ---------- 渲染：7 天 ---------- */

function renderDaily(weather) {
  const d = weather.daily || {};
  const days = (d.time || []).slice(0, 7);
  if (!days.length) {
    ui.dailyList.innerHTML = '';
    ui.dailyNote.textContent = '';
    return;
  }

  const his = days.map((_, i) => round(d.temperature_2m_max?.[i]));
  const los = days.map((_, i) => round(d.temperature_2m_min?.[i]));
  const valid = [...his, ...los].filter((t) => t !== null);
  const min = valid.length ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 1;
  const span = max - min || 1;

  ui.dailyNote.textContent = valid.length ? `${min}° – ${max}°` : '';

  ui.dailyList.innerHTML = days.map((date, i) => {
    const info = getWeatherInfo(d.weather_code?.[i], 1);
    const hi = his[i];
    const lo = los[i];
    const from = lo === null ? 0 : ((lo - min) / span) * 100;
    const to = hi === null ? 100 : ((hi - min) / span) * 100;
    const width = Math.max(4, to - from);
    return `
      <div class="day${i === 0 ? ' is-today' : ''}">
        <div class="day-name">${escapeHtml(dayLabel(date))}</div>
        <div class="day-icon">${getSvgIcon(info.icon) || ''}</div>
        <div class="day-desc">${escapeHtml(info.label || '')}</div>
        <div class="day-temps">
          <span class="day-lo">${lo ?? '--'}°</span>
          <span class="day-bar"><span style="--from:${from.toFixed(1)}%;--span:${width.toFixed(1)}%"></span></span>
          <span class="day-hi">${hi ?? '--'}°</span>
        </div>
      </div>
    `;
  }).join('');
}

/* ---------- 渲染：空气 ---------- */

/* 刻度条那根渐变的色标，必须与 css/weather.css 里 .gauge-track 的写法定全一致。
   游标不再是「纸色填充 + 墨色描边」的黑圈，而是取它**所在位置**的渐变色 ——
   等同这根线上的一颗实心点，位置一变颜色也跟着走。 */
const GAUGE_STOPS = [
  [0,   [0x4e, 0xa3, 0x6b]],   // 优
  [18,  [0x9d, 0xbd, 0x52]],
  [36,  [0xe0, 0xb3, 0x41]],   // 轻度
  [54,  [0xdd, 0x83, 0x40]],
  [72,  [0xcf, 0x5a, 0x52]],   // 重度
  [100, [0x8c, 0x4a, 0x7a]],   // 严重
];

function gaugeColorAt(percent) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  for (let i = 1; i < GAUGE_STOPS.length; i += 1) {
    const [p1, c1] = GAUGE_STOPS[i];
    if (p > p1) continue;
    const [p0, c0] = GAUGE_STOPS[i - 1];
    const t = p1 === p0 ? 0 : (p - p0) / (p1 - p0);
    const rgb = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
    return rgb;
  }
  return GAUGE_STOPS[GAUGE_STOPS.length - 1][1];
}

function renderAir(report) {
  const air = report.airQuality?.current || {};
  const pm25 = air.pm2_5;
  const rating = evaluatePM25(pm25);

  ui.pm25.textContent = num(pm25, 1);
  ui.pm10.textContent = num(air.pm10, 1);
  ui.aqiIndex.textContent = num(air.chn_aqi ?? air.us_aqi);

  ui.aqiPin.style.setProperty('--at', `${rating.percent}%`);
  const [r, g, b] = gaugeColorAt(rating.percent);
  ui.aqiPin.style.background = `rgb(${r}, ${g}, ${b})`;
  // 同色淡晕：让点在轨道上有个轮廓，又不是描边黑圈
  ui.aqiPin.style.boxShadow = `0 0 0 3px rgba(${r}, ${g}, ${b}, .30)`;
  ui.aqiAdvice.textContent = report.keypoint || rating.advice;
}

/* ---------- 取数 ---------- */

let loadSeq = 0;

async function load(city) {
  if (!city) return;
  const seq = ++loadSeq;
  document.body.classList.add('is-loading');

  try {
    const report = await getCompleteWeatherReport(city);
    if (seq !== loadSeq) return;  // 已有更新的请求，丢弃这次结果

    renderReport(report);
    renderHourly(report.weather);
    renderDaily(report.weather);
    renderAir(report);

    // 把天空的黎明/黄昏锚点绑到当地真实日出日落（彩云 astro / Open-Meteo daily）。
    // 换城市时锚点会跟着换，重刷一次让天空立刻按新锚点渲染，不等下一分钟 tick。
    // mock / 解析失败时 report.sun 为 null，沿用默认锚点（6:30 / 18:30）。
    if (report.sun) {
      setSunAnchors(report.sun.sunrise, report.sun.sunset);
      updateSkyGradient();
    }

    ui.stamp.textContent = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit',
    }) + ' 更新';

    // 页脚常驻标注「这次到底用的哪个源」。只靠一条几秒就消失的 toast
    // 说明数据是假的远远不够——页面照样会渲染出一整套自洽的数值。
    if (ui.sourceNote) {
      ui.sourceNote.textContent = report.isMock
        ? '本地示例数据 · 实时源不可用'
        : (report.sourceName || '彩云天气 · Open-Meteo');
    }

    if (report.isMock) toast('实时数据不可用，当前为本地示例数据');
    else if (report.isStale) toast('网络异常，显示的是上次缓存');
  } catch (err) {
    console.error(err);
    if (seq === loadSeq) toast('天气数据加载失败');
  } finally {
    if (seq === loadSeq) document.body.classList.remove('is-loading');
  }
}

/* ---------- 搜索 ---------- */

let searchTimer = null;
let searchSeq = 0;
let hits = [];

function closeResults() {
  ui.searchResults.classList.remove('open');
  ui.searchResults.innerHTML = '';
  hits = [];
}

function showResults(list) {
  hits = list;
  if (!list.length) {
    ui.searchResults.innerHTML = '<div class="result-empty">没有找到匹配的城市</div>';
  } else {
    ui.searchResults.innerHTML = list.map((c, i) => `
      <button type="button" class="result" data-i="${i}">
        <span class="result-name">${escapeHtml(c.name)}</span>
        <span class="result-region">${escapeHtml(regionLabel(c))}</span>
      </button>
    `).join('');
  }
  ui.searchResults.classList.add('open');
}

ui.searchInput.addEventListener('input', () => {
  const q = ui.searchInput.value.trim();
  clearTimeout(searchTimer);
  if (!q) { closeResults(); return; }

  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const list = await searchCities(q);
      if (seq !== searchSeq) return;
      showResults(list || []);
    } catch (err) {
      console.error(err);
      if (seq === searchSeq) closeResults();
    }
  }, 280);
});

ui.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeResults(); ui.searchInput.blur(); return; }
  if (e.key === 'Enter' && hits.length) pick(hits[0]);
});

ui.searchResults.addEventListener('click', (e) => {
  const btn = e.target.closest('.result');
  if (!btn) return;
  const city = hits[Number(btn.dataset.i)];
  if (city) pick(city);
});

function pick(city) {
  closeResults();
  ui.searchInput.value = '';
  ui.searchInput.blur();
  load(city);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.masthead-search')) closeResults();
});

/* ---------- 定位 ---------- */

ui.locationBtn.addEventListener('click', () => {
  if (!navigator.geolocation) { toast('当前浏览器不支持定位'); return; }
  toast('正在定位…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => load({
      name: '我的位置',
      admin1: '',
      country: '',
      lat: coords.latitude,
      lon: coords.longitude,
    }),
    (err) => toast(err.code === err.PERMISSION_DENIED ? '定位权限被拒绝' : '定位失败'),
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
  );
});

/* ---------- 启动 ---------- */

// 先把天空与墨色铺上，不等天气接口回来，避免首屏闪一下白字。
// 顺序也有讲究：天色要先算出来喂进场景引擎，再建画布 —— 反过来的话
// canvas 会先用内置的白天配色渲染一帧，夜间首屏会闪一下亮色。
updateSkyGradient();
weatherScene.init();
glassLayer.init();

/* 调试 / 自动化测试入口：直接跳到某个时刻渲染一帧。
   __skyTime(20.5) → 切到 20:30；__skyTime(null) → 回到真实时间。 */
window.__skyTime = (hour) => {
  simulatedHour = hour;
  return updateSkyGradient();
};

/* 调试 / 自动化测试入口：注入测试用日出日落锚点（小时数）。
   __sunAnchors(5, 16) → 日出 5 点、日落 16 点并重刷天空；
   __sunAnchors(null)  → 复位到默认锚点。 */
window.__sunAnchors = (rise, set) => {
  if (rise == null) resetSunAnchors();
  else setSunAnchors(rise, set);
  return updateSkyGradient();
};

// 自动获取位置权限并加载天气
function autoLoadLocation() {
  if (!navigator.geolocation) {
    toast('当前浏览器不支持定位，加载默认城市');
    load(POPULAR_CITIES[0]);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      load({
        name: '我的位置',
        admin1: '',
        country: '',
        lat: coords.latitude,
        lon: coords.longitude,
      });
    },
    (err) => {
      console.log('定位失败，加载默认城市:', err.message);
      load(POPULAR_CITIES[0]);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 },
  );
}

autoLoadLocation();

// 浏览器空闲时预热行政区划库：用户真正开始搜索时数据已在内存，没有首次加载的停顿
const warmUpCities = () => preloadChinaCities();
if ('requestIdleCallback' in window) requestIdleCallback(warmUpCities, { timeout: 3000 });
else setTimeout(warmUpCities, 1500);

// 每分钟校一次：跨过晨昏阈值时墨色自动翻转
setInterval(updateSkyGradient, 60000);
