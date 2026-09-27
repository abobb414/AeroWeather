/**
 * 彩云天气 Token 配置模板
 * ---------------------------------------------------------------
 * 用法：把本文件复制一份、改名为 `config.local.js`（放同一个 js/ 目录下），
 *      然后把下面的占位符换成你的真实 Token。页面会自动读取，无需改动其他代码。
 *
 *   cp js/config.example.js js/config.local.js
 *
 * config.local.js 属于本地私有配置，不要提交到仓库（.gitignore 已忽略）。
 *
 * Token 申请：https://dashboard.caiyunapp.com/
 * 试用版能力：逐日预报 3 天、逐时 24 小时、限流较紧。
 *
 * ⚠️ 不配也能用：
 *   没配 Token 时页面会自动走 Open-Meteo（免 Key、免注册、不限流）拿真实数据，
 *   只是拿不到彩云特有的「分钟级雷达降水」和「国标 AQI」。
 *   两条链路都断了才会退回本地示例数据，并在页脚明确标注。
 */
window.__CAIYUN_TOKEN__ = 'YOUR_CAIYUN_TOKEN';
