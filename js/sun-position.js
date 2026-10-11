/**
 * 太阳三维天体物理引擎
 * ---------------------------------------------------------------------------
 * 输入：纬度、经度、时间戳
 * 输出：太阳的方位角（azimuth）与高度角（altitude）
 *
 * 用途：
 *   1. 丁达尔光（Volumetric Rays）的发散源头方向
 *   2. 环境光晕（Screen Halo）的投射方向
 *   3. 判断昼夜状态（太阳高度角 > 0 为白天）
 *
 * 算法：简化版 SPA (Solar Position Algorithm)，精度 ±0.5°
 */

import { clamp } from './math-utils.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;


/**
 * 计算儒略日 (Julian Day)
 */
function toJulianDay(date) {
  const time = date.getTime();
  return (time / 86400000) + 2440587.5;
}

/**
 * 计算儒略世纪 (Julian Century from J2000.0)
 */
function toJulianCentury(jd) {
  return (jd - 2451545.0) / 36525.0;
}

/**
 * 太阳平黄经（简化计算）
 */
function solarMeanLongitude(T) {
  let L0 = 280.46646 + T * (36000.76983 + T * 0.0003032);
  return (L0 % 360 + 360) % 360;
}

/**
 * 太阳平近点角
 */
function solarMeanAnomaly(T) {
  let M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  return (M % 360 + 360) % 360;
}

/**
 * 太阳真黄经（含摄动修正）
 */
function solarTrueLongitude(T) {
  const L0 = solarMeanLongitude(T);
  const M = solarMeanAnomaly(T) * DEG;
  const C = (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(M)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
          + 0.000289 * Math.sin(3 * M);
  return L0 + C;
}

/**
 * 黄赤交角（地轴倾角）
 */
function obliquityOfEcliptic(T) {
  const e0 = 23.439291 - T * (0.0130042 + T * (0.00000016 - T * 0.000000504));
  return e0;
}

/**
 * 太阳赤纬（太阳在天球上的纬度）
 */
function solarDeclination(T) {
  const lambda = solarTrueLongitude(T) * DEG;
  const epsilon = obliquityOfEcliptic(T) * DEG;
  const delta = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) * RAD;
  return delta;
}

/**
 * 太阳赤经
 */
function solarRightAscension(T) {
  const lambda = solarTrueLongitude(T) * DEG;
  const epsilon = obliquityOfEcliptic(T) * DEG;
  const alpha = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) * RAD;
  return (alpha % 360 + 360) % 360;
}

/**
 * 格林威治平恒星时 (GMST)
 */
function greenwichMeanSiderealTime(jd) {
  const T = toJulianCentury(jd);
  const theta0 = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
               + T * T * (0.000387933 - T / 38710000.0);
  return (theta0 % 360 + 360) % 360;
}

/**
 * 地方时角 (Hour Angle)
 */
function hourAngle(jd, longitude, ra) {
  const gmst = greenwichMeanSiderealTime(jd);
  const lmst = gmst + longitude;
  let H = lmst - ra;
  H = (H % 360 + 360) % 360;
  if (H > 180) H -= 360;
  return H;
}

/**
 * 计算太阳位置
 * @param {number} lat - 纬度（度）
 * @param {number} lon - 经度（度）
 * @param {Date} date - 时间
 * @returns {{azimuth:number, altitude:number, zenith:number}}
 *   - azimuth: 方位角（0°=正北，90°=正东，180°=正南，270°=正西）
 *   - altitude: 高度角（0°=地平线，90°=天顶，负值=地平线下）
 *   - zenith: 天顶角（90° - altitude）
 */
export function getSunPosition(lat, lon, date = new Date()) {
  const jd = toJulianDay(date);
  const T = toJulianCentury(jd);

  const dec = solarDeclination(T);
  const ra = solarRightAscension(T);
  const H = hourAngle(jd, lon, ra);

  const latRad = lat * DEG;
  const decRad = dec * DEG;
  const HRad = H * DEG;

  // 高度角
  const sinAlt = Math.sin(latRad) * Math.sin(decRad)
               + Math.cos(latRad) * Math.cos(decRad) * Math.cos(HRad);
  const altitude = Math.asin(clamp(sinAlt, -1, 1)) * RAD;

  // 方位角
  const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt)
              / (Math.cos(latRad) * Math.cos(altitude * DEG));
  let azimuth = Math.acos(clamp(cosAz, -1, 1)) * RAD;

  // 修正象限：时角 > 0 时太阳在西半球
  if (H > 0) azimuth = 360 - azimuth;

  return {
    azimuth,
    altitude,
    zenith: 90 - altitude,
  };
}
