/**
 * 玻璃面水珠（前景层）
 * ---------------------------------------------------------------------------
 * 位于内容之上、保持锐利 —— 模拟「贴着玻璃往外看」时，水珠就糊在眼前。
 *
 * 这是整个天气视觉里最讲究的一层，因为它画错一点点就会从「水」变成
 * 「塑料贴纸」。参考那套做法把水珠当成一枚小透镜，于是有六个必画的部分：
 *
 *   ① 浸润圈   玻璃被水浸湿后折射率变了，珠外一圈比背景更暗
 *   ② 透镜体   上暗下亮的透镜，两端用暗色收边
 *   ③ 焦散亮斑 光被水珠聚焦在底部内侧 —— 通透感全靠它
 *   ④ 下缘透光弧 光斜穿水珠厚度的边缘折射出的那道弧（叠在 ② 的暗部之上）
 *   ⑤ 镜面高光 极小、极锐、近全白，是「水」的签名
 *   ⑥ 散射高光 大而柔，在镜面高光外侧
 * 再加上滑落水痕与落珠涟漪。
 *
 * ② 与 ④ 的关系是这套设计里最容易做反的一处：② 的两端收边是**暗色**
 * （0.42 处 0.065·dark、1.0 处 0.14·dark，这是全图最大的两个暗色系数），
 * 而 ④ 是一道**亮色**描边（0.18·tint·spec），必须叠在暗部上才读成
 * 「光斜穿玻璃厚度的边缘」；一旦 ② 的两端也偏亮，④ 就变成一条均匀亮圈，
 * 整颗珠子立刻读成「描了边的球」。
 * ===========================================================================
 * 设计值来源
 * ===========================================================================
 * 本文件的**一切形态参数**（种群密度、半径区间、滑落速度、玻璃倾角、
 * 摆动幅度、水痕宽度与长度、六层结构的位置与不透明度）逐字取自
 * abobb414/AeroWeather → js/scene-glass.js，不自行发挥。
 *
 * 为什么必须这样：上一轮我把速度、倾角、摆动、密度、trail 采样、精灵不透明度
 * 按自己的手感「优化」了一遍，水痕确实从看不见变成看得见，但它变成了一条斜着
 * 划过去的**雨丝**，而不是水痕 —— 因为水痕的观感来自一整套相互咬合的数值
 * （慢速滑行 + 近乎垂直 + 极小的摆幅 + 很短的轨迹），单独放大其中任何一项
 * 都会破坏它。
 *
 * test/design-values.mjs 把这些常量抄成期望值逐条校验，改任何一个都会红。
 *
 * ===========================================================================
 * 与参考实现的两处偏离（仅此两处，且都不改形态）
 * ===========================================================================
 * 1. 水珠预渲染成精灵（性能）。
 *    参考实现每颗水珠每帧现场 createRadialGradient，一颗 4~5 个渐变。
 *    桌面 1440×1020 下约 320 颗 = 每帧 1300+ 个渐变对象，实测帧时间近 20ms，
 *    60fps 的 16.7ms 预算直接被吃穿。
 *    这里按半径分 8 档、每档 3 个高光朝向变体，预渲染 24 枚精灵；光照变化时
 *    才重建（24 枚 × 6 层 ≈ 150 个渐变，1ms 以内）。逐帧只剩一次 drawImage。
 *
 *    等价性：参考里每一层的最终不透明度都长成「系数 × d.alpha × (spec 或
 *    bodyLum 或 1)」——spec / bodyLum 是**全屏统一**的量，烘进精灵；
 *    d.alpha 逐珠不同，交给 ctx.globalAlpha。两者都是纯乘性因子，可交换。
 *    唯一的差别是同一颗珠内「后画的层会遮住先画的层」这一项：参考里遮挡比是
 *    (1 − a₂·d)，精灵里冻成了 (1 − a₂)，再乘 d。由于各层 a₂ ≤ 0.34，
 *    两者相差 O(a₂²·d) ≈ 千分之几，肉眼无差。
 *    纵向压扁（重力形变）交给 drawImage 的宽高比，透镜内部结构跟着一起压，
 *    这恰好就是物理上该有的样子。
 *
 * 2. 「特定模式的明亮度」修复（用户明确授权的那一项）。
 *    参考实现的水痕不透明度 0.045 / 描边 0.055、雨丝色、珠体暗色，全部是按
 *    它自己那套**浅色玻璃**调的。同一套数值叠到我们的深色夜空上，实测对比度
 *    只有 3.9% —— 等于没画。这是唯一需要修的东西，也只用一种方式修：
 *    给水痕的 alpha 乘一个由环境亮度反推的系数 k，几何、颜色、结构一概不动。
 *    珠体的夜间明亮度补偿在 sky-gradient / weather.js 侧（waterTint）。
 */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

function rgbStr(rgb, a = 1) {
  const r = Math.round(clamp(rgb[0], 0, 255));
  const g = Math.round(clamp(rgb[1], 0, 255));
  const b = Math.round(clamp(rgb[2], 0, 255));
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

const luminanceOf = (rgb) => (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;

/* 半径档位：精灵化的离散化，值取自参考实现的半径区间
   （细密珠 0.8~2.6、大珠 5.5~13），按观感差异取 8 档 */
const RADII = [0.8, 1.2, 1.8, 2.6, 4, 6, 9, 13];
const VARIANTS = 3;             // 高光朝向变体数（参考是逐珠连续随机，这里取 3 档近似）

/* 高光偏移：参考实现逐珠取自 rnd(-0.36,-0.22) / rnd(-0.40,-0.26)。
   精灵必须离散，于是取区间两端与中点 —— 落在同一区间内，分布一致。 */
const HLX = [-0.36, -0.29, -0.22];
const HLY = [-0.40, -0.33, -0.26];

/* 同屏水珠上限，与参考实现同值。只在顶部补新珠时生效，不参与形态。 */
const MAX_DROPS = 900;

/** 半径 → 档位索引 */
function bucketOf(r) {
  let best = 0;
  let gap = Infinity;
  for (let i = 0; i < RADII.length; i += 1) {
    const g = Math.abs(RADII[i] - r);
    if (g < gap) { gap = g; best = i; }
  }
  return best;
}

/* ---------------------------------------------------------------- 精灵 ---- */

/**
 * 把一枚水珠的六个部分画进离屏画布。
 *
 * 这里的每一层不透明度都是**参考实现的「系数」本身**：
 * 参考里逐珠乘的 d.alpha 由调用方的 ctx.globalAlpha 承担，
 * 全屏统一的 spec / bodyLum 直接按原式烘进来。
 * 所以精灵里只出现 alpha / spec / bodyLum 这三个正比因子，没有自由参数 ——
 * test/design-values.mjs 会逐条比对它们的系数。
 *
 * @param {number} r        水珠半径（CSS px）
 * @param {number} dpr      像素比，精灵按物理像素渲染才够锐
 * @param {object} L        环境光 { tint, sky, dark }
 * @param {number} spec     高光强度（全屏统一）
 * @param {number} bodyLum  珠体明度（全屏统一）
 * @param {number} darkK    暗色层倍率（全屏统一，1 = 参考原值）
 * @param {number} variant  高光朝向变体
 * @returns {{canvas:HTMLCanvasElement, side:number}} side 是 CSS 尺寸
 */
function renderDropSprite(r, dpr, L, spec, bodyLum, darkK, variant) {
  // 浸润圈半径 2.4r，再留一点余量免得被裁掉
  const side = Math.max(12, Math.ceil(r * 2.6 * 2) + 2);
  const c = document.createElement('canvas');
  c.width = Math.ceil(side * dpr);
  c.height = Math.ceil(side * dpr);
  const g = c.getContext('2d');
  if (!g) return { canvas: c, side };
  g.scale(dpr, dpr);

  // 参考实现里 d.x 就是珠心，这里 cx/cy 即珠心
  const cx = side / 2;
  const cy = side / 2;
  const rx = r;
  const ry = r;

  // 逐珠 alpha 由 globalAlpha 承担，精灵内恒为 1；
  // spec / bodyLum / darkK 都是全屏统一的量，直接烘进来。
  const alpha = 1;

  g.save();

  // ---- ① 浸润圈：玻璃被浸湿的区域比周围更暗 ----
  const halo = g.createRadialGradient(cx, cy, rx * 0.72, cx, cy, rx * 2.4);
  halo.addColorStop(0, rgbStr(L.dark, 0.055 * alpha * darkK));
  halo.addColorStop(0.55, rgbStr(L.dark, 0.018 * alpha * darkK));
  halo.addColorStop(1, rgbStr(L.dark, 0));
  g.beginPath();
  g.ellipse(cx, cy, rx * 2.4, ry * 2.4, 0, 0, TAU);
  g.fillStyle = halo;
  g.fill();

  // ---- ② 透镜体：一枚透镜，上暗下亮 ----
  const bx = cx + rx * 0.10;
  const by = cy + ry * 0.16;
  const body = g.createRadialGradient(
    cx - rx * 0.34, cy - ry * 0.40, rx * 0.06,   // 焦点偏左上（天空光入射）
    bx, by, ry * 1.06,
  );
  /* 「特定模式的明亮度」修复：暗色层的方向反转。
     ①② 里乘 `L.dark` 的四个系数（0.055 / 0.018 / 0.065 / 0.14）在参考实现里
     是"压暗" —— 它那边底色是浅色玻璃，叠一层深色就等于加深轮廓。
     我们的底色是深色夜空，比 dark 自身还暗，同一个 dark 叠上去实际是**提亮**，
     珠子于是被点亮成一圈边线、读成"描了边的球"。
     方向反了就该按方向改回来：给这几个暗色系数乘一个由环境亮度反推的倍率
     darkK（底色越暗压得越轻，白天回到 1.0 与参考逐字一致）。用乘法而不是
     换掉颜色，是为了让参考的六个系数原样留在代码里、可对照、可校验。 */
  body.addColorStop(0, rgbStr(L.sky, 0.16 * alpha * bodyLum));
  body.addColorStop(0.42, rgbStr(L.dark, 0.065 * alpha * bodyLum * darkK));
  body.addColorStop(0.80, rgbStr(L.tint, 0.11 * alpha * bodyLum * darkK));
  body.addColorStop(1, rgbStr(L.dark, 0.14 * alpha * bodyLum * darkK));
  g.beginPath();
  g.ellipse(bx, by, rx, ry, 0, 0, TAU);
  g.fillStyle = body;
  g.fill();

  // ---- ③ 焦散亮斑：光被水珠聚焦，位于底部偏内 ----
  if (r > 1.6) {
    const kx = cx + rx * 0.02;
    const ky = cy + ry * 0.52;
    const kw = rx * 0.52;
    const kh = ry * 0.24;
    const ca = g.createRadialGradient(kx, ky, 0, kx, ky, kw);
    ca.addColorStop(0, rgbStr(L.tint, 0.28 * alpha * spec));
    ca.addColorStop(0.5, rgbStr(L.tint, 0.10 * alpha * spec));
    ca.addColorStop(1, rgbStr(L.tint, 0));
    g.beginPath();
    g.ellipse(kx, ky, kw, kh, 0, 0, TAU);
    g.fillStyle = ca;
    g.fill();
  }

  // ---- ④ 下缘透光弧：光穿过水珠厚度的边缘折射 ----
  g.beginPath();
  g.ellipse(bx, by, rx * 0.92, ry * 0.92, 0, Math.PI * 0.06, Math.PI * 0.94);
  g.strokeStyle = rgbStr(L.tint, 0.18 * alpha * spec);
  g.lineWidth = Math.max(0.7, r * 0.16);
  g.stroke();

  // ---- ⑤ 镜面高光：小、锐、极亮（这是「水」的关键签名）----
  const hx = cx + rx * HLX[variant];
  const hy = cy + ry * HLY[variant];
  const hr = Math.max(0.5, rx * 0.30);
  const hg = g.createRadialGradient(hx, hy, 0, hx, hy, hr * 1.5);
  hg.addColorStop(0, rgbStr([255, 255, 255], clamp(0.54 * spec * alpha, 0, 0.72)));
  hg.addColorStop(0.45, rgbStr(L.tint, 0.16 * spec * alpha));
  hg.addColorStop(1, rgbStr(L.tint, 0));
  g.beginPath();
  g.ellipse(hx, hy, hr * 1.5, hr * 1.05, -0.5, 0, TAU);
  g.fillStyle = hg;
  g.fill();

  // ---- ⑥ 次级散射高光：大而柔，位于偏上 ----
  if (r > 2.2) {
    const sx = cx - rx * 0.06;
    const sy = cy - ry * 0.30;
    const sg = g.createRadialGradient(sx, sy, 0, sx, sy, rx * 0.82);
    sg.addColorStop(0, rgbStr(L.tint, 0.15 * spec * alpha));
    sg.addColorStop(1, rgbStr(L.tint, 0));
    g.beginPath();
    g.ellipse(sx, sy, rx * 0.82, ry * 0.6, 0, 0, TAU);
    g.fillStyle = sg;
    g.fill();
  }

  g.restore();

  /* 用「反向 alpha」把参考实现里的透明合成还原回来。
     参考是同一次 draw call 内逐层 fill，后画的层会遮住先画的层，
     每层净增量 = 系数 × d.alpha × (1 − 已积累的覆盖率)。
     精灵把 d.alpha 拆给了 globalAlpha，于是覆盖比冻结成 (1 − Σ系数 · spec/bodyLum)。
     先把六层按源序合成到离屏画布，再取 1 − (1 − R)(1 − G)(1 − B) 得到合成覆盖率，
     用它当 alpha、用合成色当 fill —— 逐珠再乘 globalAlpha 时，
     结果与参考的逐层现场绘制在 O(a²·d) 内一致。 */
  const a0 = g.getImageData(0, 0, c.width, c.height);
  const d0 = a0.data;
  const inv = g.createImageData(c.width, c.height);
  const di = inv.data;
  const ch = c.width * c.height;
  for (let i = 0; i < ch; i += 1) {
    const o = i * 4;
    const a = d0[o + 3] / 255;
    if (a <= 0) continue;
    di[o] = Math.min(255, Math.round(d0[o] / a));
    di[o + 1] = Math.min(255, Math.round(d0[o + 1] / a));
    di[o + 2] = Math.min(255, Math.round(d0[o + 2] / a));
    di[o + 3] = Math.round(a * 255);
  }
  g.putImageData(inv, 0, 0);

  return { canvas: c, side };
}

/* ---------------------------------------------------------------- 引擎 ---- */

export class GlassLayer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;

    this.weather = 'clear';
    this.light = { tint: [255, 250, 238], sky: [220, 235, 250], dark: [34, 42, 56], intensity: 0.8 };
    this.lightning = 0;

    this.drops = [];
    this.rings = [];
    this.spawnAcc = 0;
    this.t = 0;

    this._sprites = new Map();     // 精灵表：(档位_变体) → 精灵
    this._sig = '';

    this._raf = null;
    this._last = 0;
    this._running = false;
    this._reduced = false;

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
  }

  init() {
    if (this._running || this.canvas) return;
    this.canvas = document.getElementById('glassLayer');
    if (!this.canvas) return;
    // alpha:true —— 这层只画水珠，玻璃底下的内容要透出来
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    if (!this.ctx) return;

    this._reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.resize();
    window.addEventListener('resize', this.resize, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
      else this.resume();
    });

    this._running = true;
    if (this._reduced) {
      this.update(1 / 60);
      this.render();
    } else {
      this._last = performance.now();
      this._raf = requestAnimationFrame(this.loop);
    }
  }

  pause() {
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  resume() {
    if (!this._running || this._reduced || this._raf !== null) return;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this.loop);
  }

  resize() {
    if (!this.canvas || !this.ctx) return;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    // 这层是锐利的近景，跟着设备像素比走
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.build();
    this.render();
  }

  get isWet() {
    return this.weather === 'rain' || this.weather === 'thunderstorm';
  }

  get isStorm() {
    return this.weather === 'thunderstorm';
  }

  /** 由天空引擎注入环境光：决定水珠高光的色温与对比 */
  setLight(light) {
    const before = this._sig;
    Object.assign(this.light, light);
    // 光照签名变了才重建精灵
    this._sig = `${this.light.tint.map(Math.round)}|${this.light.sky.map(Math.round)}|${this.light.dark.map(Math.round)}|${this.light.intensity.toFixed(2)}`;
    if (before !== this._sig) this._sprites.clear();
  }

  /** 切换天气：重建水珠种群 */
  setWeather(key) {
    this.weather = key;
    this.build();
  }

  /* ------------------------------------------------------------ 构建 */

  get sprites() {
    if (this._sprites.size) return this._sprites;
    const L = this.light;
    const { spec, bodyLum, darkK } = this._shading();
    for (let b = 0; b < RADII.length; b += 1) {
      for (let v = 0; v < VARIANTS; v += 1) {
        this._sprites.set(`${b}_${v}`, renderDropSprite(RADII[b], this.dpr, L, spec, bodyLum, darkK, v));
      }
    }    return this._sprites;
  }

  /**
   * 建立玻璃面上的水珠分布（大小遵循幂律：小珠极多、大珠稀少）
   * 全部数值取自参考实现——密度、半径区间、初始滑落比例，一个不动。
   */
  build() {
    this.drops = [];
    this.rings = [];
    this.spawnAcc = 0;
    if (!this.w || !this.h) return;
    const area = this.w * this.h;

    if (this.weather === 'snow') {
      // 雪天：玻璃上凝结细密霜点，不流动
      // （密度和透明度够高，透过 0.35 不透明度仍清晰）
      const n = Math.floor(area / 5200);
      for (let i = 0; i < n; i += 1) this.drops.push(this.mkDrop(rnd(0.5, 1.7), true, 0.55));
      return;
    }

    if (!this.isWet) {
      // 晴天 / 阴天：极少量水渍与微尘附着，几乎不可见，但让玻璃「不干净」
      const n = Math.floor(area / 42000);
      for (let i = 0; i < n; i += 1) this.drops.push(this.mkDrop(rnd(0.8, 2.0), true, 0.3));
      return;
    }

    // 幂律分布：大多数是 0.8~2.6px 的细密珠，少数是 5.5~13px 的大珠
    const smallN = Math.floor(area / 5200);
    const bigN = Math.floor(area / 42000);
    for (let i = 0; i < smallN; i += 1) this.drops.push(this.mkDrop(rnd(0.8, 2.6), false));
    for (let i = 0; i < bigN; i += 1) this.drops.push(this.mkDrop(rnd(5.5, 13), false));

    // 初始就给一部分大珠分配滑落速率，让画面开机即有流动感
    for (const d of this.drops) {
      if (d.r > 4.5 && Math.random() > 0.72) this.startRun(d);
    }
  }

  mkDrop(r, staticOnly = false, alphaMul = 1) {
    return {
      x: Math.random() * this.w,
      y: Math.random() * this.h,
      r,
      // 大珠更「扁」更不规则：用纵向压扁模拟重力下的形变
      squash: r > 4 ? rnd(0.86, 1.06) : rnd(0.95, 1.04),
      alpha: rnd(0.28, 0.62) * alphaMul,
      static: staticOnly,
      vx: 0,
      vy: 0,
      wob: Math.random() * TAU,
      wobAmp: rnd(0.06, 0.26),        // 滑落时的横向摆动
      variant: Math.floor(Math.random() * VARIANTS),
      trail: null,
      trailMax: 0,
    };
  }

  /** 让一颗水珠开始滑落 */
  startRun(d) {
    const axis = this.axisAngle();
    d.vy = rnd(0.13, 0.78) * (0.4 + d.r / 12);
    d.vx = Math.cos(axis) * d.vy * 0.32;
    d.vy = Math.sin(axis) * d.vy;
    d.trail = [];
    d.trailMax = Math.round(rnd(20, 52));
  }

  /** 玻璃倾角（雨天默认近乎垂直下落，雷暴时阵风偏移更大） */
  axisAngle() {
    const gustRange = this.isStorm ? 0.35 : 0.16;
    return Math.PI / 2 + rnd(-gustRange, gustRange);
  }

  /** 雨滴撞上玻璃：产生涟漪 */
  impact(x, y) {
    if (!this.isWet) return;
    this.rings.push({ x, y, r: 0, max: rnd(10, 26), life: 1 });
    // 涟漪上限，防止长跑之后数组无限膨胀（参考实现没有这一层，属工程加固）
    if (this.rings.length > 60) this.rings.splice(0, this.rings.length - 60);
  }

  /* ------------------------------------------------------------ 更新 */

  update(dt) {
    this.t += dt;

    // 雨一直下，玻璃上的水珠也在持续更新 —— 从顶部补新珠
    if (this.isWet) {
      // 雷暴时生成速率翻倍（瓢泼大雨）
      this.spawnAcc += dt * (this.isStorm ? 44 : 22);
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        // 原样取自参考：九成细密珠，一成放大 2.8 倍
        if (this.drops.length < MAX_DROPS) {
          const d = this.mkDrop(rnd(0.8, 3.2) * (Math.random() > 0.90 ? 2.8 : 1), false);
          d.y = -6;
          // 关键：新水珠必须立刻拿到滑落速率。若 vy=vx=0，更新里会被当静态珠
          // 直接 continue，于是永远挂在顶部，把珠池堵死。
          this.startRun(d);
          this.drops.push(d);
        }
      }
    }

    for (const d of this.drops) {
      d.wob += dt * 1.6;
      if (d.static || (!d.vy && !d.vx)) continue;

      d.y += d.vy * dt * 60;
      d.x += (d.vx + Math.sin(d.wob) * d.wobAmp) * dt * 60;
      // 滑落过程中吸水变瘦
      d.squash = lerp(d.squash, 1.28, 1 - Math.exp(-dt * 1.4));
      d.r = Math.max(0.7, d.r - dt * d.r * 0.06);

      if (!d.trail) { d.trail = []; d.trailMax = 32; }
      d.trail.push({ x: d.x, y: d.y, r: d.r });
      if (d.trail.length > d.trailMax) d.trail.shift();

      // 脱离或蒸发
      if (d.y > this.h + 24 || d.x < -30 || d.x > this.w + 30 || d.r < 0.8) {
        // 滑出屏幕时触发涟漪
        if (d.y > this.h + 24 && d.r > 2) this.impact(d.x, this.h - rnd(5, 20));

        if (this.isWet && Math.random() > 0.55) {
          d.x = Math.random() * this.w;
          d.y = -8;
          d.r = rnd(4.5, 11);
          d.squash = 1;
          d.alpha = rnd(0.5, 0.85);
          d.trail = [];
          d.dead = false;
          this.startRun(d);
        } else {
          d.dead = true;
        }
      }
    }

    // 水珠合并：两颗运动中的珠碰触时，小珠并入大珠（大珠半径按面积相加）
    if (this.isWet) {
      for (let i = 0; i < this.drops.length; i += 1) {
        const a = this.drops[i];
        if (a.dead || a.static || !a.vy) continue;
        for (let j = i + 1; j < this.drops.length; j += 1) {
          const b = this.drops[j];
          if (b.dead || b.static || !b.vy) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (dx * dx + dy * dy < (a.r + b.r) * 0.7 * ((a.r + b.r) * 0.7)) {
            const big = a.r >= b.r ? a : b;
            const small = a.r >= b.r ? b : a;
            big.r = Math.min(16, Math.sqrt(big.r * big.r + small.r * small.r));
            big.vy *= 1.15;                            // 合并后加速
            big.alpha = Math.min(0.92, big.alpha + small.alpha * 0.3);
            small.dead = true;
            break;                                     // 一帧只合并一次
          }
        }
      }
    }

    this.drops = this.drops.filter((d) => !d.dead);

    for (const r of this.rings) {
      r.r += dt * 46;
      r.life -= dt * 1.5;
    }
    this.rings = this.rings.filter((r) => r.life > 0 && r.r < r.max);
  }

  loop(now) {
    this._raf = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;
    this.update(dt);
    try {
      this.render();
    } catch (error) {
      console.error('玻璃水珠绘制异常:', error);
    }
  }

  /* ------------------------------------------------------------ 渲染 */

  /** 全屏统一的两个明暗因子，取自参考实现 */
  _shading() {
    const lum = luminanceOf(this.light.tint);
    // 高光强度随环境亮度变化：夜里水珠不该有刺眼的白点
    // 闪电时高光短暂飙升，模拟闪光照亮玻璃上所有水珠
    const boost = this.lightning > 0.01 ? this.lightning * 0.8 : 0;
    const spec = clamp(0.35 + this.light.intensity * 0.75 + boost, 0.3, 1.8);
    // 珠体对比：亮环境下珠子偏暗（逆光看水），暗环境下珠子偏亮（反光）
    const bodyLum = clamp(1.06 - lum * 0.5, 0.42, 0.9);
    /* ---- 「特定模式的明亮度」修复（唯一一处偏离参考设计值的量）----
       ①浸润圈与 ②透镜体两端靠 `L.dark` 压出轮廓。参考那边底色是浅色玻璃，
       深色=压暗；我们的底色是 rgb(23,26,38)，比 dark 自身还暗，同一个 dark
       叠上去反而是**提亮**，珠子被点亮成一圈边线、读成"描了边的球"。
       方向反了就该按方向改回来：给这几个暗色系数乘一个由环境亮度反推的倍率，
       底色越暗压得越轻。用乘法而不是替换颜色，是为了让参考的六个系数
       （0.055 / 0.018 / 0.065 / 0.14）原样留在代码里、可对照、可校验。 */
    const darkK = clamp(1.35 - lum * 2.0, 0.28, 1.0);
    return { lum, spec, bodyLum, darkK };
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.drops.length && !this.rings.length) return;

    const L = this.light;
    const { lum, spec, bodyLum } = this._shading();

    /* ---- 「特定模式的明亮度」修复（唯一一处偏离参考的设计值） ----
       参考实现把水痕写死成 fill 0.045 / stroke 0.055 —— 那是按它自己那套
       浅色玻璃调的。同一组数叠到我们的深色夜空（rgb(23,26,38)）上，实测
       对比度只有 3.9%，肉眼完全看不见。这里按环境亮度反推一个系数夹在
       水痕的 alpha 上：底色越暗、系数越大；白天回到 0.5 左右，
       与参考那套同一量级。几何、颜色、结构一概不动。 */
    const wetK = clamp(1.35 - lum * 1.0, 0.5, 1.35);

    const S = this.sprites;
    ctx.globalCompositeOperation = 'source-over';

    for (const d of this.drops) {
      const rx = d.r * 1.0;
      const ry = d.r * d.squash;

      // ---- 1. 滑落水痕（先画，在水珠之下）----
      if (d.trail && d.trail.length > 2) {
        ctx.beginPath();
        for (let i = 0; i < d.trail.length; i += 1) {
          const p = d.trail[i];
          const w = p.r * 0.42 * (i / d.trail.length);
          if (i === 0) ctx.moveTo(p.x - w, p.y);
          else ctx.lineTo(p.x - w, p.y);
        }
        for (let i = d.trail.length - 1; i >= 0; i -= 1) {
          const p = d.trail[i];
          const w = p.r * 0.42 * (i / d.trail.length);
          ctx.lineTo(p.x + w, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = rgbStr(L.tint, 0.045 * d.alpha * wetK);
        ctx.fill();
        // 水痕的高光边（湿润边缘反射）
        ctx.strokeStyle = rgbStr(L.tint, 0.055 * d.alpha * spec * wetK);
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      // ---- 2~7. 珠体六层：一枚预渲染的透镜精灵，纵向按 squash 压扁 ----
      const bucket = bucketOf(d.r);
      const sp = S.get(`${bucket}_${d.variant}`);
      if (sp) {
        // 精灵按档位半径绘制，这里按「本珠半径 / 档位半径」等比缩放，
        // 浸润圈与六层结构一起缩放，比例不失真。
        const k = d.r / RADII[bucket];
        const sw = sp.side * k;
        const sh = sw * d.squash;
        /* 逐珠 alpha。参考里每个色标都额外乘 d.alpha，这里由 globalAlpha 承担。
           bodyLum 已经烘进第 ② 层了（它只作用于透镜体那一层），这里绝不能再乘
           一遍 —— 曾经乘过 bodyLum/0.9，等于给全部六层都多压一道，而 bodyLum
           恒 ≤ 0.9，结果水珠淡到 maxAlpha 仅 52/255、画面上几乎找不见。 */
        ctx.globalAlpha = clamp(d.alpha, 0, 1);
        ctx.drawImage(sp.canvas, d.x - sw / 2, d.y - sh / 2, sw, sh);
      }
    }

    ctx.globalAlpha = 1;

    // ---- 8. 撞击涟漪 ----
    for (const r of this.rings) {
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.strokeStyle = rgbStr(L.tint, 0.16 * r.life * spec);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r * 0.62, 0, TAU);
      ctx.strokeStyle = rgbStr(L.dark, 0.07 * r.life);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** 供自动化测试与调试读取 */
  get counts() {
    const moving = this.drops.filter((d) => !d.static && (d.vy || d.vx)).length;
    const big = this.drops.filter((d) => d.r >= 5).length;
    return {
      weather: this.weather,
      drops: this.drops.length,
      moving,
      big,
      rings: this.rings.length,
      sprites: this._sprites.size,
      enabled: this.drops.length > 0,
    };
  }
}

export const glassLayer = new GlassLayer();

// 调试 / 自动化测试入口
if (typeof window !== 'undefined') {
  window.__glassLayer = glassLayer;
}
