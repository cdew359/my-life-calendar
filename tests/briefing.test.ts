import assert from "node:assert/strict";
import { test } from "node:test";
import { briefingText } from "../src/lib/briefing.ts";
import { tomorrowKey } from "../src/lib/dates.ts";
import { wmoInfo } from "../src/lib/weather.ts";
import type { WeatherInfo } from "../src/lib/weather.ts";

test("tomorrowKey 恰好是明天", () => {
  const t = tomorrowKey();
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const expect =
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0");
  assert.equal(t, expect);
});

test("briefingText：有计划 + 有天气", () => {
  const weather: WeatherInfo = {
    city: "上海",
    today: { date: "2026-09-17", code: 0, max: 30, min: 22 },
    tomorrow: { date: "2026-09-18", code: 61, max: 26, min: 20 },
    current: null,
    uvIndex: null,
    precipitationProb: null,
    fetchedAt: 0,
  };
  const text = briefingText(["交周报", "买高铁票"], weather);
  assert.ok(text.startsWith("明天：交周报、买高铁票｜"));
  assert.ok(text.includes("今天 晴 22~30°"));
  assert.ok(text.includes("明天 雨 20~26°"));
});

test("briefingText：无计划无天气", () => {
  const text = briefingText([], null);
  assert.equal(text, "明天：还没有安排，考虑规划一下？");
});

test("wmoInfo 映射", () => {
  assert.equal(wmoInfo(0).text, "晴");
  assert.equal(wmoInfo(3).text, "阴");
  assert.equal(wmoInfo(61).text, "雨");
  assert.equal(wmoInfo(95).text, "雷雨");
  assert.equal(wmoInfo(7).text, "—"); // WMO 未定义的码
});
