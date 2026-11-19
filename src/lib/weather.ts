import { browserStorage as localStorage } from "./browserStorage";
/** 天气：Open-Meteo 免费接口（无需 key）。按城市坐标缓存 30 分钟，支持常驻 + 关注两个城市。 */

import chinaCities from "../../resources/china-cities.json";
import type { CityRecord } from "./types";

export interface DayWeather {
  date: string;
  code: number;
  max: number;
  min: number;
}

/** 当前天气实况 + 日出日落 */
export interface CurrentWeather {
  temperature: number;
  apparent: number;
  humidity: number;
  windSpeed: number;
  code: number;
}

export interface WeatherInfo {
  city: string;
  today: DayWeather;
  tomorrow: DayWeather;
  current: CurrentWeather | null;
  uvIndex: number | null;
  precipitationProb: number | null;
  fetchedAt: number;
}

const CACHE_KEY = "calendar.weather.v3";
const LEGACY_LOCATION_KEY = "calendar.weather.location";
const CACHE_MS = 30 * 60_000;

type SavedLocation = CityRecord;

/** 根据城市坐标生成独立的天气缓存键。 */
function locKey(loc: SavedLocation): string {
  return `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
}

/** 旧版单城市位置的迁移入口：设置常驻地区时作为默认值 */
export function legacyLocation(): SavedLocation | null {
  try {
    const raw = localStorage.getItem(LEGACY_LOCATION_KEY);
    if (raw) {
      const loc = JSON.parse(raw) as SavedLocation;
      if (typeof loc.name === "string" && Number.isFinite(loc.lat) && Number.isFinite(loc.lon))
        return loc;
    }
  } catch {
    // 损坏按无处理
  }
  return null;
}

/** WMO 天气代码 → emoji + 中文描述 */
export function wmoInfo(code: number): { emoji: string; text: string } {
  if (code === 0) return { emoji: "☀️", text: "晴" };
  if (code === 1) return { emoji: "🌤️", text: "晴间多云" };
  if (code === 2) return { emoji: "⛅", text: "多云" };
  if (code === 3) return { emoji: "☁️", text: "阴" };
  if (code === 45 || code === 48) return { emoji: "🌫️", text: "雾" };
  if (code >= 51 && code <= 57) return { emoji: "🌦️", text: "毛毛雨" };
  if (code >= 61 && code <= 67) return { emoji: "🌧️", text: "雨" };
  if (code >= 71 && code <= 77) return { emoji: "❄️", text: "雪" };
  if (code >= 80 && code <= 82) return { emoji: "🌦️", text: "阵雨" };
  if (code === 85 || code === 86) return { emoji: "🌨️", text: "阵雪" };
  if (code >= 95) return { emoji: "⛈️", text: "雷雨" };
  return { emoji: "🌡️", text: "—" };
}

/** 读取天气缓存集合，损坏或不可用时返回空集合。 */
function readCacheAll(): Record<string, WeatherInfo> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const map = JSON.parse(raw) as Record<string, WeatherInfo>;
      if (map && typeof map === "object") return map;
    }
  } catch {
    // 缓存损坏按无缓存处理
  }
  return {};
}

/** 读取指定城市的缓存，避免不同城市之间混用天气数据。 */
function readCacheFor(loc: SavedLocation): WeatherInfo | null {
  const info = readCacheAll()[locKey(loc)];
  if (info && Date.now() - info.fetchedAt < CACHE_MS && info.today && info.tomorrow) return info;
  return null;
}

/** 保存指定城市的天气结果和获取时间。 */
function writeCacheFor(loc: SavedLocation, info: WeatherInfo) {
  try {
    const map = readCacheAll();
    // 只保留最近 8 个城市，避免无限增长
    const keys = Object.keys(map).sort((a, b) => map[b].fetchedAt - map[a].fetchedAt);
    if (keys.length >= 8) for (const k of keys.slice(7)) delete map[k];
    map[locKey(loc)] = info;
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    // 存储失败只影响缓存
  }
}

/** 获取并转换城市天气预报，在请求失败时按现有规则使用缓存。 */
async function fetchForecast(loc: SavedLocation): Promise<WeatherInfo> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_probability_max` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
    `&timezone=auto&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`天气服务 HTTP ${res.status}`);
  const json = (await res.json()) as {
    current?: {
      temperature_2m: number;
      relative_humidity_2m: number;
      apparent_temperature: number;
      weather_code: number;
      wind_speed_10m: number;
    };
    daily: {
      time: string[];
      weather_code: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      uv_index_max?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const d = json.daily;
  if (!d.time || d.time.length < 2) throw new Error("天气数据不完整");
  return {
    city: loc.name,
    today: {
      date: d.time[0],
      code: d.weather_code[0],
      max: Math.round(d.temperature_2m_max[0]),
      min: Math.round(d.temperature_2m_min[0]),
    },
    tomorrow: {
      date: d.time[1],
      code: d.weather_code[1],
      max: Math.round(d.temperature_2m_max[1]),
      min: Math.round(d.temperature_2m_min[1]),
    },
    current: json.current
      ? {
          temperature: Math.round(json.current.temperature_2m),
          apparent: Math.round(json.current.apparent_temperature),
          humidity: Math.round(json.current.relative_humidity_2m),
          windSpeed: Math.round(json.current.wind_speed_10m),
          code: json.current.weather_code,
        }
      : null,
    uvIndex: d.uv_index_max?.[0] != null ? Math.round(d.uv_index_max[0]) : null,
    precipitationProb:
      d.precipitation_probability_max?.[0] != null
        ? Math.round(d.precipitation_probability_max[0])
        : null,
    fetchedAt: Date.now(),
  };
}

/** 取某城市天气：缓存优先，过期或未缓存则请求（失败返回 null） */
export async function getWeatherFor(loc: SavedLocation): Promise<WeatherInfo | null> {
  const cached = readCacheFor(loc);
  if (cached) return cached;
  try {
    const info = await fetchForecast(loc);
    writeCacheFor(loc, info);
    return info;
  } catch {
    return null;
  }
}

/** 全国城市预置：省→市/县两级（阿里云 DataV 行政区划中心坐标，scripts/fetch-china-cities.cjs 生成） */
export interface CityEntry extends CityRecord {
  /** 县级条目所属的地级市 */
  parent?: string;
}

export interface CityGroup {
  province: string;
  cities: CityEntry[];
}

export const CITY_GROUPS = chinaCities as CityGroup[];

/** 扁平城市表（按名称查找坐标） */
export const CITY_PRESETS: SavedLocation[] = CITY_GROUPS.flatMap((g) => g.cities);
