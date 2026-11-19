import { useEffect, useMemo, useState } from "react";
import { getWeatherFor, wmoInfo, type WeatherInfo } from "../lib/weather";
import WeatherDetail from "./WeatherDetail";
import type { CityRecord } from "../lib/types";

type Props = {
  home: CityRecord | null;
  watch: CityRecord | null;
  /** 将选定城市设置为常住城市。 */
  onSetHome: (city: CityRecord) => void;
  /** 更新或清空关注城市。 */
  onSetWatch: (city: CityRecord | null) => void;
};

/** 根据加载状态、错误和天气数据渲染单张天气卡片。 */
function CardBody({ info }: { info: WeatherInfo | null }) {
  if (!info) return <span className="weather-day">…</span>;
  const today = wmoInfo(info.today.code);
  const tomorrow = wmoInfo(info.tomorrow.code);
  return (
    <>
      <span className="weather-day">
        {today.emoji} {info.today.min}~{info.today.max}°
      </span>
      <span className="weather-day tomorrow">
        明天 {tomorrow.emoji} {info.tomorrow.min}~{info.tomorrow.max}°
      </span>
    </>
  );
}

/**
 * 顶部天气：常驻地区 + 可选的第二个关注城市（最多两张卡）。
 * 点卡片弹天气详情（居中弹框），详情里可以换城市。
 */
export default function WeatherCard({ home, watch, onSetHome, onSetWatch }: Props) {
  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherInfo | null>>({});
  const [detailCity, setDetailCity] = useState<CityRecord | null>(null);

  const locs = useMemo(
    () => [home, watch].filter((c): c is CityRecord => c !== null),
    [home, watch],
  );

  useEffect(() => {
    if (locs.length === 0) return;
    let alive = true;
    /** 根据城市坐标生成天气请求的去重标识。 */
    const key = (c: CityRecord) => `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
    /** 按需获取常住城市与关注城市的天气，避免相同城市重复请求。 */
    const fetchAll = async () => {
      const entries = await Promise.all(
        locs.map(async (c) => [key(c), await getWeatherFor(c)] as const),
      );
      if (!alive) return;
      setWeatherMap((prev) => {
        const next = { ...prev };
        for (const [k, v] of entries) next[k] = v;
        return next;
      });
    };
    void fetchAll();
    const timer = window.setInterval(() => void fetchAll(), 30 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [locs]);

  /** 根据城市坐标生成天气请求的去重标识。 */
  const key = (c: CityRecord) => `${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;

  if (!home) {
    return (
      <>
        <button
          className="ann-add weather-card"
          onClick={() => setDetailCity({ name: "选择城市", lat: 0, lon: 0 })}
        >
          📍 设常驻地区
        </button>
        {detailCity && (
          <WeatherDetail
            city={detailCity}
            onClose={() => setDetailCity(null)}
            onCityChange={(c) => {
              onSetHome(c);
              setDetailCity(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        className="ann-card weather-card home-card"
        onClick={() => setDetailCity(home)}
        title="点击查看天气详情"
      >
        <span className="ann-name">🏠{home.name}</span>
        <CardBody info={weatherMap[key(home)] ?? null} />
      </button>

      {watch && (
        <button
          className="ann-card weather-card watch-card"
          onClick={() => setDetailCity(watch)}
          title="点击查看天气详情"
        >
          <span className="ann-name">📍{watch.name}</span>
          <CardBody info={weatherMap[key(watch)] ?? null} />
          <span
            className="ann-remove"
            role="button"
            aria-label={`移除 ${watch.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onSetWatch(null);
            }}
          >
            ×
          </span>
        </button>
      )}

      {!watch && (
        <button
          className="ann-add"
          onClick={() => setDetailCity({ name: "选择城市", lat: 0, lon: 0 })}
        >
          + 城市
        </button>
      )}

      {detailCity && (
        <WeatherDetail
          city={detailCity}
          onClose={() => setDetailCity(null)}
          onCityChange={(c) => {
            // 判断改的是常驻还是关注
            if (detailCity.name === home.name && detailCity.lat === home.lat) {
              onSetHome(c);
            } else {
              onSetWatch(c);
            }
            setDetailCity(null);
          }}
        />
      )}
    </>
  );
}
