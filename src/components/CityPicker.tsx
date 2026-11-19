import { useEffect, useMemo, useRef, useState } from "react";
import { CITY_GROUPS, type CityEntry } from "../lib/weather";
import type { CityRecord } from "../lib/types";

type Props = {
  /** 将用户选定的城市交给调用方。 */
  onPick: (city: CityRecord) => void;
  /** 通知父组件关闭当前面板。 */
  onClose: () => void;
};

interface Row {
  city: CityEntry;
  province: string;
  group?: string;
}

/**
 * 可搜索的全国城市选择器：覆盖 340+ 地级市与 1800+ 县级单位。
 * 空关键字按省份分组列出地级市；输入后按 城市名/所属市/省份 模糊过滤（含县级）。
 */
export default function CityPicker({ onPick, onClose }: Props) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    /** 按 Escape 关闭城市选择面板。 */
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    /** 检测面板外部点击，避免点击面板内部时误关闭。 */
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const rows = useMemo<Row[]>(() => {
    const query = q.trim();
    if (!query) {
      // 无关键字：只列地级市（县市靠搜索进入，避免首屏两千行）
      return CITY_GROUPS.flatMap((g) =>
        g.cities.filter((c) => !c.parent).map((c) => ({ city: c, province: g.province })),
      );
    }
    const out: Row[] = [];
    for (const g of CITY_GROUPS) {
      for (const c of g.cities) {
        if (
          c.name.includes(query) ||
          (c.parent && c.parent.includes(query)) ||
          g.province.includes(query)
        ) {
          out.push({ city: c, province: g.province });
        }
      }
    }
    return out.slice(0, 80);
  }, [q]);

  /** 选中当前搜索结果中的第一座城市。 */
  const pickFirst = () => {
    if (rows.length > 0)
      onPick({ name: rows[0].city.name, lat: rows[0].city.lat, lon: rows[0].city.lon });
  };

  // 无关键字时按省份分组渲染
  const grouped = useMemo(() => {
    if (q.trim()) return null;
    const map: { province: string; items: Row[] }[] = [];
    for (const r of rows) {
      const last = map[map.length - 1];
      if (last && last.province === r.province) last.items.push(r);
      else map.push({ province: r.province, items: [r] });
    }
    return map;
  }, [rows, q]);

  /** 生成城市的地区说明，帮助区分重名城市。 */
  const hint = (r: Row) => (r.city.parent ? `${r.city.parent} · ${r.province}` : r.province);

  return (
    <div className="city-picker" ref={boxRef}>
      <div className="city-picker-head">
        <input
          ref={inputRef}
          className="city-picker-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") pickFirst();
          }}
          placeholder="搜索：城市 / 区县 / 省份"
          maxLength={12}
        />
      </div>
      <div className="city-list" role="listbox" aria-label="城市列表">
        {rows.length === 0 && <p className="city-empty">没有匹配的城市</p>}
        {grouped
          ? grouped.map((g) => (
              <div key={g.province} className="city-group">
                <p className="city-group-label">{g.province}</p>
                {g.items.map((r) => (
                  <button key={r.city.name} className="city-row" onClick={() => onPick(r.city)}>
                    {r.city.name}
                  </button>
                ))}
              </div>
            ))
          : rows.map((r) => (
              <button
                key={`${r.city.parent ?? ""}-${r.city.name}`}
                className="city-row flat"
                onClick={() => onPick(r.city)}
              >
                <span className="city-name">{r.city.name}</span>
                <span className="city-hint">{hint(r)}</span>
              </button>
            ))}
      </div>
    </div>
  );
}
