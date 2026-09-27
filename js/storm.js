/**
 * storm.js —— 「强对流」单页实验台
 * ---------------------------------------------------------------------------
 * 只干一件事：把天气数据源整条掐掉，直接驱动三层渲染
 * （天空渐变 sky-gradient / 窗外世界 scene-weather / 玻璃水珠 glass-layer），
 * 然后把所有可调项摊在右下角的面板上，边拖边看。
 *
 * 为什么不复用 weather.js：那个文件的职责是取数 + 填 DOM，效果只是它的下游。
 * 想单独盯「雷暴」这一种天气时，没必要让一次网络请求挡在前面 ——
 * 更不能让 open-meteo 当前返回的不是 95 就没得看。
 *
 * 页面自身的取数入口在这里被显式禁掉（见文件末的 fetch / JSONP 拦截），
 * 所以打开这个页面只有一个数据源：面板。
 */

import { applySkyTheme } from './sky-gradient.js';
import { weatherScene } from './scene-weather.js';
import { glassLayer } from './glass-layer.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* ============================================================
   水珠环境光：与 weather.js 里那套逐字一致
   （夜里给 tint 混入路灯暖白并抬亮度下限，否则水珠在深色夜空上隐形）
   ============================================================ */

const WET_LIT = [214, 224, 244];      // 白天：天光散射后的水色
const WET_LAMP = [255, 233, 198];     // 夜间：路灯的暖白

function waterTint(bot, darkK) {
  const day = mix(WET_LIT, bot, 0.34);
  const base = mix(day, WET_LAMP, darkK);
  const lum = (base[0] * 0.299 + base[1] * 0.587 + base[2] * 0.114) / 255;
  const floor = 0.42;
  return lum >= floor ? base : base.map((c) => Math.min(255, c * (floor / lum)));
}

/* ============================================================
   状态
   ============================================================ */

const state = {
  scene: 'thunderstorm',   // 见 scene-weather.js 的 PROFILE
  hour: 20.5,
  running: true,
  bolt: false,             // 定格一道闪电
  realtime: false,         // 跟随真实时间
  glassOn: true,
};

/* 天气切换按钮：键就是 scene-weather.js 的 PROFILE 键 */
const SCENES = [
  ['clear', '晴'],
  ['cloudy', '多云'],
  ['overcast', '阴'],
  ['fog', '雾'],
  ['drizzle', '毛毛雨'],
  ['rain', '雨'],
  ['thunderstorm', '雷暴'],
  ['snow', '雪'],
];

const p2 = (n) => String(n).padStart(2, '0');
const fmtHour = (h) => `${p2(Math.floor(h) % 24)}:${p2(Math.round((h % 1) * 60))}`;

/* ============================================================
   刷新链路：天色 → 粒子层 → 水珠层
   顺序不能反。粒子与水珠的配色都取自「调制后的天色」，
   得先让 sky-gradient 算完，再把结果喂下去。
   ============================================================ */

function refresh() {
  const hour = state.realtime
    ? (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; })()
    : state.hour;

  const theme = applySkyTheme(hour, state.scene);
  weatherScene.setSky(theme.colors, theme.luminance);

  const darkK = clamp01((0.44 - theme.luminance) / 0.38);
  const tint = waterTint(theme.colors.bot, darkK);
  glassLayer.setLight({
    tint,
    sky: mix(tint, [255, 255, 255], 0.22),
    dark: mix([22, 26, 36], tint, 0.16),
    intensity: clamp01(0.30 + theme.luminance * 1.05),
  });

  // 面板读数
  $('readout').textContent = JSON.stringify({
    scene: state.scene,
    hour: fmtHour(hour),
    ink: theme.ink,
    luminance: +theme.luminance.toFixed(4),
    sky: {
      top: theme.colors.top.map(Math.round),
      mid: theme.colors.mid.map(Math.round),
      bot: theme.colors.bot.map(Math.round),
    },
    waterTint: tint.map(Math.round),
  }, null, 1);

  return theme;
}

function setScene(key) {
  state.scene = key;
  weatherScene.setWeather(key);
  glassLayer.setWeather(key);
  for (const b of document.querySelectorAll('#sceneBtns button')) {
    b.classList.toggle('on', b.dataset.k === key);
  }
  refresh();
}

/* ============================================================
   粒子实时计数（面板右上角那行小字）
   ============================================================ */

function tickCounter() {
  const c = weatherScene.counts;
  const g = glassLayer.counts;
  $('counter').textContent =
    `雨丝 ${c.rain} · 雪 ${c.snow} · 星 ${c.stars} · 闪电 ${c.lightning.toFixed(2)}`
    + ` · 枝干 ${c.boltBranches} · 已闪 ${c.flashCount}`
    + `　‖　水珠 ${g.drops}（滑 ${g.moving} / 大 ${g.big}）· 涟漪 ${g.rings}`;
  $('fps').textContent = `fps ${fps.toFixed(0)}`;
}

/* 帧率：直接数 RAF 回调，不用 performance API 花活 */
let fps = 60;
let frames = 0;
let fpsT0 = performance.now();
let lastCount = 0;

function loop() {
  requestAnimationFrame(loop);
  frames += 1;
  const now = performance.now();
  if (now - fpsT0 >= 500) {
    fps = (frames * 1000) / (now - fpsT0);
    frames = 0;
    fpsT0 = now;
  }
  if (now - lastCount >= 400) {
    lastCount = now;
    tickCounter();
  }
  if (state.realtime && now - lastCount < 20) refresh();
}

/* ============================================================
   面板装配
   ============================================================ */

function buildPanel() {
  const wrap = $('sceneBtns');
  for (const [k, label] of SCENES) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.k = k;
    b.onclick = () => setScene(k);
    wrap.appendChild(b);
  }

  $('hour').addEventListener('input', (e) => {
    state.realtime = false;
    $('realtime').classList.remove('on');
    state.hour = Number(e.target.value);
    $('hourLbl').textContent = fmtHour(state.hour);
    refresh();
  });

  $('realtime').onclick = () => {
    state.realtime = !state.realtime;
    $('realtime').classList.toggle('on', state.realtime);
    refresh();
  };

  $('pause').onclick = () => {
    state.running = !state.running;
    $('pause').classList.toggle('on', !state.running);
    $('pause').textContent = state.running ? '暂停' : '继续';
    if (state.running) { weatherScene.resume(); glassLayer.resume(); }
    else { weatherScene.pause(); glassLayer.pause(); }
  };

  $('bolt').onclick = () => {
    state.bolt = !state.bolt;
    $('bolt').classList.toggle('on', state.bolt);
    if (state.bolt) {
      // 定格一道：停掉循环，手工渲染一帧，让分叉枝干留在画面里
      weatherScene.pause();
      weatherScene.lightning = 0.62;
      weatherScene.boltPaths = weatherScene.genBolt();
      weatherScene.boltLife = 1;
      weatherScene.render();
      glassLayer.pause();
      glassLayer.lightning = 0.62;
      glassLayer.render();
    } else {
      weatherScene.lightning = 0;
      weatherScene.boltPaths = null;
      glassLayer.lightning = 0;
      if (state.running) { weatherScene.resume(); glassLayer.resume(); }
    }
  };

  $('glassOn').onclick = () => {
    state.glassOn = !state.glassOn;
    $('glassOn').classList.toggle('on', state.glassOn);
    document.getElementById('glassLayer').style.display = state.glassOn ? '' : 'none';
  };

  $('hide').onclick = () => document.body.classList.toggle('panel-hidden');
}

/* ============================================================
   起
   ============================================================ */

/* 掐掉页面自带的取数入口 —— 这个页面只有一个数据源：面板。
   weather.html 里是 <script type="module" src="js/weather.js">，模块一旦被
   任何路径引入，它顶层的 fetch 与 JSONP 就会自己跑起来并覆盖掉面板设置。
   这里在最早的时机把两者都堵上。 */
if (typeof window !== 'undefined') {
  window.fetch = () => Promise.reject(new Error('强对流实验台：取数已禁用，请用面板'));
  window.__blockNetwork = true;
}

/* 面板可能被 weather.html 的样式影响，先等 DOM 就绪 */
const boot = () => {
  buildPanel();

  const h = $('hour');
  h.value = String(state.hour);
  $('hourLbl').textContent = fmtHour(state.hour);

  weatherScene.init();
  glassLayer.init();

  // init() 会按默认天气建种群，这里再显式设一次，确保开局就是雷暴
  weatherScene.setWeather(state.scene);
  glassLayer.setWeather(state.scene);
  refresh();

  for (const b of document.querySelectorAll('#sceneBtns button')) {
    b.classList.toggle('on', b.dataset.k === state.scene);
  }

  requestAnimationFrame(loop);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* 调试入口，跟 weather.js 保持一致，方便用现成的探针脚本复用 */
window.__skyTime = (hour) => {
  state.realtime = false;
  if (hour !== null && hour !== undefined) {
    state.hour = hour;
    $('hour').value = String(hour);
    $('hourLbl').textContent = fmtHour(hour);
  }
  return refresh();
};
window.__glassLayer = glassLayer;
window.__sceneWeather = weatherScene;
window.__stormState = state;
