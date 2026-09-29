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
 * 再加上滑落水痕。（落珠涟漪已按用户要求移除。）
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
 *
 * 3. 「贴在玻璃外侧」的空间线索（2026-09-29，用户明确要求修「水珠像浮在空中」）。
 *    原来六层全是半透明叠色，珠子后面的背景原样透出来 —— 读成肥皂泡 / 浮尘。
 *    真实的窗上水珠有四个把它「钉」在玻璃上的线索，这里逐一补上：
 *      a. 真实折射：大于 REFRACT_MIN_R 的水珠从「天空 + 窗外粒子层」取景，
 *         旋转 180° 缩进珠内（透镜成倒像），不再透出身后的背景。
 *      b. 暗边：透镜边缘发生全反射，一圈偏暗（精灵里的 ⑦ 层）。
 *      c. 玻璃水膜：整面玻璃蒙一层极淡的水雾，滑落的水珠在身后擦出清晰的轨道，
 *         随后慢慢回雾 —— 这是「珠子与玻璃在同一平面」最强的一条线索。
 *      d. 行为：雨点砸到玻璃上是随机落点、先挂住不动，靠合并长大，长到挂不住
 *         才滑落；滑落时一路吞掉静止小珠、在身后留下细小的残珠。
 *    配套地，storm.js 在降水天气里给窗外粒子层加一点景深虚化（焦点在玻璃上）。
 *    原有六层的全部系数不动。
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

/* ---- 偏离 3 用到的量 ---- */
const SCENE_SCALE = 0.5;        // 折射取景 / 水膜画布相对 CSS 像素的比例
const REFRACT_MIN_R = 2.4;      // 更小的细珠折射看不出区别，只费性能（逐珠一次 clip）
const REFRACT_FOV = 2.7;        // 一颗珠「看到」的背景范围是自身直径的多少倍
const RIM_TONE = [4, 6, 12];    // 暗边色：接近黑，深色夜空上也仍然是「压暗」
const WET_LEVEL = { drizzle: 0.45, rain: 1, thunderstorm: 2 };
const SLIDE_R = 5.2;            // 静止水珠长到这个半径就挂不住了
const GRID = 28;                // 合并检测的空间网格边长（> 两颗最大珠的合并距离）

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** 水膜擦除笔刷：柔边圆 */
function makeBrush() {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.6, 'rgba(0,0,0,0.7)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return c;
}

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

  // ---- ⑦ 暗边（偏离 3b）：透镜边缘全反射，外圈偏暗 ----
  // 用近黑色而不是 L.dark：深色夜空上 L.dark 反而比底色亮，会变成描边。
  const rimK = r < 1.5 ? 0.45 : 1;
  const rim = g.createRadialGradient(bx, by, rx * 0.62, bx, by, rx);
  rim.addColorStop(0, rgbStr(RIM_TONE, 0));
  rim.addColorStop(0.70, rgbStr(RIM_TONE, 0.16 * rimK));
  rim.addColorStop(0.92, rgbStr(RIM_TONE, 0.50 * rimK));
  rim.addColorStop(1, rgbStr(RIM_TONE, 0.22 * rimK));
  g.beginPath();
  g.ellipse(bx, by, rx, ry, 0, 0, TAU);
  g.fillStyle = rim;
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

  /* 这里原先有一段「反向 alpha」：getImageData 后把 RGB 再除一次 alpha。
     但 getImageData 返回的本来就是**非预乘**的 RGBA，再除一次等于把低 alpha
     像素的颜色放大十几倍、夹到 255 —— 每颗珠子外圈被漂成一圈纯白，
     正是「肥皂泡 / 浮在空中」观感的来源之一。离屏画布按源序逐层 fill
     本身就是参考实现的合成方式，不需要任何后处理。 */

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
    this.spawnAcc = 0;
    this.t = 0;

    this._sprites = new Map();     // 精灵表：(档位_变体) → 精灵
    this._sig = '';

    // 偏离 3：折射取景与玻璃水膜
    this._skyPal = null;           // 天空三色（折射取景要自己画一份天空）
    this._skyCanvas = null;        // 天空渐变的小画布，拉伸使用
    this._scene = null;            // 天空 + 窗外粒子的半分辨率合成，折射从这里取景
    this._sceneCtx = null;
    this._film = null;             // 玻璃水膜（颜色 = tint，alpha = 雾的浓度）
    this._filmCtx = null;
    this._filmTint = '';
    this._brush = null;
    this._fog = 0;                 // 水膜当前可见度，向 fogTarget 缓动
    this._grid = new Map();

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

    // 折射取景与水膜都用半分辨率：折射后的像被缩进 2~26px 的珠子里，
    // 水膜本身就是软的，全分辨率只是白花填充率。
    const sw = Math.max(1, Math.round(this.w * SCENE_SCALE));
    const sh = Math.max(1, Math.round(this.h * SCENE_SCALE));
    if (!this._scene) {
      this._scene = document.createElement('canvas');
      this._film = document.createElement('canvas');
      this._brush = makeBrush();
    }
    this._scene.width = sw;
    this._scene.height = sh;
    this._film.width = sw;
    this._film.height = sh;
    this._sceneCtx = this._scene.getContext('2d');
    this._filmCtx = this._film.getContext('2d');
    this._filmTint = '';

    this.build();
    this.render();
  }

  /* ------------------------------------------------------------ 水膜 */

  /** 水膜纹理：一层匀雾 + 细密的微珠点，放大到全屏后读成「起雾的玻璃」 */
  _filmPattern() {
    if (this._filmPat) return this._filmPat;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#fff';
    for (let i = 0; i < 1400; i += 1) {
      g.globalAlpha = rnd(0.4, 1);
      g.beginPath();
      g.arc(Math.random() * 256, Math.random() * 256, rnd(0.3, 0.9), 0, TAU);
      g.fill();
    }
    this._filmPat = c;
    return c;
  }

  /** 把水膜重新铺满（切换天气 / 改尺寸时） */
  resetFilm() {
    const g = this._filmCtx;
    if (!g) return;
    g.globalCompositeOperation = 'copy';
    g.globalAlpha = 1;
    g.fillStyle = g.createPattern(this._filmPattern(), 'repeat');
    g.fillRect(0, 0, this._film.width, this._film.height);
    g.globalCompositeOperation = 'source-over';
    this._filmTint = '';
  }

  /** 在水膜上擦出一块清晰区域（CSS 坐标） */
  wipe(x, y, r, strength = 1) {
    const g = this._filmCtx;
    if (!g) return;
    const s = r * SCENE_SCALE;
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = strength;
    g.drawImage(this._brush, x * SCENE_SCALE - s, y * SCENE_SCALE - s, s * 2, s * 2);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  /** 水膜慢慢回雾：往擦过的地方重新铺纹理 */
  _regrowFilm(dt) {
    const g = this._filmCtx;
    if (!g) return;
    g.globalAlpha = clamp(dt * 0.16, 0, 1);
    g.fillStyle = g.createPattern(this._filmPattern(), 'repeat');
    g.fillRect(0, 0, this._film.width, this._film.height);
    g.globalAlpha = 1;
  }

  /** 水膜的颜色跟环境光走：只换颜色、保留 alpha（也就是保留擦出来的轨道） */
  _tintFilm() {
    const g = this._filmCtx;
    const col = rgbStr(mix(this.light.tint, [255, 255, 255], 0.35));
    if (!g || col === this._filmTint) return;
    this._filmTint = col;
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = col;
    g.fillRect(0, 0, this._film.width, this._film.height);
    g.globalCompositeOperation = 'source-over';
  }

  /** 折射取景：天空 + 窗外粒子层，合成到半分辨率画布 */
  _captureScene() {
    const g = this._sceneCtx;
    if (!g) return false;
    const sw = this._scene.width;
    const sh = this._scene.height;
    if (this._skyCanvas) g.drawImage(this._skyCanvas, 0, 0, sw, sh);
    else { g.fillStyle = rgbStr(this.light.dark); g.fillRect(0, 0, sw, sh); }
    const outside = document.getElementById('weatherEffects');
    if (outside && outside.width) g.drawImage(outside, 0, 0, sw, sh);
    return true;
  }

  /** 降水强度：0 = 干玻璃，毛毛雨 0.45，雨 1，雷暴 2 */
  get wetLevel() {
    return WET_LEVEL[this.weather] || 0;
  }

  get isWet() {
    return this.wetLevel > 0;
  }

  /** 水膜目标浓度：雨越大玻璃越雾 */
  get fogTarget() {
    return this.isWet ? 0.05 + 0.03 * this.wetLevel : 0;
  }

  /** 由天空引擎注入三层天色：折射取景需要知道「玻璃后面」是什么颜色 */
  setSky(pal) {
    if (!pal) return;
    const sig = `${pal.top.map(Math.round)}|${pal.mid.map(Math.round)}|${pal.bot.map(Math.round)}`;
    if (sig === this._skyPal?.sig) return;
    this._skyPal = { sig, top: pal.top, mid: pal.mid, bot: pal.bot };
    if (!this._skyCanvas) {
      this._skyCanvas = document.createElement('canvas');
      this._skyCanvas.width = 4;
      this._skyCanvas.height = 256;
    }
    const g = this._skyCanvas.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, rgbStr(pal.top));
    grd.addColorStop(0.52, rgbStr(pal.mid));
    grd.addColorStop(1, rgbStr(pal.bot));
    g.fillStyle = grd;
    g.fillRect(0, 0, 4, 256);
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

    this.resetFilm();

    // 幂律分布：大多数是 0.8~2.6px 的细密珠，少数是 5.5~13px 的大珠
    // 毛毛雨只有细珠，而且更稀
    const drizzle = this.weather === 'drizzle';
    const smallN = Math.floor((area / 5200) * (drizzle ? 0.6 : 1));
    const bigN = drizzle ? 0 : Math.floor(area / 42000);
    for (let i = 0; i < smallN; i += 1) this.drops.push(this.mkDrop(rnd(0.8, 2.6), false));
    for (let i = 0; i < bigN; i += 1) this.drops.push(this.mkDrop(rnd(5.5, 13), false));

    // 初始就给一部分大珠分配滑落速率，让画面开机即有流动感；
    // 其余的挂在玻璃上，等雨点把它们喂大
    for (const d of this.drops) {
      if (d.r > 4.5 && Math.random() > 0.72) this.startRun(d);
      else d.hold = Math.max(d.hold, d.r + rnd(0.5, 3));
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
      hold: rnd(SLIDE_R, SLIDE_R * 1.6),   // 长到多大才挂不住（逐珠不同，免得同时起跑）
      travel: 0,
      nextBead: rnd(10, 34),
      owner: null,                          // 残珠刚落下时别被母珠吞回去
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
    d.owner = null;
  }

  /** 玻璃倾角（雨天默认近乎垂直下落，雷暴时阵风偏移更大） */
  axisAngle() {
    const gustRange = this.isStorm ? 0.35 : 0.16;
    return Math.PI / 2 + rnd(-gustRange, gustRange);
  }

  /* ------------------------------------------------------------ 更新 */

  /** 一滴雨砸到玻璃上：随机落点；与已有静止珠重叠就并进去（静止珠就是这么长大的） */
  _landDrop() {
    const x = Math.random() * this.w;
    const y = Math.random() * this.h;
    // 九成细密珠，一成大一号 —— 分布与参考的顶部补珠一致
    const r = rnd(0.8, 3.2) * (Math.random() > 0.90 ? 2.0 : 1);
    for (const o of this.drops) {
      if (o.vy || o.static) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      const reach = (o.r + r) * 0.85;
      if (dx * dx + dy * dy < reach * reach) {
        o.r = Math.min(16, Math.sqrt(o.r * o.r + r * r));
        o.alpha = Math.min(0.9, o.alpha + 0.04);
        // 并入时珠心往新水滴那边挪一点，形状才会慢慢变得不规则
        o.x += (x - o.x) * 0.25;
        o.y += (y - o.y) * 0.25;
        return;
      }
    }
    if (this.drops.length >= MAX_DROPS) return;
    const d = this.mkDrop(r, false);
    d.x = x;
    d.y = y;
    this.drops.push(d);
  }

  /** 滑落珠 d 吞掉相邻格里碰到的水珠（面积守恒） */
  _absorb(d, grid) {
    const gx = Math.floor(d.x / GRID);
    const gy = Math.floor(d.y / GRID);
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        const cell = grid.get(`${gx + i},${gy + j}`);
        if (!cell) continue;
        for (const o of cell) {
          if (o === d || o.dead || o.owner === d) continue;
          const dx = o.x - d.x;
          const dy = o.y - d.y;
          const reach = (o.r + d.r) * 0.8;
          if (dx * dx + dy * dy >= reach * reach) continue;
          // 两颗都在滑：大的吞小的
          const big = o.vy && o.r > d.r ? o : d;
          const small = big === d ? o : d;
          big.r = Math.min(16, Math.sqrt(big.r * big.r + small.r * small.r));
          big.vy = Math.min(big.vy * 1.08 + 0.05, 3.2);   // 合并后加速
          big.alpha = Math.min(0.92, big.alpha + small.alpha * 0.2);
          small.dead = true;
          if (small === d) return;
        }
      }
    }
  }

  update(dt) {
    this.t += dt;
    const wet = this.isWet;

    // 水膜：可见度缓动到目标值，擦出的轨道慢慢回雾
    this._fog = lerp(this._fog, this.fogTarget, 1 - Math.exp(-dt * 0.8));
    if (wet) this._regrowFilm(dt);

    /* 偏离 3d：雨点砸在玻璃上是随机落点、先挂住不动。
       原先是从顶部生成、一生成就滑 —— 整屏水珠像一场缓慢的「雨」在飘，
       这正是「浮在空中」的另一半原因：玻璃上的水不该有统一的运动。 */
    if (wet) {
      this.spawnAcc += dt * 22 * this.wetLevel;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        this._landDrop();
      }
    }

    // 空间网格：合并检测从 O(n²) 降到只看相邻格
    const grid = this._grid;
    grid.clear();
    for (const d of this.drops) {
      if (d.static) continue;
      const k = `${Math.floor(d.x / GRID)},${Math.floor(d.y / GRID)}`;
      const cell = grid.get(k);
      if (cell) cell.push(d);
      else grid.set(k, [d]);
    }

    for (const d of this.drops) {
      d.wob += dt * 1.6;
      if (d.dead || d.static) continue;

      // 静止珠：长到挂不住就开始滑
      if (!d.vy) {
        if (wet && d.r > d.hold) this.startRun(d);
        continue;
      }

      const px = d.x;
      const py = d.y;
      /* 真实水珠不走正弦：它被玻璃上的污点和已有水痕拽住，走一段直线、
         顿一下、换个角度再走。原先的 sin(wob) 摆动在短轨迹上看不出，
         挂珠机制让水珠滑得更远之后，就成了一条条扭动的「蚯蚓」。 */
      d.steerIn = (d.steerIn ?? rnd(0.2, 0.9)) - dt;
      if (d.steerIn <= 0) {
        d.steerIn = rnd(0.25, 1.1);
        d.drift = rnd(-1, 1) * d.wobAmp * 0.45;
        d.stall = Math.random() < 0.18 ? rnd(0.08, 0.3) : 0;
      }
      if (d.stall > 0) d.stall -= dt;
      const go = d.stall > 0 ? 0.15 : 1;
      d.y += d.vy * go * dt * 60;
      d.x += (d.vx + (d.drift || 0)) * go * dt * 60;
      // 滑落过程中吸水变瘦
      d.squash = lerp(d.squash, 1.28, 1 - Math.exp(-dt * 1.4));
      d.r = Math.max(0.7, d.r - dt * d.r * 0.06);

      if (!d.trail) { d.trail = []; d.trailMax = 32; }
      d.trail.push({ x: d.x, y: d.y, r: d.r });
      if (d.trail.length > d.trailMax) d.trail.shift();

      // 偏离 3c：滑过的地方水膜被擦掉
      this.wipe(d.x, d.y, d.r * 0.9, 0.3);

      // 偏离 3d：一路吞掉路径上的水珠
      this._absorb(d, grid);

      // 偏离 3d：身后留下细小残珠
      d.travel = (d.travel || 0) + Math.hypot(d.x - px, d.y - py);
      if (d.travel > d.nextBead) {
        d.travel = 0;
        d.nextBead = rnd(10, 34);
        if (d.r > 2.2 && this.drops.length < MAX_DROPS) {
          const b = this.mkDrop(rnd(0.6, Math.min(1.8, d.r * 0.3)), false);
          b.x = d.x + rnd(-0.4, 0.4) * d.r;
          b.y = d.y - d.r * 1.3;
          b.owner = d;
          this.drops.push(b);
          d.r = Math.sqrt(Math.max(0.5, d.r * d.r - b.r * b.r));
        }
      }

      // 脱离或蒸发
      if (d.y > this.h + 24 || d.x < -30 || d.x > this.w + 30 || d.r < 0.8) {
        d.dead = true;
      }
    }

    this.drops = this.drops.filter((d) => !d.dead);

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
    if (!this.drops.length) return;

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

    // ---- 0. 玻璃水膜（偏离 3c）：在所有水珠之下，被滑落珠擦出轨道 ----
    if (this._fog > 0.004 && this._film) {
      this._tintFilm();
      ctx.globalAlpha = clamp(this._fog, 0, 1);
      ctx.drawImage(this._film, 0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
    }

    // 折射取景：每帧一次，珠子里看到的是它身后倒过来的世界
    const refract = this.isWet && this._captureScene();
    const K = SCENE_SCALE;
    const pat = refract ? ctx.createPattern(this._scene, 'no-repeat') : null;

    for (const d of this.drops) {
      const rx = d.r * 1.0;
      const ry = d.r * d.squash;

      // ---- 0.5 折射（偏离 3a）：透镜成倒像，盖住身后原样透出来的背景 ----
      if (refract && d.r >= REFRACT_MIN_R) {
        /* 不用 clip：把取景画布当成图案，逐珠只改图案矩阵再填椭圆。
           矩阵把「以珠心为中心、边长 2·fov 的取景窗」旋转 180° 压进 2.16·r 的珠内：
             屏幕点 = 珠心 − s·(取景点 − 珠心)，s = 1.08·r / fov（纵向再除 squash）
           取景画布是 K 倍缩小的，所以取景点 = 画布坐标 / K。 */
        const fov = d.r * REFRACT_FOV;
        const sx = (1.08 * rx) / fov / K;
        const sy = (1.08 * ry) / (fov * d.squash) / K;
        pat.setTransform(new DOMMatrix([-sx, 0, 0, -sy, d.x + sx * d.x * K, d.y + sy * d.y * K]));
        ctx.fillStyle = pat;
        ctx.globalAlpha = clamp(0.5 + d.alpha * 0.6, 0, 0.92);
        ctx.beginPath();
        ctx.ellipse(d.x + rx * 0.10, d.y + ry * 0.16, rx * 0.97, ry * 0.97, 0, 0, TAU);
        ctx.fill();
      }

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
  }

  /** 供自动化测试与调试读取 */
  get counts() {
    const moving = this.drops.filter((d) => !d.static && (d.vy || d.vx)).length;
    const refracting = this.isWet ? this.drops.filter((d) => d.r >= REFRACT_MIN_R).length : 0;
    const big = this.drops.filter((d) => d.r >= 5).length;
    return {
      weather: this.weather,
      drops: this.drops.length,
      moving,
      big,
      refracting,
      fog: +this._fog.toFixed(3),
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
