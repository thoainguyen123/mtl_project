import { getDb } from "@/lib/store/db";
import type { TaskTracking } from "@/lib/types";

/** Lấy (hoặc tạo) bản ghi tracking của 1 công việc: key = `${versionId}:${taskId}` */
export function ensureTracking(taskKey: string): TaskTracking {
  const db = getDb();
  let t = db.tracking.find((x) => x.taskId === taskKey);
  if (!t) {
    t = { taskId: taskKey, percent: 0, evidence: [], comments: [] };
    db.tracking.push(t);
  }
  return t;
}
