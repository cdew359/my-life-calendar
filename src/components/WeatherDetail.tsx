import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { getWeatherFor, wmoInfo, type WeatherInfo } from "../lib/weather";
import type { CityRecord } from "../lib/types";
import CityPicker from "./CityPicker";

type Props = {
  city: CityRecord;
  /** 通知父组件关闭当前面板。 */
  onClose: () => void;
  /** 将重新选择的城市交给天气面板。 */
  onCityChange?: (city: CityRecord) => void;
};

/** 将紫外线指数转换为风险等级文本。 */
function uvLabel(uv: number): string {
  if (uv <= 2) return "弱";
  if (uv <= 5) return "中等";
  if (uv <= 7) return "强";
  if (uv <= 10) return "很强";
  return "极强";
}

/** 将风速转换为便于阅读的风力描述。 */
function windLabel(kmh: number): string {
  if (kmh < 6) return "微风";
  if (kmh < 20) return `${kmh} km/h`;
  if (kmh < 39) return `${kmh} km/h 大风`;
  return `${kmh} km/h 狂风`;
}

/** 天气详情弹框：当前实况 + 今明预报 + 换城市 */
export default function WeatherDetail({ city, onClose, onCityChange }: Props) {
  const [info, setInfo] = useState<WeatherInfo | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void getWeatherFor(city).then((w) => {
      if (alive) setInfo(w);
    });
    return () => {
      alive = false;
    };
  }, [city]);

  useEffect(() => {
    /** 按 Escape 关闭天气详情面板。 */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickerOpen) setPickerOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pickerOpen]);

  const cur = info?.current;
  const curWmo = cur ? wmoInfo(cur.code) : null;
  const todayWmo = info ? wmoInfo(info.today.code) : null;
  const tmrWmo = info ? wmoInfo(info.tomorrow.code) : null;

  return (
    <div
      className="weather-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="weather-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${city.name}天气详情`}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
      >
        <div className="weather-dialog-head">
          <h3>{city.name}</h3>
          <button className="remove" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {pickerOpen ? (
          <CityPicker
            onPick={(c) => {
              onCityChange?.(c);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        ) : !info || !todayWmo || !tmrWmo ? (
          <p className="weather-loading">加载中…</p>
        ) : (
          <>
            {/* 当前实况（接口偶发不返回 current 时降级显示今日概要） */}
            {cur && curWmo ? (
              <div className="weather-now">
                <span className="weather-now-emoji">{curWmo.emoji}</span>
                <div className="weather-now-body">
                  <span className="weather-now-temp">{cur.temperature}°</span>
                  <span className="weather-now-desc">{curWmo.text}</span>
                  <span className="weather-now-feels">体感 {cur.apparent}°</span>
                </div>
              </div>
            ) : (
              <div className="weather-now">
                <span className="weather-now-emoji">{todayWmo.emoji}</span>
                <div className="weather-now-body">
                  <span className="weather-now-temp">{info.today.max}°</span>
                  <span className="weather-now-desc">{todayWmo.text}</span>
                  <span className="weather-now-feels">
                    今日 {info.today.min}~{info.today.max}°
                  </span>
                </div>
              </div>
            )}

            {/* 指标网格 */}
            <div className="weather-grid">
              <div className="weather-cell">
                <span className="weather-cell-label">💧 湿度</span>
                <span className="weather-cell-value">{cur ? `${cur.humidity}%` : "—"}</span>
              </div>
              <div className="weather-cell">
                <span className="weather-cell-label">💨 风速</span>
                <span className="weather-cell-value">{cur ? windLabel(cur.windSpeed) : "—"}</span>
              </div>
              <div className="weather-cell">
                <span className="weather-cell-label">☀️ 紫外线</span>
                <span className="weather-cell-value">
                  {info.uvIndex != null ? uvLabel(info.uvIndex) : "—"}
                </span>
              </div>
              <div className="weather-cell">
                <span className="weather-cell-label">🌧️ 降水</span>
                <span className="weather-cell-value">
                  {info.precipitationProb != null ? `${info.precipitationProb}%` : "—"}
                </span>
              </div>
            </div>

            {/* 今明两日 */}
            <div className="weather-days">
              <div className="weather-day">
                <span className="weather-day-label">今天</span>
                <span className="weather-day-emoji">{todayWmo.emoji}</span>
                <span className="weather-day-desc">{todayWmo.text}</span>
                <span className="weather-day-temps">
                  {info.today.min}~{info.today.max}°
                </span>
              </div>
              <div className="weather-day tomorrow">
                <span className="weather-day-label">明天</span>
                <span className="weather-day-emoji">{tmrWmo.emoji}</span>
                <span className="weather-day-desc">{tmrWmo.text}</span>
                <span className="weather-day-temps">
                  {info.tomorrow.min}~{info.tomorrow.max}°
                </span>
              </div>
            </div>
          </>
        )}

        {!pickerOpen && (
          <button className="link-btn weather-change" onClick={() => setPickerOpen(true)}>
            🔄 更换城市
          </button>
        )}
      </motion.div>
    </div>
  );
}
