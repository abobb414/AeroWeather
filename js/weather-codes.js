/**
 * weather-codes.js
 * WMO 天气代码解析、中国 PM2.5 空气质量标准定义、风向计算与图标生成
 */

// WMO 天气代号对照字典 (国际气象组织标准代码)
// bg 取值决定顶栏圆点配色：clear / cloudy / rain / snow
// 图标名同时是「窗外效果」的分类依据（weather.js 按 icon 决定下雨/下雪/闪电），
// 所以这里新增代码时只要图标名选对，效果会自动跟上。
const WMO_WEATHER_MAP = {
  0: { label: '晴朗', icon: 'clear-day', bg: 'clear' },
  1: { label: '大部晴朗', icon: 'partly-cloudy-day', bg: 'clear' },
  2: { label: '局部多云', icon: 'partly-cloudy-day', bg: 'cloudy' },
  3: { label: '阴天', icon: 'overcast', bg: 'cloudy' },
  45: { label: '有雾', icon: 'fog', bg: 'cloudy' },
  48: { label: '冻雾', icon: 'fog', bg: 'cloudy' },
  // 沙尘类（彩云的 DUST / SAND 映射到这里）
  30: { label: '浮尘', icon: 'fog', bg: 'cloudy' },
  31: { label: '扬沙', icon: 'fog', bg: 'cloudy' },
  32: { label: '沙尘暴', icon: 'fog', bg: 'cloudy' },
  51: { label: '轻微毛毛雨', icon: 'drizzle', bg: 'rain' },
  53: { label: '毛毛雨', icon: 'drizzle', bg: 'rain' },
  55: { label: '强毛毛雨', icon: 'drizzle', bg: 'rain' },
  56: { label: '轻微冻雨', icon: 'rain', bg: 'rain' },
  57: { label: '强冻雨', icon: 'rain', bg: 'rain' },
  61: { label: '小雨', icon: 'rain', bg: 'rain' },
  63: { label: '中雨', icon: 'rain', bg: 'rain' },
  65: { label: '大雨', icon: 'rain', bg: 'rain' },
  66: { label: '轻微冻雨', icon: 'rain', bg: 'rain' },
  67: { label: '强冻雨', icon: 'rain', bg: 'rain' },
  71: { label: '小雪', icon: 'snow', bg: 'snow' },
  73: { label: '中雪', icon: 'snow', bg: 'snow' },
  75: { label: '大雪', icon: 'snow', bg: 'snow' },
  77: { label: '雪粒', icon: 'snow', bg: 'snow' },
  80: { label: '轻微阵雨', icon: 'rain', bg: 'rain' },
  81: { label: '阵雨', icon: 'rain', bg: 'rain' },
  82: { label: '暴雨', icon: 'rain', bg: 'rain' },
  85: { label: '小阵雪', icon: 'snow', bg: 'snow' },
  86: { label: '强阵雪', icon: 'snow', bg: 'snow' },
  95: { label: '雷阵雨', icon: 'thunderstorm', bg: 'rain' },
  96: { label: '雷雨伴有轻微冰雹', icon: 'thunderstorm', bg: 'rain' },
  99: { label: '雷暴伴有强冰雹', icon: 'thunderstorm', bg: 'rain' },
};

/**
 * 获取天气状态
 * 返回 { label, icon, bg, isNight }：
 *   - bg      —— 天气类别（clear/cloudy/rain/snow），调用方据此选择窗外场景
 *   - isNight —— 昼夜标记，只影响图标与文案选择
 *
 * ⚠️ 昼夜不是天气类别。这里曾把 bg 直接覆盖成 'night'，而调用方是按
 *    bg === 'rain' / 'snow' / 'cloudy' 来选场景的，于是夜间下雨、下雪、
 *    阴天全部落空、窗外一律渲染成晴朗夜空。昼夜必须与 bg 分开表达。
 */
export function getWeatherInfo(code, isDay = 1) {
  const isNight = !isDay;
  const info = WMO_WEATHER_MAP[code] || { label: '多云', icon: 'partly-cloudy-day', bg: 'cloudy' };

  let iconName = info.icon;
  if (isNight && (code === 0 || code === 1)) {
    iconName = code === 0 ? 'clear-night' : 'partly-cloudy-night';
  }

  return {
    label: info.label,
    icon: iconName,
    bg: info.bg,
    isNight,
  };
}

/**
 * 中国标准 PM2.5 与 AQI 等级评定 (依据国家环境保护标准 HJ 633-2012)
 * PM2.5 浓度 (μg/m³):
 *  0 - 35   : 优 (绿色)
 *  35 - 75  : 良 (黄色)
 *  75 - 115 : 轻度污染 (橙色)
 *  115 - 150: 中度污染 (红色)
 *  150 - 250: 重度污染 (紫色)
 *  > 250    : 严重污染 (褐红)
 */
export function evaluatePM25(pm25Val) {
  const val = Number(pm25Val) || 0;
  let status = '';
  let color = '';
  let advice = '';
  let percent = 0; // 进度条百分比 (0 - 100%)

  if (val <= 35) {
    status = '优';
    color = '#10b981';
    advice = '空气质量令人满意，基本无空气污染，非常适宜户外运动和开窗通风。';
    percent = (val / 35) * 16.6;
  } else if (val <= 75) {
    status = '良';
    color = '#f59e0b';
    advice = '空气质量良好，极少数敏感人群应适当减少高强度的户外剧烈锻炼。';
    percent = 16.6 + ((val - 35) / 40) * 16.6;
  } else if (val <= 115) {
    status = '轻度污染';
    color = '#f97316';
    advice = '易感人群症状有轻度加剧，儿童、老人及呼吸道疾病患者宜减少户外活动。';
    percent = 33.2 + ((val - 75) / 40) * 16.6;
  } else if (val <= 150) {
    status = '中度污染';
    color = '#ef4444';
    advice = '可能对健康人群有影响，敏感人群应留在室内，外出建议佩戴防霾口罩。';
    percent = 49.8 + ((val - 115) / 35) * 16.6;
  } else if (val <= 250) {
    status = '重度污染';
    color = '#8b5cf6';
    advice = '健康人群普遍出现症状，建议关闭门窗并开启空气净化器，避免户外运动。';
    percent = 66.4 + ((val - 150) / 100) * 16.6;
  } else {
    status = '严重污染';
    color = '#881337';
    advice = '健康人运动耐受力明显降低，出现强烈不适，尽量留在室内不要外出。';
    percent = Math.min(100, 83 + ((val - 250) / 150) * 17);
  }

  return {
    value: val.toFixed(1),
    status,
    color,
    advice,
    percent: Math.max(4, Math.min(96, percent)),
  };
}

/**
 * 紫外线指数解读 (UV Index)
 */
export function getUVDescription(uv) {
  const val = Number(uv) || 0;
  if (val <= 2) return { text: '最弱', advice: '无须防护' };
  if (val <= 5) return { text: '中等', advice: '涂擦SPF15防晒' };
  if (val <= 7) return { text: '较高', advice: '外出需遮阳帽防晒' };
  if (val <= 10) return { text: '极高', advice: '尽量减少正午外出' };
  return { text: '危险', advice: '避免在日光下暴晒' };
}

/**
 * 风向度数转中文 (0-360°)
 */
export function getWindDirection(deg) {
  const d = (deg % 360 + 360) % 360;
  if (d >= 337.5 || d < 22.5) return '北风';
  if (d >= 22.5 && d < 67.5) return '东北风';
  if (d >= 67.5 && d < 112.5) return '东风';
  if (d >= 112.5 && d < 157.5) return '东南风';
  if (d >= 157.5 && d < 202.5) return '南风';
  if (d >= 202.5 && d < 247.5) return '西南风';
  if (d >= 247.5 && d < 292.5) return '西风';
  return '西北风';
}

/**
 * 风速 km/h 转风力等级 (蒲福风级)
 */
export function getBeaufortScale(kmh) {
  const speed = Number(kmh) || 0;
  if (speed < 1) return '0级 (无风)';
  if (speed < 6) return '1级 (软风)';
  if (speed < 12) return '2级 (轻风)';
  if (speed < 20) return '3级 (微风)';
  if (speed < 29) return '4级 (和风)';
  if (speed < 39) return '5级 (清风)';
  if (speed < 50) return '6级 (强风)';
  return '7级以上 (疾风/大风)';
}

/**
 * 精美内置 SVG 图标库 (免外部静态图片依赖，加载极其迅捷)
 */
/** 内置矢量天气图标表：模块级常量，只构建一次 */
const WEATHER_ICON_SVG = {
  'clear-day': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="14" fill="#FBBF24"/>
      <g stroke="#FBBF24" stroke-width="3" stroke-linecap="round">
        <line x1="32" y1="8" x2="32" y2="4"/>
        <line x1="32" y1="60" x2="32" y2="56"/>
        <line x1="8" y1="32" x2="4" y2="32"/>
        <line x1="60" y1="32" x2="56" y2="32"/>
        <line x1="15.03" y1="15.03" x2="12.2" y2="12.2"/>
        <line x1="51.8" y1="51.8" x2="48.97" y2="48.97"/>
        <line x1="15.03" y1="48.97" x2="12.2" y2="51.8"/>
        <line x1="51.8" y1="12.2" x2="48.97" y2="15.03"/>
      </g>
    </svg>`,
  'clear-night': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M42 36C42 46.5 33.5 55 23 55C18.4 55 14.2 53.4 10.9 50.7C13.2 51.5 15.7 52 18.3 52C28.8 52 37.3 43.5 37.3 33C37.3 25.1 32.5 18.3 25.7 15.4C35.2 16.9 42 25.4 42 36Z" fill="#FDE047"/>
    </svg>`,
  'partly-cloudy-day': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="26" cy="24" r="10" fill="#FBBF24"/>
      <path d="M46 48H22C16.5 48 12 43.5 12 38C12 32.9 15.8 28.7 20.7 28.1C22.6 22.3 28 18 34.5 18C42.5 18 49 24.5 49 32.5C49 33.2 48.9 33.9 48.8 34.6C51.8 35.8 54 38.6 54 42C54 45.3 50.4 48 46 48Z" fill="#E2E8F0" fill-opacity="0.95"/>
    </svg>`,
  'partly-cloudy-night': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M30 22C30 28 25 32 19 32C17 32 15 31.5 13 30.5C14.5 34 18 36 22 36C27.5 36 32 31.5 32 26C32 23 31 20 29.5 18C30 19.3 30 20.6 30 22Z" fill="#FDE047"/>
      <path d="M46 48H22C16.5 48 12 43.5 12 38C12 32.9 15.8 28.7 20.7 28.1C22.6 22.3 28 18 34.5 18C42.5 18 49 24.5 49 32.5C49 33.2 48.9 33.9 48.8 34.6C51.8 35.8 54 38.6 54 42C54 45.3 50.4 48 46 48Z" fill="#94A3B8" fill-opacity="0.9"/>
    </svg>`,
  'overcast': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M48 46H20C15 46 11 42 11 37C11 32.5 14.5 28.7 19 28.1C20.8 22.8 25.8 19 31.8 19C39 19 45 24.8 45.2 32C48 33 50 35.8 50 39C50 42.9 46.8 46 48 46Z" fill="#CBD5E1"/>
      <path d="M38 52H14C9.6 52 6 48.4 6 44C6 40 9.2 36.6 13.2 36.1C14.8 31.4 19.2 28 24.5 28C30.8 28 36 33.1 36.2 39.5C38.6 40.4 40.4 42.8 40.4 45.6C40.4 49.1 37.6 52 38 52Z" fill="#94A3B8"/>
    </svg>`,
  'rain': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M46 38H22C16.5 38 12 33.5 12 28C12 22.9 15.8 18.7 20.7 18.1C22.6 12.3 28 8 34.5 8C42.5 8 49 14.5 49 22.5C49 23.2 48.9 23.9 48.8 24.6C51.8 25.8 54 28.6 54 32C54 35.3 50.4 38 46 38Z" fill="#94A3B8"/>
      <g stroke="#38BDF8" stroke-width="2.5" stroke-linecap="round">
        <line x1="22" y1="44" x2="18" y2="54"/>
        <line x1="32" y1="44" x2="28" y2="54"/>
        <line x1="42" y1="44" x2="38" y2="54"/>
      </g>
    </svg>`,
  'drizzle': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M46 38H22C16.5 38 12 33.5 12 28C12 22.9 15.8 18.7 20.7 18.1C22.6 12.3 28 8 34.5 8C42.5 8 49 14.5 49 22.5C51.8 25.8 54 28.6 54 32C54 35.3 50.4 38 46 38Z" fill="#94A3B8"/>
      <g stroke="#7DD3FC" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 3">
        <line x1="24" y1="44" x2="21" y2="52"/>
        <line x1="34" y1="44" x2="31" y2="52"/>
        <line x1="44" y1="44" x2="41" y2="52"/>
      </g>
    </svg>`,
  'snow': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M46 38H22C16.5 38 12 33.5 12 28C12 22.9 15.8 18.7 20.7 18.1C22.6 12.3 28 8 34.5 8C42.5 8 49 14.5 49 22.5C51.8 25.8 54 28.6 54 32C54 35.3 50.4 38 46 38Z" fill="#CBD5E1"/>
      <g fill="#E0F2FE">
        <circle cx="22" cy="48" r="2.5"/>
        <circle cx="32" cy="46" r="2.5"/>
        <circle cx="42" cy="48" r="2.5"/>
        <circle cx="27" cy="54" r="2.5"/>
        <circle cx="37" cy="54" r="2.5"/>
      </g>
    </svg>`,
  'thunderstorm': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M46 36H22C16.5 36 12 31.5 12 26C12 20.9 15.8 16.7 20.7 16.1C22.6 10.3 28 6 34.5 6C42.5 6 49 12.5 49 20.5C51.8 23.8 54 26.6 54 30C54 33.3 50.4 36 46 36Z" fill="#475569"/>
      <polygon points="32,36 24,47 31,47 28,58 40,45 33,45" fill="#FACC15"/>
    </svg>`,
  'fog': `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#CBD5E1" stroke-width="3" stroke-linecap="round">
        <line x1="16" y1="26" x2="48" y2="26"/>
        <line x1="12" y1="34" x2="52" y2="34"/>
        <line x1="18" y1="42" x2="46" y2="42"/>
        <line x1="22" y1="50" x2="42" y2="50"/>
      </g>
    </svg>`
};

export function getSvgIcon(iconName) {
  return WEATHER_ICON_SVG[iconName] || WEATHER_ICON_SVG['partly-cloudy-day'];
}
