/**
 * 共享数学 / 颜色工具
 * ---------------------------------------------------------------------------
 * 原先 sky-gradient / scene-weather / glass-layer / atmospheric-effects /
 * weather / storm / sun-position 各自复制了一份 clamp、lerp、mix、rgbStr。
 * 这里是唯一一份，写法沿用 js/sky-gradient.js。
 */

export const TAU = Math.PI * 2;

/** 夹取到 [a, b]；NaN / 非有限值回落到下限 a（与原各模块的写法一致） */
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, Number.isFinite(v) ? v : a));
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rnd = (a, b) => a + Math.random() * (b - a);

/** smoothstep：0-1 之间的 S 形缓动 */
export const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** 两个 RGB 数组按 t 线性混合 */
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** RGB（0-255）→ CSS 颜色串；a < 1 时输出 rgba */
export function rgbStr(rgb, a = 1) {
  const [r, g, b] = rgb.map((c) => Math.round(clamp(c, 0, 255)));
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 感知亮度（Rec.601），0 = 纯黑，1 = 纯白。注意：不是 WCAG 相对亮度 */
export const luma = (rgb) => (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114) / 255;

/* ============================================================
   水珠环境光
   ------------------------------------------------------------
   这里必须偏离「天色多大我就多亮」的直觉。夜里的水珠在物理上确实只剩微弱
   天光可反射，照实算出来的 tint 是 (55,51,68) —— 跟夜空 (23,26,38) 几乎同色，
   水珠等于隐形（实测画布覆盖率 1.1%、峰值 alpha 106/255）。

   解决方式就是把真实世界里缺掉的那一环补上：玻璃是被路灯、窗内的灯打亮的。
   所以夜间给 tint 混入暖白并抬一个亮度下限，水珠才立得起来。
   这不是「为了好看而失真」—— 城市夜景里玻璃上的雨珠本来就是这样被看见的。
   ============================================================ */
const WET_LIT = [214, 224, 244];      // 白天：天光散射后的水色
const WET_LAMP = [255, 233, 198];     // 夜间：路灯的暖白

/**
 * @param {number[]} bot 天空地平线色（白天水色跟着天色走：正午偏青、黄昏偏暖）
 * @param {number} darkK 夜色系数 0-1，越大越转向路灯暖白
 */
export function waterTint(bot, darkK) {
  const day = mix(WET_LIT, bot, 0.34);
  const base = mix(day, WET_LAMP, darkK);
  // 亮度下限：夜里再暗也不低于 0.42，否则高光/焦散都没有立足的对比
  const lum = luma(base);
  const floor = 0.42;
  return lum >= floor ? base : base.map((c) => Math.min(255, c * (floor / lum)));
}
