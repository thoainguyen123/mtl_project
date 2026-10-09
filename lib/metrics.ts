// Tính chỉ số Dashboard / Tracking từ MTL + tracking. Trọng số = thời lượng (ngày làm việc).
import type { MtlVersion, TaskNode, TaskTracking } from "@/lib/types";

export interface Row { plan: number; actual: number; total: number; done: number; late: number; label: string; onTime: number | null; quality: number | null }

const day = 86400000;
const t = (iso: string) => new Date(iso + "T00:00:00Z").getTime();

export function planPercent(task: TaskNode, today: string): number {
  if (!task.start || !task.finish) return 0;
  if (today >= task.finish) return 100;
  if (today < task.start) return 0;
  return Math.round(((t(today) - t(task.start)) / Math.max(day, t(task.finish) - t(task.start) + day)) * 100);
}

export function pctOf(task: TaskNode, tr: Map<string, TaskTracking>, vid: string): number {
  if (task.status === "done") return 100;
  return tr.get(`${vid}:${task.id}`)?.percent ?? 0;
}

const trackable = (x: TaskNode) => x.kind === "task" && x.status !== "closed";

function agg(label: string, tasks: TaskNode[], tr: Map<string, TaskTracking>, vid: string, today: string): Row {
  let w = 0, pl = 0, ac = 0, done = 0, late = 0, onTime = 0, qSum = 0, qN = 0;
  for (const k of tasks) {
    const wt = Math.max(1, k.durationDays);
    const p = pctOf(k, tr, vid);
    const rec = tr.get(`${vid}:${k.id}`);
    if (p >= 100 && rec?.doneAt && k.finish && rec.doneAt <= k.finish) onTime++;
    if (rec?.quality) { qSum += rec.quality; qN++; }
    w += wt;
    pl += wt * planPercent(k, today);
    ac += wt * p;
    if (p >= 100) done++;
    else if (k.finish && k.finish < today) late++;
  }
  return { label, total: tasks.length, done, late, plan: w ? Math.round(pl / w) : 0, actual: w ? Math.round(ac / w) : 0, onTime: done ? Math.round((onTime / done) * 100) : null, quality: qN ? Math.round((qSum / qN) * 10) / 10 : null };
}

export function versionMetrics(v: MtlVersion, tracking: TaskTracking[], today: string) {
  const tr = new Map(tracking.filter((x) => x.taskId.startsWith(v.id + ":")).map((x) => [x.taskId, x]));
  const tasks = v.tasks.filter(trackable);
  const overall = agg("Toàn dự án", tasks, tr, v.id, today);
  const group = (key: (k: TaskNode) => string | undefined) => {
    const m = new Map<string, TaskNode[]>();
    for (const k of tasks) {
      const g = key(k);
      if (!g) continue;
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(k);
    }
    return [...m].map(([l, ts]) => agg(l, ts, tr, v.id, today));
  };
  const byBan = group((k) => k.ban).sort((a, b) => b.total - a.total);
  const copies = group((k) => k.copyLabel);
  const byTitle = group((k) => k.assigneeTitle).sort((a, b) => b.late - a.late || b.total - a.total);
  const risky = tasks
    .map((k) => ({ k, p: pctOf(k, tr, v.id) }))
    .filter(({ k, p }) => p < 100 && k.finish && k.start && k.start <= today)
    .map(({ k, p }) => ({ id: k.id, wbs: k.wbs, name: k.name, ban: k.ban, title: k.assigneeTitle, finish: k.finish!, percent: p, daysLeft: Math.round((t(k.finish!) - t(today)) / day) }))
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8);
  return { overall, byBan, copies, byTitle, risky, openTasks: tasks.length - overall.done, conflicts: v.tasks.filter((x) => x.conflict).length };
}
