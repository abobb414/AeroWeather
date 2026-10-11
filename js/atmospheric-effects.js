/**
 * atmospheric-effects.js —— 窗外世界的几项大气光学 / 风场效果
 * ---------------------------------------------------------------------------
 *   SunHalo           22° 日晕（参考 iOS 天气晴天的太阳 + 光环 + 镜头鬼影）
 *   ShootingStars     晴夜流星，45~90 秒一颗
 *   WindField         真实风速风向 → 雨丝带符号偏角（缓动，不硬切）
 *   LightningRimFlash 闪电 → CSS 变量 --lightning-rim（前景卡片顶边微闪）
 *
 * 丁达尔光已移除：纯色渐变天空里没有可以「切开」光束的遮挡物，画出来只是几块亮斑。
 */

import { TAU, clamp, lerp, rnd, smooth } from './math-utils.js';

const DEG = Math.PI / 180;

/* ============================================================
   日晕
   ------------------------------------------------------------
   出现条件按「太阳高度角」而不是钟点：
     · 钟点写死（如 9~15 点）在季节和经度上都会错 —— 北京冬至 9:00 太阳只有 12°，
       喀什用北京时间、太阳时比北京晚两个多小时，9 点太阳刚出地平线；
     · 高度角 < 8° 时太阳贴着地平线、天色已是暖调，这时挂一圈正午式的白色光环不对；
       8°→18° 之间渐入，18° 以上全强度（北京 10 月约 08:00–16:00 全强度）。
   天气只在晴 / 多云时出现，其余天气天上看不见太阳。
   ============================================================ */

const HALO_WEATHER = { clear: 1, cloudy: 0.55 };
const HALO_ALT_IN = 8;      // 开始渐入的高度角
const HALO_ALT_FULL = 18;   // 全强度的高度角

/** 晕圈色谱：冰晶折射是「内红外蓝」，内缘锐、外缘缓。[位置, rgb, 相对强度] */
const RING_STOPS = [
  [0.00, [255, 140, 110], 0],
  [0.10, [255, 150, 112], 0.50],
  [0.18, [255, 214, 160], 0.78],
  [0.28, [255, 248, 232], 0.70],
  [0.42, [214, 230, 255], 0.40],
  [0.62, [188, 210, 255], 0.16],
  [1.00, [188, 210, 255], 0],
];
const RING_IN = 0.88;       // 晕圈渐变内径 / R
const RING_OUT = 1.24;      // 晕圈渐变外径 / R

/** 镜头鬼影：沿「太阳 → 屏幕中心」连线分布。t=1 即屏幕中心 */
const GHOSTS = [
  { t: 0.42, r: 0.055, a: 0.9 },
  { t: 0.66, r: 0.10, a: 0.55 },
  { t: 0.90, r: 0.04, a: 0.8 },
  { t: 1.32, r: 0.13, a: 0.4 },
];

const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${+a.toFixed(4)})`;

/**
 * 太阳 → 屏幕位置。
 * 视角是「面朝赤道、抬头看天」：北半球朝南看，东在左、西在右，
 * 所以上午太阳在左上、正午在正上、下午在右上；南半球朝北看，左右对调。
 */
function sunToScreen(sun, lat, w, h) {
  let az = ((sun.azimuth % 360) + 360) % 360;
  let u;
  if (lat >= 0) {
    u = (az - 180) / 90;                  // 东(90)=-1 南(180)=0 西(270)=+1
  } else {
    if (az > 180) az -= 360;
    u = az / 90;                          // 东(90)=+1 北(0)=0 西(-90)=-1
  }
  const x = w * clamp(0.5 + u * 0.42, 0.08, 0.92);
  // 高度角越高越靠上；低空时下沉到上四分之一处
  const y = h * lerp(0.24, 0.07, smooth((sun.altitude - 12) / 45));
  return { x, y };
}

export class SunHalo {
  constructor() {
    this.force = false;     // 实验台「日晕」按钮：无视天气与高度角
    this.strength = 0;      // 缓动后的当前强度 0~1
    this.target = 0;
    this.t = 0;
    this._seeded = false;
    this._sprite = null;
    this._spriteR = 0;
    this._ghost = null;
  }

  /** 该时刻、该天气下的目标强度 */
  static targetFor(sun, weather) {
    if (!sun) return 0;
    const k = HALO_WEATHER[weather] || 0;
    return k * smooth((sun.altitude - HALO_ALT_IN) / (HALO_ALT_FULL - HALO_ALT_IN));
  }

  update(dt, sun, weather) {
    this.t += dt;
    this.target = this.force ? 1 : SunHalo.targetFor(sun, weather);
    if (!this._seeded) {
      // 首帧直接到位：开页不该看着它慢慢亮起来（减弱动效模式下也只渲染这一帧）
      this.strength = this.target;
      this._seeded = true;
      return;
    }
    // 换天气 / 拖时间时 ~1.5s 渐变
    this.strength += (this.target - this.strength) * (1 - Math.exp(-dt * 1.6));
    if (this.strength < 0.002 && this.target === 0) this.strength = 0;
  }

  /** 晕圈半径：大约对角线的 1/5（手机竖屏 ≈ 0.46 屏宽，与参考图一致） */
  static radiusFor(w, h) {
    return clamp(Math.hypot(w, h) * 0.2, 150, 420);
  }

  render(ctx, w, h, sun, lat) {
    if (this.strength < 0.004 || !sun) return;
    const R = SunHalo.radiusFor(w, h);
    if (!this._sprite || Math.abs(this._spriteR - R) > 1) this._build(R);

    // 强制显示时太阳可能在地平线下，位置按 20° 算，保证看得到
    const pos = sunToScreen(this.force ? { ...sun, altitude: Math.max(sun.altitude, 20) } : sun, lat, w, h);
    // 极慢的呼吸：高空冰晶云的疏密在缓慢变化
    const breathe = 0.94 + 0.06 * Math.sin(this.t * 0.31);
    const a = this.strength * breathe;

    ctx.save();
    ctx.globalAlpha = a;
    const S = this._sprite.width;
    ctx.drawImage(this._sprite, pos.x - S / 2, pos.y - S / 2, S, S);

    // 镜头鬼影：很淡，只在全强度附近才读得出来
    const cx = w / 2;
    const cy = h / 2;
    for (const g of GHOSTS) {
      const gx = lerp(pos.x, cx, g.t);
      const gy = lerp(pos.y, cy, g.t);
      const gr = R * g.r;
      ctx.globalAlpha = a * a * 0.10 * g.a;
      ctx.drawImage(this._ghost, gx - gr, gy - gr, gr * 2, gr * 2);
    }
    ctx.restore();
  }

  /**
   * 太阳 + 星芒 + 晕圈烘成一张精灵，逐帧只剩一次 drawImage。
   * 全是柔和渐变，按 CSS 像素（1x）烘焙即可，高分屏放大看不出差别，
   * 显存只有 DPR=2 烘焙的四分之一。
   */
  _build(R) {
    const S = Math.ceil(R * RING_OUT * 2 + 8);
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    const o = S / 2;

    // ① 天空被照白的一大片：iOS 那种太阳周围发白的感觉主要靠它
    const bloom = g.createRadialGradient(o, o, 0, o, o, R * 1.2);
    bloom.addColorStop(0, 'rgba(255,253,246,0.62)');
    bloom.addColorStop(0.08, 'rgba(255,253,246,0.46)');
    bloom.addColorStop(0.22, 'rgba(255,252,244,0.20)');
    bloom.addColorStop(0.5, 'rgba(255,252,244,0.07)');
    bloom.addColorStop(1, 'rgba(255,252,244,0)');
    g.fillStyle = bloom;
    g.fillRect(0, 0, S, S);

    // ② 星芒：几道细长、向外渐隐的衍射线，长短不一
    g.globalCompositeOperation = 'lighter';
    const rays = 12;
    for (let i = 0; i < rays; i += 1) {
      const ang = (i / rays) * TAU + 0.18 + Math.sin(i * 2.3) * 0.08;
      const len = R * (i % 2 ? 0.30 : 0.52) * (0.85 + 0.3 * Math.abs(Math.sin(i * 1.7)));
      const half = R * 0.010;
      const ex = o + Math.cos(ang) * len;
      const ey = o + Math.sin(ang) * len;
      const nx = -Math.sin(ang) * half;
      const ny = Math.cos(ang) * half;
      const lg = g.createLinearGradient(o, o, ex, ey);
      lg.addColorStop(0, 'rgba(255,255,255,0.20)');
      lg.addColorStop(0.35, 'rgba(255,255,255,0.07)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(o + nx, o + ny);
      g.lineTo(ex, ey);
      g.lineTo(o - nx, o - ny);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';

    // ③ 日核：只有一团过曝的白，不画硬边圆盘
    const core = g.createRadialGradient(o, o, 0, o, o, R * 0.17);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.32, 'rgba(255,255,255,0.96)');
    core.addColorStop(0.6, 'rgba(255,254,248,0.42)');
    core.addColorStop(1, 'rgba(255,254,248,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, S, S);

    // ④ 22° 晕圈：单独画到一张画布上，用锥形渐变做疏密遮罩后再合进来
    const rc = document.createElement('canvas');
    rc.width = S;
    rc.height = S;
    const rg = rc.getContext('2d');
    const ring = rg.createRadialGradient(o, o, R * RING_IN, o, o, R * RING_OUT);
    const RING_ALPHA = 0.34;
    for (const [p, col, k] of RING_STOPS) ring.addColorStop(p, rgba(col, k * RING_ALPHA));
    rg.fillStyle = ring;
    rg.fillRect(0, 0, S, S);

    // 冰晶云不会是均匀的一整圈：沿圆周有几段淡下去
    if (typeof rg.createConicGradient === 'function') {
      const mask = rg.createConicGradient(-0.6, o, o);
      const k = [1, 0.82, 0.55, 0.78, 1, 0.92, 0.48, 0.7, 0.95, 1];
      k.forEach((v, i) => mask.addColorStop(i / (k.length - 1), `rgba(0,0,0,${v})`));
      rg.globalCompositeOperation = 'destination-in';
      rg.fillStyle = mask;
      rg.fillRect(0, 0, S, S);
    }
    g.drawImage(rc, 0, 0);

    // 抖动：低 alpha 的大面积渐变在 8 bit 下会出一圈圈色阶（桌面大屏尤其明显），
    // 烘焙时给 alpha 加 ±1 级噪声把台阶打散。只在重建精灵时跑一次。
    try {
      const img = g.getImageData(0, 0, S, S);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 0 && d[i] < 250) d[i] = clamp(d[i] + ((Math.random() * 3) | 0) - 1, 0, 255);
      }
      g.putImageData(img, 0, 0);
    } catch { /* 极少数环境禁读画布，少了抖动也能用 */ }

    this._sprite = c;
    this._spriteR = R;

    // 鬼影：中间通透、边缘一圈淡亮，带一点冷色
    if (!this._ghost) {
      const gc = document.createElement('canvas');
      gc.width = 64;
      gc.height = 64;
      const gg = gc.getContext('2d');
      const gr = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(235,244,255,0.35)');
      gr.addColorStop(0.72, 'rgba(225,238,255,0.55)');
      gr.addColorStop(0.9, 'rgba(255,255,255,0.85)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = gr;
      gg.fillRect(0, 0, 64, 64);
      this._ghost = gc;
    }
  }
}

/* ============================================================
   流星
   ============================================================ */

export class ShootingStars {
  constructor() {
    this.meteors = [];
    this.nextSpawn = rnd(45, 90);
  }

  /** @param {{altitude:number}|null} sun 太阳位置：入夜（< -6°）才有流星 */
  update(dt, sun, weather) {
    const night = sun && sun.altitude < -6;
    if (night && (weather === 'clear' || weather === 'cloudy')) {
      this.nextSpawn -= dt;
      if (this.nextSpawn <= 0) {
        this.spawn();
        this.nextSpawn = rnd(45, 90);
      }
    }
    for (const m of this.meteors) {
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    this.meteors = this.meteors.filter((m) => m.age < m.life);
  }

  /** 生成一颗：起点在天空上半部，斜向下掠过，0.4~0.6 秒 */
  spawn() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const ang = rnd(0.32, 0.62);                    // 与水平面夹角
    const speed = rnd(900, 1400);                   // px/s
    this.meteors.push({
      x: dir > 0 ? rnd(0.05, 0.55) * w : rnd(0.45, 0.95) * w,
      y: rnd(0.04, 0.32) * h,
      vx: Math.cos(ang) * speed * dir,
      vy: Math.sin(ang) * speed,
      age: 0,
      life: rnd(0.4, 0.6),
      tail: rnd(110, 180),
      peak: rnd(0.65, 0.95),
    });
  }

  render(ctx) {
    if (!this.meteors.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const m of this.meteors) {
      const p = m.age / m.life;
      // 快进慢出：前 15% 亮起，之后一路消融
      const a = m.peak * (p < 0.15 ? p / 0.15 : (1 - p) / 0.85);
      if (a <= 0.01) continue;
      const sp = Math.hypot(m.vx, m.vy);
      const tl = m.tail * (0.6 + 0.4 * Math.min(1, p * 3));
      const tx = m.x - (m.vx / sp) * tl;
      const ty = m.y - (m.vy / sp) * tl;
      const lg = ctx.createLinearGradient(m.x, m.y, tx, ty);
      lg.addColorStop(0, `rgba(255,255,255,${a})`);
      lg.addColorStop(0.25, `rgba(214,228,255,${a * 0.45})`);
      lg.addColorStop(1, 'rgba(214,228,255,0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 1.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* ============================================================
   风场
   ------------------------------------------------------------
   偏角大小按风速（蒲福风级）：< 10 km/h 竖直，10→20 km/h 到 8°，
   20→40 km/h 到 15°，40→60 km/h 到 20°。
   偏向按风向投影到「面朝赤道」的横向上：
     北半球东风（从东边吹来）→ 雨往西 → 屏幕右；西风 → 屏幕左。
   正南 / 正北风只是朝着或背着观察者吹，横向分量为 0，但真实视野不会
   恰好正对风向，这里保留 40% 的横向下限，免得「明明有风雨却是直的」。
   ============================================================ */

export class WindField {
  constructor() {
    this.speed = 0;         // km/h
    this.direction = 0;     // 气象风向：风「从哪来」，0 = 北
    this.south = false;     // 南半球：朝北看，左右对调
    this.lean = 0;          // 当前带符号偏角（弧度），正 = 向右；缓动追 targetLean
    this._seeded = false;
  }

  set(speed, direction) {
    this.speed = Math.max(0, Number(speed) || 0);
    this.direction = Number(direction) || 0;
  }

  setHemisphere(lat) {
    this.south = Number(lat) < 0;
  }

  /** 偏角大小（度），只看风速 */
  get slantDeg() {
    const v = this.speed;
    if (v < 10) return 0;
    if (v < 20) return ((v - 10) / 10) * 8;
    if (v < 40) return 8 + ((v - 20) / 20) * 7;
    return 15 + Math.min((v - 40) / 20, 1) * 5;
  }

  /** 横向符号与比例：-1 向左 … +1 向右 */
  get side() {
    const s = Math.sin(this.direction * DEG) * (this.south ? -1 : 1);
    return (s >= 0 ? 1 : -1) * (0.4 + 0.6 * Math.abs(s));
  }

  /** 目标偏角（弧度，带符号） */
  get targetLean() {
    return this.slantDeg * DEG * this.side;
  }

  update(dt) {
    const target = this.targetLean;
    if (!this._seeded) {
      this.lean = target;
      this._seeded = true;
      return;
    }
    // 风变了雨要「慢慢被吹过去」，约 1 秒到位
    this.lean += (target - this.lean) * (1 - Math.exp(-dt * 2.2));
  }
}

/* ============================================================
   闪电 → 前景卡片顶边微闪
   ============================================================ */

export class LightningRimFlash {
  constructor() {
    this.intensity = 0;
    this._last = '';
  }

  update(v) {
    this.intensity = v;
  }

  /** 只在值变化时写 CSS 变量：每帧 setProperty 会让整页每帧重算样式 */
  applyToCSS() {
    const v = this.intensity > 0.01 ? Math.min(1, this.intensity).toFixed(2) : '0';
    if (v === this._last) return;
    this._last = v;
    document.documentElement.style.setProperty('--lightning-rim', v);
  }
}
