import { coerceData } from "../../src/lib/validate.ts";
import { mergeData, purgeDeleted } from "../../src/lib/sync.ts";
import type { AppData } from "../../src/lib/types.ts";

/** Keep the legacy client's deadline/step protection before merging a shared SQL state. */
export function mergeUpload(payload: unknown, current: AppData): AppData {
  const incoming = coerceData(payload);
  const rawLines = (payload as { timelines?: unknown[] }).timelines;
  incoming.timelines = incoming.timelines.map((t) => {
    const raw = Array.isArray(rawLines)
      ? (rawLines.find((r) => r && typeof r === "object" && (r as { id?: string }).id === t.id) as
          { endTime?: string; stepsMode?: boolean; items?: { step?: unknown }[] } | undefined)
      : undefined;
    const stored = current.timelines.find((r) => r.id === t.id);
    if (
      stored &&
      (stored.stepsMode || stored.items.some((i) => i.step)) &&
      (!raw?.items?.some((i) => i.step) || (stored.stepsMode && raw.stepsMode !== true)) &&
      !(raw?.stepsMode === true && stored.stepsMode && raw.items?.length === 0)
    )
      return stored;
    return stored?.endTime !== undefined && raw?.endTime === undefined && t.deletedAt === null
      ? stored
      : t;
  });
  return purgeDeleted(mergeData(incoming, current));
}
