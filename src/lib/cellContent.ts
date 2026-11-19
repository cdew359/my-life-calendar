import type { DayNote, Plan } from "./types";

export type CellChip = { kind: "plan"; plan: Plan } | { kind: "note"; note: DayNote };

export interface FoldedCell {
  visible: CellChip[];
  /** 装不下折叠掉的条数（计划 + 记录合计） */
  folded: number;
}

/**
 * 等高格子内最多两行卡片。
 * 优先级：第一条计划 → 第一条记录（保证记录永远可见）→ 其余计划 → 其余记录。
 */
export function foldCellContent(plans: Plan[], notes: DayNote[]): FoldedCell {
  const visible: CellChip[] = [];
  let folded = 0;
  /** 在月历格子的容量允许时加入一条摘要，并记录被折叠的条目数。 */
  const push = (chip: CellChip) => {
    if (visible.length < 2) {
      visible.push(chip);
    } else {
      folded += 1;
    }
  };
  if (plans.length > 0) push({ kind: "plan", plan: plans[0] });
  if (notes.length > 0) push({ kind: "note", note: notes[0] });
  for (const plan of plans.slice(1)) push({ kind: "plan", plan });
  for (const note of notes.slice(1)) push({ kind: "note", note });
  return { visible, folded };
}
