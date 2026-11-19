/**
 * 从阿里云 DataV 行政区划边界拉取全国 省→市→县 三级名称与中心坐标。
 * 输出 resources/china-cities.json：
 *   [{ province: "浙江", cities: [{ name: "衢州", lat, lon }, { name: "江山", lat, lon, parent: "衢州" }, ...] }]
 * 县级条目带 parent（所属地级市简称）；直辖市区县不下钻，只保留市本身。
 */
const fs = require("node:fs");
const path = require("node:path");

const BASE = "https://geo.datav.aliyun.com/areas_v3/bound";
// 直辖市/港澳台只取自身一个条目（辖区天气差异无意义）
const SINGLE = new Set(["110000", "120000", "310000", "500000", "810000", "820000", "710000"]);
const CONCURRENCY = 6;

const PROVINCE_SHORT = {
  北京市: "北京",
  天津市: "天津",
  上海市: "上海",
  重庆市: "重庆",
  新疆维吾尔自治区: "新疆",
  广西壮族自治区: "广西",
  内蒙古自治区: "内蒙古",
  宁夏回族自治区: "宁夏",
  西藏自治区: "西藏",
  香港特别行政区: "香港",
  澳门特别行政区: "澳门",
  台湾省: "台湾",
};

/** 简称：去尾部“市”（保留自治州/盟/地区等专名） */
function shortName(name) {
  if (name.endsWith("市") && name.length > 2) return name.slice(0, -1);
  return name;
}

/** 获取行政区划 JSON，未找到时返回空值，网络失败时按次数退避重试。 */
async function j(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  return null;
}

/** 限并发跑任务 */
async function pool(items, limit, fn) {
  const out = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  const root = await j(`${BASE}/100000_full.json`);
  const provinces = root.features
    .map((f) => f.properties || {})
    .filter((p) => p.name && p.level === "province");

  // 1) 每省的市级列表（保留 adcode 供下钻）
  const provResults = await pool(provinces, CONCURRENCY, async (p) => {
    const label = PROVINCE_SHORT[p.name] ?? shortName(p.name);
    if (SINGLE.has(String(p.adcode))) {
      return { label, cities: [{ name: label, lat: p.center[1], lon: p.center[0], adcode: null }] };
    }
    const sub = await j(`${BASE}/${p.adcode}_full.json`);
    if (!sub || !Array.isArray(sub.features)) throw new Error(`${p.name} 无市级数据`);
    const cities = sub.features
      .map((c) => c.properties || {})
      .filter((c) => c.name && Array.isArray(c.center) && c.center.length === 2)
      .map((c) => ({
        name: shortName(c.name),
        lat: c.center[1],
        lon: c.center[0],
        adcode: c.level === "city" ? String(c.adcode) : null,
      }));
    return { label, cities };
  });

  // 2) 对每个地级市下钻县级（县级市/县/自治县/旗；跳过市辖区“区”）
  const drillList = provResults.flatMap((g, gi) =>
    g.cities.filter((c) => c.adcode).map((c) => ({ ...c, gi, province: g.label })),
  );
  const countyResults = await pool(drillList, CONCURRENCY, async (city) => {
    const sub = await j(`${BASE}/${city.adcode}_full.json`);
    if (!sub || !Array.isArray(sub.features)) return { gi: city.gi, counties: [] };
    const counties = sub.features
      .map((c) => c.properties || {})
      .filter((c) => c.name && Array.isArray(c.center) && c.center.length === 2)
      .filter((c) => /(市|县|旗)$/.test(c.name))
      .map((c) => ({
        name: shortName(c.name),
        lat: c.center[1],
        lon: c.center[0],
        parent: city.name,
      }));
    return { gi: city.gi, counties };
  });

  // 3) 组装：省内市级在前、县级在后（同省去重）
  const groups = provResults.map((g, gi) => {
    const seen = new Set(g.cities.map((c) => c.name));
    /** 按脚本规定的小数精度规范城市经纬度。 */
    const round = (v) => +v.toFixed(2);
    const prefectures = g.cities.map((c) => ({
      name: c.name,
      lat: round(c.lat),
      lon: round(c.lon),
    }));
    const counties = countyResults
      .filter((r) => r.gi === gi)
      .flatMap((r) => r.counties)
      .filter((c) => c.name !== c.parent && !seen.has(c.name))
      .map((c) => {
        seen.add(c.name);
        return { name: c.name, lat: round(c.lat), lon: round(c.lon), parent: c.parent };
      });
    return { province: g.label, cities: [...prefectures, ...counties] };
  });

  const out = path.join(__dirname, "..", "resources", "china-cities.json");
  fs.writeFileSync(out, JSON.stringify(groups, null, 1));
  const total = groups.reduce((n, g) => n + g.cities.length, 0);
  const countyCount = groups.reduce((n, g) => n + g.cities.filter((c) => c.parent).length, 0);
  console.log(
    `省级分组 ${groups.length}，市级 ${total - countyCount}，县级 ${countyCount}，共 ${total}`,
  );
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
