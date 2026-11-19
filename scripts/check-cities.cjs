const d = require("../resources/china-cities.json");
const all = d.flatMap((g) => g.cities.map((c) => ({ ...c, province: g.province })));
/** 在行政区划数据中查找名称匹配的城市，供数据完整性检查使用。 */
const find = (name) => all.filter((c) => c.name === name);
for (const n of ["江山", "义乌", "昆山", "慈溪", "江山", "敦煌", "满洲里", "义乌", "石河子"]) {
  console.log(n, "→", JSON.stringify(find(n)));
}
const names = all.map((c) => c.name);
console.log("总数:", names.length, "| 重名:", names.length - new Set(names).size);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
if (dup.length) console.log("重名列表:", [...new Set(dup)].join(","));
const bad = all.filter(
  (c) => !c.name || c.name.length < 2 || c.lat < 15 || c.lat > 55 || c.lon < 73 || c.lon > 136,
);
console.log("异常条目:", bad.length, JSON.stringify(bad.slice(0, 3)));
const zj = d.find((g) => g.province === "浙江省");
console.log(
  "浙江市级:",
  zj.cities
    .filter((c) => !c.parent)
    .map((c) => c.name)
    .join(","),
);
console.log(
  "衢州下辖:",
  zj.cities
    .filter((c) => c.parent === "衢州")
    .map((c) => c.name)
    .join(","),
);
