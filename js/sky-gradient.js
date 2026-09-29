/**
 * 24 小时天空渐变引擎
 * ---------------------------------------------------------------------------
 * 一张手工标定的关键帧表（天顶 / 中层 / 地平线三层色）+ smoothstep 插值，
 * 按小时输出线性渐变；再叠一层天气调制（云层光学厚度 → 压暗 / 去饱和 / 染色），
 * 并顺带算出此刻该配深墨还是白墨（见文件后半段的墨色匹配）。
 *
 * 全部副作用只有三处：写 .sky-backdrop 的 inline background、
 * 同步 .sky-edge-top / .sky-edge-bottom 的底色（视口边缘 tint 采样源，
 * 见 applyEdgeTint 的注释）、以及给 <html> 挂 data-ink。
 * 不碰 Date.prototype、不引外部依赖。
 *
 * applySkyTheme 会把调制后的三层色一并返回 —— Canvas 天气场景（scene-weather.js）
 * 拿它给雨丝、雪球、闪电配色，两边的天色因此永远同源，不会各画各的。
 */

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// 线性插值RGB颜色
function lerpRgb(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t)
  ];
}

// 将RGB数组转为CSS字符串
function rgbStr(rgb) {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

/* ============================================================
   真实日出日落锚点（2026-09-27 新增）
   ------------------------------------------------------------
   早年这张表是「日出 6.5-7.5 点、日落 18.5-19.5 点」写死的；
   现在日出/日落两个锚点可由数据源（Open-Meteo daily.sunrise/sunset、
   彩云 daily.astro）注入，黎明/日出/黄昏/日落/傍晚各段跟着真实的
   太阳走。其余锚点（4 点 / 10 点 / 15 点 / 22 点）仍固定。

   未注入时就是 6.5 / 18.5 = 原写死值，五时段基准截图逐位不变。
   夹取是为了防段序塌掉：漠河极昼 / 极夜那种极端太阳没法表达，
   允许把锚点夹进 [5,9] / [16.5,21.5]，牺牲极端地区的精度保整体秩序。
   ============================================================ */

const SUN_ANCHOR_DEFAULTS = { rise: 6.5, set: 18.5 };
let sunAnchors = { ...SUN_ANCHOR_DEFAULTS };

/** 注入当地真实日出/日落（小数小时，例如 6.2 = 06:12）。非法输入静默忽略。 */
export function setSunAnchors(rise, set) {
  const r = Number(rise);
  const s = Number(set);
  if (!Number.isFinite(r) || !Number.isFinite(s)) return { ...sunAnchors };
  sunAnchors = {
    rise: Math.min(9, Math.max(5, r)),
    set: Math.min(21.5, Math.max(16.5, s)),
  };
  return { ...sunAnchors };
}

/** 复位到默认锚点（回退场景 / 测试用） */
export function resetSunAnchors() {
  sunAnchors = { ...SUN_ANCHOR_DEFAULTS };
  return { ...sunAnchors };
}

/** 当前生效的锚点（调试用） */
export function getSunAnchors() {
  return { ...sunAnchors };
}

/**
 * 24小时天空色彩关键帧（基于物理的连续渐变）
 * 每个时段定义天顶、中层、地平线三层颜色
 */
const SKY_KEYFRAMES = {
  // 深夜 0-4点
  night: {
    top: [8, 12, 30],
    mid: [14, 21, 44],
    bot: [26, 36, 66]
  },
  // 黎明前 4-5.5点
  preDawn: {
    top: [22, 30, 62],
    mid: [44, 52, 88],
    bot: [66, 68, 118]
  },
  // 黎明 5.5-6.5点
  dawn: {
    top: [66, 68, 118],
    mid: [140, 92, 132],
    bot: [216, 124, 104]
  },
  // 日出 6.5-7.5点
  sunrise: {
    top: [140, 92, 132],
    mid: [216, 124, 104],
    bot: [244, 172, 108]
  },
  // 早晨 7.5-10点
  morning: {
    top: [158, 198, 232],
    mid: [214, 232, 246],
    bot: [248, 214, 168]
  },
  // 正午 10-15点
  noon: {
    top: [120, 180, 230],
    mid: [176, 208, 238],
    bot: [214, 232, 246]
  },
  // 下午 15-17点
  afternoon: {
    top: [140, 190, 235],
    mid: [200, 220, 240],
    bot: [240, 220, 200]
  },
  // 黄昏 17-18.5点
  dusk: {
    top: [100, 120, 180],
    mid: [180, 140, 160],
    bot: [240, 160, 120]
  },
  // 日落 18.5-19.5点
  sunset: {
    top: [60, 70, 120],
    mid: [140, 92, 132],
    bot: [216, 124, 104]
  },
  // 傍晚 19.5-22点
  evening: {
    top: [22, 30, 62],
    mid: [44, 52, 88],
    bot: [100, 80, 110]
  },
  // 深夜 22-24点
  lateNight: {
    top: [8, 12, 30],
    mid: [14, 21, 44],
    bot: [26, 36, 66]
  }
};

/**
 * 根据小时数采样天空颜色。
 * 黎明侧锚点跟着真实日出走：dawn 收在日出前 1h、sunrise 段是日出后 1h；
 * 黄昏侧同理：dusk 从日落前 1.5h 起、evening 从日落后 1h 起。
 * 锚点未注入时 rise=6.5 / set=18.5，边界与旧版写死值完全一致。
 */
function sampleSkyColors(hour) {
  hour = ((hour % 24) + 24) % 24;

  const { rise, set } = sunAnchors;
  const dawnEnd = rise - 1;        // 黎明结束 = 日出前 1h（默认 5.5）
  const morningStart = rise + 1;   // 早晨开始 = 日出后 1h（默认 7.5）
  const duskStart = set - 1.5;     // 黄昏开始 = 日落前 1.5h（默认 17）
  const eveningStart = set + 1;    // 傍晚开始 = 日落后 1h（默认 19.5）

  let period1, period2, t;

  if (hour < 4) {
    period1 = SKY_KEYFRAMES.night;
    period2 = SKY_KEYFRAMES.preDawn;
    t = hour / 4;
  } else if (hour < dawnEnd) {
    period1 = SKY_KEYFRAMES.preDawn;
    period2 = SKY_KEYFRAMES.dawn;
    t = (hour - 4) / (dawnEnd - 4);
  } else if (hour < rise) {
    period1 = SKY_KEYFRAMES.dawn;
    period2 = SKY_KEYFRAMES.sunrise;
    t = (hour - dawnEnd) / (rise - dawnEnd);
  } else if (hour < morningStart) {
    period1 = SKY_KEYFRAMES.sunrise;
    period2 = SKY_KEYFRAMES.morning;
    t = (hour - rise) / (morningStart - rise);
  } else if (hour < 10) {
    period1 = SKY_KEYFRAMES.morning;
    period2 = SKY_KEYFRAMES.noon;
    t = (hour - morningStart) / (10 - morningStart);
  } else if (hour < 15) {
    period1 = SKY_KEYFRAMES.noon;
    period2 = SKY_KEYFRAMES.afternoon;
    t = (hour - 10) / 5;
  } else if (hour < duskStart) {
    period1 = SKY_KEYFRAMES.afternoon;
    period2 = SKY_KEYFRAMES.dusk;
    t = (hour - 15) / (duskStart - 15);
  } else if (hour < set) {
    period1 = SKY_KEYFRAMES.dusk;
    period2 = SKY_KEYFRAMES.sunset;
    t = (hour - duskStart) / (set - duskStart);
  } else if (hour < eveningStart) {
    period1 = SKY_KEYFRAMES.sunset;
    period2 = SKY_KEYFRAMES.evening;
    t = (hour - set) / (eveningStart - set);
  } else if (hour < 22) {
    period1 = SKY_KEYFRAMES.evening;
    period2 = SKY_KEYFRAMES.lateNight;
    t = (hour - eveningStart) / (22 - eveningStart);
  } else {
    period1 = SKY_KEYFRAMES.lateNight;
    period2 = SKY_KEYFRAMES.night;
    t = (hour - 22) / 2;
  }

  // 使用平滑插值
  t = smooth(t);

  const top = lerpRgb(period1.top, period2.top, t);
  const mid = lerpRgb(period1.mid, period2.mid, t);
  const bot = lerpRgb(period1.bot, period2.bot, t);

  return { top, mid, bot };
}

/**
 * 生成CSS渐变字符串
 */
function generateSkyGradient(colors) {
  return `linear-gradient(180deg, ${rgbStr(colors.top)} 0%, ${rgbStr(colors.mid)} 52%, ${rgbStr(colors.bot)} 100%)`;
}

/* ============================================================
   天气对天空的调制
   ------------------------------------------------------------
   没有这张表会有个很显眼的错：正午的雷暴顶着大晴天打闪，
   雪花飘在湛蓝的天上。云层的光学厚度会同时做三件事 ——
   压暗、去饱和、把色相往灰蓝/灰白推，另外雪天地面反照率很高，
   会把光反射回天空，所以雪天反而要比阴天更亮一点。

   clear 一行是恒等变换，五个时段的渐变与既有截图完全一致。
   ============================================================ */

const WEATHER_SKY = {
  clear:        { dim: 1.00, desat: 0.00, tint: [255, 255, 255], tintAmt: 0.00, lift: 0.00 },
  cloudy:       { dim: 0.88, desat: 0.14, tint: [158, 172, 190], tintAmt: 0.22, lift: 0.00 },
  overcast:     { dim: 0.78, desat: 0.26, tint: [132, 144, 160], tintAmt: 0.34, lift: 0.00 },
  fog:          { dim: 0.90, desat: 0.20, tint: [190, 198, 208], tintAmt: 0.42, lift: 0.06 },
  drizzle:      { dim: 0.84, desat: 0.20, tint: [124, 140, 160], tintAmt: 0.26, lift: 0.00 },
  rain:         { dim: 0.74, desat: 0.28, tint: [110, 126, 146], tintAmt: 0.34, lift: 0.00 },
  thunderstorm: { dim: 0.60, desat: 0.34, tint: [76, 86, 104],  tintAmt: 0.44, lift: 0.00 },
  snow:         { dim: 0.90, desat: 0.10, tint: [204, 218, 234], tintAmt: 0.32, lift: 0.10 },
};

function scaleRgb(rgb, k) {
  return [clamp(rgb[0] * k, 0, 255), clamp(rgb[1] * k, 0, 255), clamp(rgb[2] * k, 0, 255)];
}

function desatRgb(rgb, amt) {
  if (amt <= 0) return rgb;
  const g = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
  return [lerp(rgb[0], g, amt), lerp(rgb[1], g, amt), lerp(rgb[2], g, amt)];
}

function tintRgb(rgb, tint, amt) {
  return amt <= 0 ? rgb : lerpRgb(rgb, tint, amt);
}

/*
 * tint 的颜色是按「白天的阴云」调的（雨=中灰蓝、雷暴=深灰蓝），它比正午的
 * 淡青蓝暗，正好起压暗作用。但到了夜里，天色本身已经比这个灰还暗，
 * 再往它身上靠就是「染亮」—— 实测 20:30 的雷暴天色会变成 rgb(34,40,53)，
 * 比同时刻的晴夜 rgb(13,18,41) 还亮，昼夜关系直接反了。
 * 所以 tint 比底色亮时，把它压到与底色同亮度，只借它的色相。
 */
function fitTint(tint, base) {
  const lb = relLuminance(base);
  const lt = relLuminance(tint);
  if (lt <= lb || lt < 1e-6) return tint;
  return scaleRgb(tint, lb / lt);
}

function modulateSky(colors, weatherKey) {
  const m = WEATHER_SKY[weatherKey] || WEATHER_SKY.clear;
  // 恒等变换直接放行：clear 天不该被动到哪怕一个色阶
  if (m.dim === 1 && m.lift === 0) return colors;

  // 压暗不是整幅等比：地平线留的余晖更多（云缝里透出的光），
  // 等比压暗会让雨天彻底退化成一块灰板。
  const kTop = m.dim;
  const kMid = m.dim * (1 + (1 - m.dim) * 0.14);
  const kBot = m.dim * (1 + (1 - m.dim) * 0.55);

  const out = {
    top: tintRgb(desatRgb(scaleRgb(colors.top, kTop), m.desat), fitTint(m.tint, colors.top), m.tintAmt * 0.8),
    mid: tintRgb(desatRgb(scaleRgb(colors.mid, kMid), m.desat), fitTint(m.tint, colors.mid), m.tintAmt),
    bot: tintRgb(desatRgb(scaleRgb(colors.bot, kBot), m.desat * 0.74), fitTint(m.tint, colors.bot), m.tintAmt * 0.72),
  };

  if (m.lift > 0) {
    for (const k of ['top', 'mid', 'bot']) {
      const c = out[k];
      out[k] = [clamp(c[0] + 26 * m.lift, 0, 255),
                clamp(c[1] + 28 * m.lift, 0, 255),
                clamp(c[2] + 30 * m.lift, 0, 255)];
    }
  }
  return out;
}

/**
 * 采样某时刻、某天气下最终要画的三层天色
 * @param {number} hour 0-24
 * @param {string} [weatherKey] 见 WEATHER_SKY 的键
 */
export function sampleSkyPalette(hour, weatherKey = 'clear') {
  return modulateSky(sampleSkyColors(hour), weatherKey);
}

/* ============================================================
   墨色匹配
   天空是纵向渐变，页面内容也自上而下铺：顶部品牌区压在 top 色上、
   报告主体压在 mid 色上、页脚压在 bot 色上。所以按纵向权重算一个
   综合亮度，据此决定整页文字用「深墨」还是「白墨」。
   ============================================================ */

/** sRGB 单通道 → 线性亮度（WCAG 相对亮度定义） */
function channelLuminance(c) {
  const x = clamp(c, 0, 255) / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** 一条颜色的相对亮度，0 = 纯黑，1 = 纯白 */
function relLuminance(rgb) {
  return 0.2126 * channelLuminance(rgb[0])
       + 0.7152 * channelLuminance(rgb[1])
       + 0.0722 * channelLuminance(rgb[2]);
}

/* 纵向权重：顶部品牌区最先要看清，给了最高权重 */
const VERTICAL_WEIGHTS = { top: 0.38, mid: 0.34, bot: 0.28 };

/*
 * 阈值标定（实测各时段加权亮度）：
 *   深夜 0.01 / 黎明 0.16 / 日落 0.16 / 黄昏 0.30 / 日出 0.30
 *   正午 0.58 / 下午 0.63 / 早晨 0.67
 * 0.42 落在黄昏与早晨之间：黄昏橙红底仍用白墨，天光大亮后翻深墨。
 */
const INK_THRESHOLD = 0.42;

/**
 * 采样某个时刻的天空明暗，判断该配什么颜色的字
 * @param {number} hour
 * @param {string} [weatherKey] 天气会压暗天空，墨色必须跟着一起算
 * @returns {{luminance:number, ink:'light'|'dark', colors:{top:number[],mid:number[],bot:number[]}}}
 *   ink='light' → 浅色天空，用深墨文字；'dark' → 深色天空，用白墨文字
 */
export function sampleSkyInk(hour, weatherKey = 'clear') {
  const c = sampleSkyPalette(hour, weatherKey);
  const luminance =
    VERTICAL_WEIGHTS.top * relLuminance(c.top) +
    VERTICAL_WEIGHTS.mid * relLuminance(c.mid) +
    VERTICAL_WEIGHTS.bot * relLuminance(c.bot);

  return {
    luminance,
    ink: luminance > INK_THRESHOLD ? 'light' : 'dark',
    colors: c,
  };
}

/**
 * 一次性应用：天空渐变 + 全页墨色 + 视口边缘 tint 条
 * 墨色通过 <html data-ink> 交给 CSS 变量接管
 * @returns {{ink:'light'|'dark', luminance:number, colors:object}}
 *   colors / luminance 同时回给 Canvas 天气场景，让粒子的配色与天空同源。
 */
export function applySkyTheme(hour = new Date().getHours(), weatherKey = 'clear') {
  const { ink, luminance, colors } = sampleSkyInk(hour, weatherKey);

  const backdropEl = document.querySelector('.sky-backdrop') || document.body;
  backdropEl.style.background = generateSkyGradient(colors);

  applyEdgeTint(colors);

  const root = document.documentElement;
  if (root.dataset.ink !== ink) root.dataset.ink = ink;

  return { ink, luminance, colors };
}

/**
 * 同步两条视口边缘采样条的底色（顶部 = 天空 top 色，底部 = bot 色）。
 *
 * 存在的唯一理由：iOS 26 Safari 从「贴着视口边缘的 fixed 元素」的
 * background-color 推导浏览器工具栏底色，而天空层只有 background-image
 * （渐变）、采样不到，于是深色页面上顶着一条纯白横条。详见
 * css/sky-gradient.css 里 .sky-edge-tint 那段注释。
 *
 * 只改明暗不改形态：两条带的颜色就是渐变两端的端点色，边界处差异
 * 两三个色阶，肉眼不可见。
 */
function applyEdgeTint(colors) {
  const top = document.querySelector('.sky-edge-top');
  const bottom = document.querySelector('.sky-edge-bottom');
  if (top) top.style.backgroundColor = rgbStr(colors.top);
  if (bottom) bottom.style.backgroundColor = rgbStr(colors.bot);
}
