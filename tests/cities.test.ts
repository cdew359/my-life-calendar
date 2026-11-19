import assert from "node:assert/strict";
import { test } from "node:test";
import { CITY_GROUPS, CITY_PRESETS } from "../src/lib/weather.ts";

test("全国城市数据：34 个省级分组，市县两级名称唯一", () => {
  assert.equal(CITY_GROUPS.length, 34);
  const names = CITY_PRESETS.map((c) => c.name);
  assert.equal(names.length, new Set(names).size);
  assert.ok(names.length > 2000);
});

test("关键城市与县级单位都带合理坐标", () => {
  /** 在测试城市数据中按名称查找目标城市。 */
  const find = (n: string) => CITY_PRESETS.find((c) => c.name === n);
  const quzhou = find("衢州");
  const jiangshan = find("江山");
  const kunshan = find("昆山");
  const yiwu = find("义乌");
  assert.ok(quzhou && Math.abs(quzhou.lat - 28.94) < 0.3 && Math.abs(quzhou.lon - 118.87) < 0.3);
  assert.ok(jiangshan && Math.abs(jiangshan.lat - 28.73) < 0.3);
  assert.ok(kunshan && Math.abs(kunshan.lat - 31.38) < 0.3);
  assert.ok(yiwu && Math.abs(yiwu.lat - 29.31) < 0.3);
  // 所有坐标都在中国范围内
  for (const c of CITY_PRESETS) {
    assert.ok(c.lat > 15 && c.lat < 55, `${c.name} 纬度异常 ${c.lat}`);
    assert.ok(c.lon > 73 && c.lon < 136, `${c.name} 经度异常 ${c.lon}`);
  }
});

test("分组结构完整：每组有省份名与非空城市，县级条目带归属", () => {
  for (const g of CITY_GROUPS) {
    assert.ok(g.province.length > 0);
    assert.ok(g.cities.length > 0);
    for (const c of g.cities) {
      assert.ok(c.name.length >= 2, `名字过短: ${c.name}`);
      assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon));
    }
  }
  const zj = CITY_GROUPS.find((g) => g.province === "浙江省");
  const underQuzhou = zj?.cities.filter((c) => (c as { parent?: string }).parent === "衢州") ?? [];
  assert.ok(underQuzhou.some((c) => c.name === "江山"));
});
