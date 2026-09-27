/**
 * 窗外天气场景（Canvas 覆盖层）
 * ---------------------------------------------------------------------------
 * 取代原先的 DOM + CSS 动画粒子（.rain-drop / .snow-flake / .lightning）。
 * 换掉的理由很直接：CSS keyframes 只能让整个元素平移，做不到这四件事 ——
 *   ① 逐粒子景深（远处雨丝更细更淡、雪分远近三层）
 *   ② 柔和雪花球（径向渐变，不是 border-radius 的硬边圆）
 *   ③ 分叉的闪电路径
 *   ④ 粒子颜色随时段联动（夜里雨丝是冷灰蓝，白天是亮白）
 * 而这四件事恰好是「像真的」和「像贴纸」的分界。
 *
 * 层序（canvas 是 z-index:-1 的透明覆盖层，天空渐变由 .sky-backdrop 在更下层）：
 *   地平线暖光带 → 星空 → 雾霾 → 雨 / 雪 → 闪电照亮 → 闪电枝干
 *
 * 性能上有三处刻意偏离参考实现的改动：
 *   1. 雪球 / 散景球预渲染成离屏精灵，逐帧只做 drawImage。
 *      参考实现是每片雪每帧新建一个 createRadialGradient —— 300 片就是
 *      每帧 300 个渐变对象，那是它移动端掉帧的主因。
 *   2. 逐粒子透明度走 ctx.globalAlpha，不拼 rgba() 字符串，省掉每帧上千次
 *      字符串分配（参考实现每个雨丝每帧拼一次 strokeStyle）。
 *   3. 闪电不用任何定时器，改成逐帧状态机。DOM 版本曾有「切走天气后旧定时器
 *      继续闪、每切一次多留一个」的泄漏；换成状态机后这个 bug 在结构上不可能
 *      再出现 —— 没有可泄漏的句柄。
 */

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

function rgbStr(rgb, a = 1) {
  const r = Math.round(clamp(rgb[0], 0, 255));
  const g = Math.round(clamp(rgb[1], 0, 255));
  const b = Math.round(clamp(rgb[2], 0, 255));
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ---------------------------------------------------------------- 天气档位 */

/*
 * 一个天气键 → 降水形态 / 粒子密度 / 遮星程度 / 雾霾增量。
 * occlusion 与 sky-gradient.js 的调制表分头维护：那张表管「颜色被压多暗」，
 * 这张管「星星还看不看得见」——两者相关但不等价（雾天很亮却同样看不见星）。
 */
const PROFILE = {
  clear:        { precip: 'none',  density: 0,    occlusion: 0.04, haze: 0.00 },
  cloudy:       { precip: 'none',  density: 0,    occlusion: 0.58, haze: 0.05 },
  overcast:     { precip: 'none',  density: 0,    occlusion: 0.88, haze: 0.10 },
  fog:          { precip: 'none',  density: 0,    occlusion: 0.84, haze: 0.40 },
  drizzle:      { precip: 'rain',  density: 0.55, occlusion: 0.72, haze: 0.08 },
  rain:         { precip: 'rain',  density: 1.00, occlusion: 0.92, haze: 0.14 },
  thunderstorm: { precip: 'storm', density: 1.35, occlusion: 1.00, haze: 0.18 },
  snow:         { precip: 'snow',  density: 1.00, occlusion: 0.82, haze: 0.24 },
};

/* ---------------------------------------------------------------- 精灵工厂 */

/**
 * 预渲染一个柔和的径向渐变球。
 * 整条链路上只有启动时调几次，之后每片雪每帧只花一次 drawImage。
 */
function makeSoftSprite(size, stops, tone) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [p, a] of stops) grd.addColorStop(p, rgbStr(tone, a));
  g.fillStyle = grd;
  g.beginPath();
  g.arc(r, r, r, 0, TAU);
  g.fill();
  return c;
}

const SNOW_WHITE = [255, 255, 255];
const SHADE_TONE = [22, 32, 50];

let SPRITE = null;
/** 精灵只依赖「有没有 document」，渲染开始前建一次即可 */
function sprites() {
  if (SPRITE) return SPRITE;
  SPRITE = {
    // 三层景深各自的柔化程度：越远越弥散
    snowFar: makeSoftSprite(48, [[0, 1], [0.5, 0.42], [1, 0]], SNOW_WHITE),
    snowMid: makeSoftSprite(56, [[0, 1], [0.4, 0.7], [0.8, 0.15], [1, 0]], SNOW_WHITE),
    snowNear: makeSoftSprite(64, [[0, 1], [0.3, 0.85], [0.7, 0.22], [1, 0]], SNOW_WHITE),
    // 散景：中心也不到全白，整颗都虚
    bokeh: makeSoftSprite(96, [[0, 0.7], [0.3, 0.45], [0.6, 0.18], [1, 0]], SNOW_WHITE),
    // 近景雪的轮廓晕：白天压在浅色天空上时，靠它把白球托出边界
    shade: makeSoftSprite(40, [[0, 0.9], [0.55, 0.4], [1, 0]], SHADE_TONE),
  };
  return SPRITE;
}

/* ---------------------------------------------------------------- 引擎 */

class WeatherScene {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;

    this.weather = 'clear';
    this.pal = { top: [120, 180, 230], mid: [176, 208, 238], bot: [214, 232, 246] };
    this.lum = 0.6;          // 天空加权亮度（含天气调制后）
    this.darkK = 0;          // 0=白天 1=深夜

    this.streaks = [];
    this.flakes = [];
    this.stars = [];
    this.motes = [];

    // 闪电状态：全部是普通字段，没有任何定时器句柄
    this.lightning = 0;
    this.boltLife = 0;
    this.boltPaths = null;
    this.nextStrike = 0;
    this.reflashIn = 0;
    this.flashCount = 0;

    this.t = 0;
    this._raf = null;
    this._last = 0;
    this._running = false;
    this._reduced = false;

    this.resize = this.resize.bind(this);
    this.loop = this.loop.bind(this);
  }

  init() {
    if (this._running || this.canvas) return;
    this.canvas = document.getElementById('weatherEffects');
    if (!this.canvas) return;

    // alpha:true 是必须的 —— 这层只画粒子与光效，天空渐变在它下面。
    // 若用默认的 alpha:false，resize 会把位图清成不透明白，粒子层会盖掉天空。
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
      // 减弱动效：只画一帧静态粒子，不跑循环
      this.step(1 / 60);
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
    // 这层没有 backdrop-filter 兜着，不做 DPR 折扣 —— 折扣会让雨丝发虚。
    // 代价由「精灵化 + globalAlpha 批处理」抵回来。
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.buildStatic();
    this.buildParticles();
    // 改写 canvas 宽高会整体清空位图，而移动端滚动中收放工具栏会连续触发
    // resize。立即同步重绘一帧，把「清空态」窗口压到 0。
    this.render();
  }

  get key() {
    return PROFILE[this.weather] ? this.weather : 'clear';
  }

  get profile() {
    return PROFILE[this.key];
  }

  get isWet() {
    const p = this.profile.precip;
    return p === 'rain' || p === 'storm';
  }

  /* ------------------------------------------------------------ 构建 */

  /** 与天气无关的静态层：星空、浮尘。resize 时重算 */
  buildStatic() {
    const area = Math.max(this.w * this.h, 1);

    const n = Math.round(clamp(area / 9000, 60, 190));
    this.stars = [];
    for (let i = 0; i < n; i += 1) {
      const roll = Math.random();
      this.stars.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h * 0.68,
        r: roll > 0.93 ? 1.7 : 1.1,
        // 少量星点偏暖偏冷，避免整片死白
        tone: roll > 0.86 ? [255, 236, 214] : roll > 0.68 ? [214, 228, 255] : SNOW_WHITE,
        ph: Math.random() * TAU,
        a: 0.35 + Math.random() * 0.65,
      });
    }

    this.motes = [];
    const mn = Math.round(clamp(area / 26000, 16, 52));
    for (let i = 0; i < mn; i += 1) {
      this.motes.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: rnd(0.6, 2.2),
        vx: rnd(-0.12, 0.18),
        vy: rnd(-0.26, -0.04),
        a: rnd(0.08, 0.30),
      });
    }
  }

  buildParticles() {
    const p = this.profile;
    const area = Math.max(this.w * this.h, 1);
    this.streaks = [];
    this.flakes = [];

    if (p.precip === 'rain' || p.precip === 'storm') {
      const heavy = p.precip === 'storm';
      // 按面积算密度：移动端不至于过密，桌面端不至于过疏
      const base = Math.max(180, Math.floor(area / (heavy ? 3400 : 4400)));
      const count = Math.round(base * p.density);
      for (let i = 0; i < count; i += 1) this.streaks.push(this.mkStreak(heavy, true));
      return;
    }

    if (p.precip === 'snow') {
      const total = Math.round(Math.max(240, area / 4400) * p.density);
      // 三层景深：远景 50% / 中景 30% / 近景 20%
      const farN = Math.floor(total * 0.5);
      const midN = Math.floor(total * 0.3);
      const nearN = total - farN - midN;
      for (let i = 0; i < farN; i += 1) this.flakes.push(this.mkFlake('far'));
      for (let i = 0; i < midN; i += 1) this.flakes.push(this.mkFlake('mid'));
      for (let i = 0; i < nearN; i += 1) this.flakes.push(this.mkFlake('near'));
    }
  }

  mkStreak(heavy, anywhere = false) {
    return {
      x: Math.random() * (this.w + 300) - 150,
      y: anywhere ? Math.random() * this.h : -rnd(40, 200),
      len: heavy ? rnd(34, 92) : rnd(22, 62),
      speed: heavy ? rnd(22, 54) : rnd(16, 38),
      // 透明度比参考实现高一档：那边是白天的浅灰场景，雨丝天然有对比度；
      // 我们这边夜里天空接近 rgb(25,32,59)，照搬会淡成一层擦痕。
      alpha: heavy ? rnd(0.20, 0.44) : rnd(0.18, 0.40),
      w: heavy ? rnd(1.0, 2.3) : rnd(0.8, 1.7),
    };
  }

  /** 三层景深雪花：far=远景粉雪 / mid=中景碎雪 / near=近景大雪（带轮廓晕） */
  mkFlake(tier) {
    if (tier === 'far') {
      return {
        tier, x: Math.random() * this.w, y: Math.random() * this.h,
        r: rnd(0.8, 2.0), vy: rnd(6, 18), drift: rnd(0.15, 0.45),
        a: rnd(0.25, 0.55), ph: Math.random() * TAU, sp: rnd(0.4, 1.2),
      };
    }
    if (tier === 'near') {
      const bokeh = Math.random() > 0.78;
      return {
        tier, bokeh,
        x: Math.random() * this.w, y: Math.random() * this.h,
        r: bokeh ? rnd(6, 13) : rnd(3.6, 6.4),
        vy: rnd(28, 54), drift: rnd(0.6, 1.4),
        a: bokeh ? rnd(0.16, 0.34) : rnd(0.62, 0.92),
        ph: Math.random() * TAU, sp: rnd(0.8, 1.8),
      };
    }
    return {
      tier, bokeh: false,
      x: Math.random() * this.w, y: Math.random() * this.h,
      r: rnd(1.8, 3.6), vy: rnd(14, 32), drift: rnd(0.3, 0.8),
      a: rnd(0.45, 0.78), ph: Math.random() * TAU, sp: rnd(0.5, 1.5),
    };
  }

  /* ------------------------------------------------------------ 接口 */

  /**
   * 切换天气。
   * 只要新天气不是雷暴，就把闪电状态整个清掉 —— 这条清理是显式写的，
   * 不依赖 update() 的分支兜底，因为「切走后还在闪」正是上一版栽的坑。
   */
  setWeather(key) {
    this.weather = PROFILE[key] ? key : 'clear';
    if (this.profile.precip !== 'storm') {
      this.lightning = 0;
      this.boltLife = 0;
      this.boltPaths = null;
      this.nextStrike = 0;
      this.reflashIn = 0;
    } else if (this.nextStrike <= 0) {
      // 进入雷暴后先憋一小会儿，不要一切换就劈
      this.nextStrike = rnd(1.2, 3.4);
    }
    this.buildParticles();
  }

  /**
   * 注入当前天空。
   * @param {{top:number[],mid:number[],bot:number[]}} pal 调制后的三层天色
   * @param {number} lum 加权亮度（与墨色判定同一个数）
   */
  setSky(pal, lum) {
    if (pal) this.pal = pal;
    if (Number.isFinite(lum)) this.lum = lum;
    // 0.44 对应「深墨刚翻白墨」的位置：比这更亮就不该有星空
    this.darkK = clamp((0.44 - this.lum) / 0.38, 0, 1);
  }

  /** 供自动化测试与调试读取 */
  get counts() {
    let bokeh = 0;
    for (const f of this.flakes) if (f.bokeh) bokeh += 1;
    return {
      weather: this.key,
      rain: this.streaks.length,
      snow: this.flakes.length,
      bokeh,
      stars: this.stars.length,
      motes: this.motes.length,
      lightning: this.lightning,
      boltBranches: this.boltPaths ? this.boltPaths.length : 0,
      flashCount: this.flashCount,
    };
  }

  /* ------------------------------------------------------------ 更新 */

  step(dt) {
    this.t += dt;

    const wet = this.isWet;
    const storm = this.profile.precip === 'storm';

    // --- 雨丝：风把雨吹斜，且与运动方向一致（早先版本雨是"逆风"的）---
    const windX = wet ? 0.42 : 0.26;
    for (const s of this.streaks) {
      s.y += s.speed * dt * 60;
      s.x += s.speed * windX * dt * 60;
      if (s.y > this.h + 70) {
        Object.assign(s, this.mkStreak(storm));
        s.y = -rnd(40, 220);
      }
      if (s.x > this.w + 160) s.x = -150;
    }

    // --- 雪：全局风力随时间缓慢摆动，营造自然飘拂 ---
    const snowWind = 0.30 + Math.sin(this.t * 0.30) * 0.25;
    for (const f of this.flakes) {
      f.ph += f.sp * dt;
      f.y += f.vy * dt * 60;
      f.x += (Math.sin(f.ph) * f.drift + snowWind) * dt * 60;
      if (f.y > this.h + 16) {
        const tier = f.tier;
        Object.assign(f, this.mkFlake(tier));
        f.y = -rnd(8, 30);
        f.x = Math.random() * this.w;
      }
      if (f.x > this.w + 24) f.x = -24;
      if (f.x < -24) f.x = this.w + 24;
    }

    for (const m of this.motes) {
      m.x += m.vx * dt * 60;
      m.y += m.vy * dt * 60;
      if (m.y < -8) { m.y = this.h + 8; m.x = Math.random() * this.w; }
      if (m.x < -8) m.x = this.w + 8;
      if (m.x > this.w + 8) m.x = -8;
    }

    // --- 闪电：逐帧状态机（双闪模型）---
    if (storm) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.lightning = 0.42 + Math.random() * 0.22;
        this.nextStrike = rnd(3.0, 9.0);
        this.reflashIn = rnd(0.06, 0.20);   // 主闪之后紧跟一次更亮的回击
        this.boltPaths = this.genBolt();
        this.boltLife = 1;
        this.flashCount += 1;
      }
      if (this.reflashIn > 0) {
        this.reflashIn -= dt;
        if (this.reflashIn <= 0) {
          this.lightning = 0.85;
          this.boltPaths = this.genBolt();
          this.boltLife = 1;
        }
      }
      if (this.lightning > 0.004) this.lightning *= Math.pow(0.0009, dt);
      else this.lightning = 0;
      if (this.boltLife > 0) this.boltLife -= dt * 4.5;
    } else if (this.lightning || this.boltLife || this.boltPaths) {
      this.lightning = 0;
      this.boltLife = 0;
      this.boltPaths = null;
      this.reflashIn = 0;
    }
  }

  loop(now) {
    this._raf = requestAnimationFrame(this.loop);
    // 夹住 dt：页面从后台切回时 now - _last 可能是几十秒，
    // 不夹的话所有粒子会瞬移一大截
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;

    this.step(dt);
    try {
      this.render();
    } catch (error) {
      // 单帧绘制异常不能让整套天气动画永久停摆
      console.error('窗外天气场景绘制异常:', error);
    }
  }

  /* ------------------------------------------------------------ 渲染 */

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const S = sprites();
    const dk = this.darkK;

    ctx.clearRect(0, 0, this.w, this.h);

    this.drawHorizonGlow(ctx, dk);
    this.drawStars(ctx, dk);
    this.drawHaze(ctx);

    if (this.isWet) this.drawRain(ctx, dk);
    else if (this.profile.precip !== 'snow') this.drawMotes(ctx, dk);

    if (this.lightning > 0.004) this.drawFlash(ctx);
    if (this.boltLife > 0 && this.boltPaths) this.drawBolt(ctx);

    // 雪压在雾层之上，避免白色粒子被前景雾幕吞掉
    if (this.profile.precip === 'snow') this.drawSnow(ctx, S, dk);
  }

  /* 地平线暖光带：大气散射让画面「有空气」。
     没有太阳高度角可用，这里用「地平线色有多橙」当代理量 ——
     正午的 bot 是淡青蓝（r<b），黄昏是橙红（r≫b），夜里两者都不满足。 */
  drawHorizonGlow(ctx, dk) {
    const { bot } = this.pal;
    const warmth = clamp((bot[0] - bot[2]) / 200, 0, 1);
    const amt = warmth * (1 - dk * 0.6);
    if (amt <= 0.03) return;

    const warm = mix(bot, [255, 226, 178], 0.42);
    const g = ctx.createLinearGradient(0, this.h * 0.40, 0, this.h * 0.84);
    g.addColorStop(0, rgbStr(warm, 0));
    g.addColorStop(0.55, rgbStr(warm, 0.30 * amt));
    g.addColorStop(1, rgbStr(warm, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, this.h * 0.40, this.w, this.h * 0.44);
  }

  /* 星空：入夜、且云和雾都不重时才看得见 */
  drawStars(ctx, dk) {
    const occl = this.profile.occlusion;
    const starA = clamp(dk * (1 - occl) * 0.46, 0, 0.46);
    if (starA <= 0.03) return;

    for (const s of this.stars) {
      const tw = 0.55 + 0.45 * Math.sin(this.t * 1.7 + s.ph);
      ctx.globalAlpha = starA * tw * s.a;
      ctx.fillStyle = rgbStr(s.tone);
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }

  /* 雾 / 霾：把远景压平，强化「隔着玻璃看」 */
  drawHaze(ctx) {
    const fog = this.profile.haze;
    if (fog <= 0.02) return;
    const col = mix(this.pal.mid, this.pal.bot, 0.5);
    const g = ctx.createLinearGradient(0, this.h * 0.26, 0, this.h);
    g.addColorStop(0, rgbStr(col, 0));
    g.addColorStop(0.5, rgbStr(col, fog * 0.40));
    g.addColorStop(1, rgbStr(col, fog * 0.70));
    ctx.fillStyle = g;
    ctx.fillRect(0, this.h * 0.26, this.w, this.h * 0.74);
  }

  /* 室外雨丝：景深淡出 + 顺风倾斜 + 暴雨雨帘 + 贴地水雾 */
  drawRain(ctx, dk) {
    const storm = this.profile.precip === 'storm';
    const bot = this.pal.bot;

    // 雨的颜色随时段走：白天偏亮白，夜里偏冷灰蓝。
    // 夜间的基准色刻意提亮过 —— 雨丝是被天光和灯光打亮的，若跟着天色一起
    // 压暗到 rgb(105,120,145)，落在 rgb(25,32,59) 的夜空上几乎读不出来。
    const rainDay = mix([232, 242, 252], bot, 0.26);
    const rainNight = mix([190, 205, 232], this.pal.mid, 0.18);
    const col = mix(rainDay, rainNight, dk);

    ctx.save();
    ctx.lineCap = 'round';
    // 颜色串只拼一次，逐粒子的透明度交给 globalAlpha
    ctx.strokeStyle = rgbStr(col);

    for (const s of this.streaks) {
      // 越靠近地平线越淡：远处雨幕被空气稀释
      const depthK = clamp((s.y / this.h) * 0.5 + 0.5, 0.5, 1);
      ctx.globalAlpha = s.alpha * depthK;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.len * 0.30, s.y + s.len);
      ctx.stroke();
    }

    // 暴雨雨帘：极低透明度的密集竖线，模拟"雨墙"
    if (storm) {
      ctx.globalAlpha = 0.03 + this.lightning * 0.06;
      ctx.strokeStyle = rgbStr(mix(col, [255, 255, 255], 0.3));
      ctx.lineWidth = 0.5;
      for (let x = 0; x < this.w; x += 5) {
        // 位置由 x 决定而不是每帧随机：随机会让雨帘变成一片噪点闪烁
        const jitter = ((x * 2654435761) % 1000) / 1000;
        if (jitter > 0.62) continue;
        ctx.beginPath();
        ctx.moveTo(x + (jitter - 0.5) * 4, 0);
        ctx.lineTo(x + (jitter - 0.5) * 4 + this.w * 0.002, this.h);
        ctx.stroke();
      }
    }

    // 贴地水雾（暴雨时更高更浓）
    ctx.globalAlpha = 1;
    const fogStart = storm ? 0.52 : 0.68;
    const fogAlpha = storm ? 0.34 : 0.20;
    const sp = ctx.createLinearGradient(0, this.h * fogStart, 0, this.h);
    sp.addColorStop(0, rgbStr(this.pal.mid, 0));
    sp.addColorStop(1, rgbStr(mix(this.pal.mid, [255, 255, 255], 0.22), fogAlpha));
    ctx.fillStyle = sp;
    ctx.fillRect(0, this.h * fogStart, this.w, this.h * (1 - fogStart));

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* 雪：三层景深，全部走预渲染精灵 */
  drawSnow(ctx, S, dk) {
    ctx.save();

    for (const f of this.flakes) {
      const soft = f.tier === 'far' ? S.snowFar : f.tier === 'mid' ? S.snowMid : S.snowNear;
      const img = f.bokeh ? S.bokeh : soft;

      if (f.tier === 'near' && !f.bokeh) {
        // 近景雪的轮廓晕：偏移一点点，像背后有阴影
        ctx.globalAlpha = f.a * (dk > 0.4 ? 0 : 0.15);
        if (ctx.globalAlpha > 0.01) {
          const sr = f.r * 1.5;
          ctx.drawImage(S.shade, f.x + 0.6 - sr, f.y + 0.8 - sr, sr * 2, sr * 2);
        }
      }

      ctx.globalAlpha = Math.min(1, f.a);
      const r = f.r * (f.tier === 'near' ? 1.5 : 1.7);
      ctx.drawImage(img, f.x - r, f.y - r, r * 2, r * 2);
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* 浮尘：只有有光的时候才看得见，正午最明显 */
  drawMotes(ctx, dk) {
    const lit = clamp((1 - dk) * (1 - this.profile.occlusion * 0.6), 0, 1);
    if (lit < 0.05) return;

    ctx.save();
    // 落日时浮尘被暖色染红
    const warmth = clamp((this.pal.bot[0] - this.pal.bot[2]) / 200, 0, 1);
    ctx.fillStyle = rgbStr(mix([255, 252, 240], [255, 200, 150], warmth * 0.7));
    for (const m of this.motes) {
      ctx.globalAlpha = m.a * (0.35 + lit);
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* 雷暴闪光：照亮整个画面 */
  drawFlash(ctx) {
    const flash = clamp(this.lightning * 0.26, 0, 0.18);
    const g = ctx.createLinearGradient(0, 0, 0, this.h * 0.72);
    g.addColorStop(0, rgbStr([164, 194, 226], flash * 0.38));
    g.addColorStop(0.48, rgbStr([192, 218, 244], flash));
    g.addColorStop(1, rgbStr([162, 190, 224], 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h * 0.72);

    // 以闪电落点为中心的侧向不对称照亮
    const main = this.boltPaths?.[0]?.pts;
    const sideX = main && main.length ? main[0].x : this.w * 0.5;
    const sg = ctx.createRadialGradient(sideX, this.h * 0.3, 0, sideX, this.h * 0.3, this.w * 0.6);
    sg.addColorStop(0, rgbStr([200, 216, 240], flash * 0.5));
    sg.addColorStop(1, rgbStr([200, 216, 240], 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, this.w, this.h * 0.72);
  }

  /* --- 分叉闪电路径（递归 L-system） ---
     注：参考实现里那行 `y += Math.cos(0) * segLen * ...` 的 cos(0) 恒等于 1，
     是段没有作用的死数学，这里直接写成 segLen。 */
  genBolt() {
    const paths = [];
    const startX = this.w * (0.25 + Math.random() * 0.5);
    const startY = this.h * (0.06 + Math.random() * 0.12);
    const endY = this.h * (0.52 + Math.random() * 0.22);

    const branch = (x0, y0, angle0, depth) => {
      let x = x0;
      let y = y0;
      let angle = angle0;
      const pts = [{ x, y }];
      const segLen = (endY - startY) / (8 + depth * 3);
      const steps = depth === 0 ? 10 + Math.floor(Math.random() * 6) : 4 + Math.floor(Math.random() * 4);

      for (let i = 0; i < steps; i += 1) {
        angle += (Math.random() - 0.5) * 0.52;   // ±15° 偏折
        x += Math.sin(angle) * segLen * (0.5 + Math.random());
        y += segLen * (0.8 + Math.random() * 0.4);
        pts.push({ x, y });

        // 30% 概率分叉，最多递归 3 层
        if (depth < 3 && Math.random() < 0.30) {
          branch(x, y, angle + (Math.random() - 0.5) * 1.2, depth + 1);
        }
        if (y > endY) break;
      }
      paths.push({ pts, depth });
    };

    branch(startX, startY, 0, 0);
    return paths;
  }

  /* --- 分叉闪电渲染：外层蓝紫辉光 → 中层白锐核心 → 紫色余辉 --- */
  drawBolt(ctx) {
    const life = clamp(this.boltLife, 0, 1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const { pts, depth } of this.boltPaths) {
      if (pts.length < 2) continue;
      const isMain = depth === 0;
      const baseW = isMain ? 2.5 : Math.max(0.5, 1.8 - depth * 0.5);
      const baseA = isMain ? 0.9 : Math.max(0.15, 0.6 - depth * 0.15);

      const trace = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      };

      // 外层辉光：宽、柔、蓝紫
      ctx.strokeStyle = `rgba(180,200,255,${(baseA * life * 0.35).toFixed(3)})`;
      ctx.lineWidth = baseW * 4;
      trace();

      // 中层核心：白、锐利
      ctx.strokeStyle = `rgba(240,245,255,${(baseA * life * 0.85).toFixed(3)})`;
      ctx.lineWidth = baseW;
      trace();

      // 残影余辉：只在消退后半程出现，让闪电"留一条尾巴"
      if (life < 0.6 && isMain) {
        ctx.strokeStyle = `rgba(160,140,220,${(life * 0.3).toFixed(3)})`;
        ctx.lineWidth = baseW * 0.6;
        trace();
      }
    }

    ctx.restore();
  }
}

export const weatherScene = new WeatherScene();

// 调试 / 自动化测试入口：__sceneWeather.counts 可直接读到粒子与闪电状态
if (typeof window !== 'undefined') {
  window.__sceneWeather = weatherScene;
}
