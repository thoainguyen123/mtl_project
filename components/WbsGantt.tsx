"use client";
// Lưới WBS đa cấp (Tree Grid) + Gantt tương tác — BRD 2.2 mục 3 và Phase 3.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Diamond, Flame, Search, Shrink, Expand } from "lucide-react";
import { fmtDM } from "@/lib/client";
import { TASK_STATUS_LABEL, type TaskNode, type TaskStatus } from "@/lib/types";
import { TITLES } from "@/lib/engine/config";
import { cn } from "./ui";

const ROW = 32;
const DAY = 86400000;
const dnum = (iso: string) => Math.floor(new Date(iso + "T00:00:00Z").getTime() / DAY);
const iso = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

type View = "both" | "grid" | "gantt";
type Zoom = "week" | "month" | "quarter";
const PPD: Record<Zoom, number> = { week: 9, month: 3, quarter: 1.1 };

export interface Props {
  tasks: TaskNode[];
  today: string;
  canEdit: boolean;
  percents: Map<string, number>;
  selectedId?: string;
  onSelect: (t: TaskNode) => void;
  onPatch: (id: string, patch: { status?: TaskStatus; assigneeTitle?: string; durationDays?: number }) => Promise<void>;
  warnTick?: number; // tăng giá trị để bật bộ lọc “Cảnh báo” từ bên ngoài
  extra?: React.ReactNode; // chỉ số tóm tắt hiển thị ở thanh chân lưới
}

const STATUS_TONE: Record<TaskStatus, string> = {
  closed: "bg-slate-100 text-slate-500",
  in_progress: "bg-blue-50 text-blue-700",
  done: "bg-green-50 text-green-700",
};

export function WbsGantt({ tasks, today, canEdit, percents, selectedId, onSelect, onPatch, warnTick, extra }: Props) {
  const [view, setView] = useState<View>("both");
  const [zoom, setZoom] = useState<Zoom>("month");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(tasks.filter((t) => t.kind === "summary" && t.level >= 4).map((t) => t.id)));
  const [q, setQ] = useState("");
  const [ban, setBan] = useState("");
  const [st, setSt] = useState("");
  const [onlyCrit, setOnlyCrit] = useState(false);
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (warnTick) { setOnlyWarn(true); setOnlyCrit(false); } }, [warnTick]);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const kids = useMemo(() => {
    const m = new Map<string, TaskNode[]>();
    for (const t of tasks) { const k = t.parentId ?? "__root__"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); }
    return m;
  }, [tasks]);
  const depth = useMemo(() => {
    const d = new Map<string, number>();
    for (const t of tasks) d.set(t.id, t.parentId ? (d.get(t.parentId) ?? 0) + 1 : 0);
    return d;
  }, [tasks]);
  const bans = useMemo(() => [...new Set(tasks.map((t) => t.ban).filter(Boolean))].sort() as string[], [tasks]);
  const filtering = !!(q || ban || st || onlyCrit || onlyWarn);

  const rows = useMemo(() => {
    const out: TaskNode[] = [];
    if (filtering) {
      const ok = new Set<string>();
      const ql = q.toLowerCase();
      for (const t of tasks) {
        if (t.kind === "summary") continue;
        if (q && !(`${t.name} ${t.wbs} ${t.copyLabel ?? ""}`.toLowerCase().includes(ql))) continue;
        if (ban && t.ban !== ban) continue;
        if (st && t.status !== st) continue;
        if (onlyCrit && !t.critical) continue;
        if (onlyWarn && !t.conflict) continue;
        ok.add(t.id);
        for (let p = t.parentId; p; p = byId.get(p)?.parentId) ok.add(p);
      }
      for (const t of tasks) if (ok.has(t.id)) out.push(t);
      return out;
    }
    const walk = (pid: string) => {
      for (const t of kids.get(pid) ?? []) {
        out.push(t);
        if (t.kind === "summary" && !collapsed.has(t.id)) walk(t.id);
      }
    };
    walk("__root__");
    return out;
  }, [tasks, kids, byId, collapsed, filtering, q, ban, st, onlyCrit, onlyWarn]);

  // ---- hình học Gantt ----
  const ppd = PPD[zoom];
  const geo = useMemo(() => {
    const real = tasks.filter((t) => t.kind === "task" && t.start && t.finish && !t.tags?.includes("post_project") && t.kind === "task");
    const s = real.length ? Math.min(...real.map((t) => dnum(t.start!))) : dnum(today);
    const e = real.length ? Math.max(...real.map((t) => dnum(t.finish!))) : dnum(today) + 365;
    const rs = Math.min(s, dnum(today)) - 14;
    const re = e + 90;
    return { rs, re, w: Math.ceil((re - rs) * ppd) };
  }, [tasks, today, ppd]);
  const x = (isoDate: string) => (dnum(isoDate) - geo.rs) * ppd;

  const months = useMemo(() => {
    const out: { label: string; left: number; width: number; year?: string }[] = [];
    const d = new Date(geo.rs * DAY);
    let cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    while (cur.getTime() / DAY < geo.re) {
      const nxt = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
      const l = (cur.getTime() / DAY - geo.rs) * ppd;
      out.push({ label: `${String(cur.getUTCMonth() + 1).padStart(2, "0")}`, left: l, width: ((nxt.getTime() - cur.getTime()) / DAY) * ppd, year: cur.getUTCMonth() === 0 || !out.length ? String(cur.getUTCFullYear()) : undefined });
      cur = nxt;
    }
    return out;
  }, [geo, ppd]);

  const anchors = tasks.filter((t) => t.kind === "milestone" && t.start && t.anchor !== "T0");
  const totalH = rows.length * ROW;

  const expandTo = (lvl: number) => setCollapsed(new Set(tasks.filter((t) => t.kind === "summary" && (depth.get(t.id) ?? 0) >= lvl).map((t) => t.id)));
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const commit = async (id: string, patch: Parameters<Props["onPatch"]>[1]) => {
    setBusy(id);
    try { await onPatch(id, patch); } finally { setBusy(null); }
  };

  const colsGrid = view === "grid";
  const colsGantt = view === "gantt";
  const leftW = colsGrid ? 1010 : colsGantt ? 420 : 690;

  return (
    <div className="card flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* thanh công cụ */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-line bg-white p-2">
        <div className="relative w-56"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-ink-mute" /><input className="input pl-8" placeholder="Tìm công việc, WBS, tháp…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm công việc" /></div>
        <select className="input w-36" value={ban} onChange={(e) => setBan(e.target.value)} aria-label="Lọc Ban"><option value="">Tất cả Ban</option>{bans.map((b) => <option key={b}>{b}</option>)}</select>
        <select className="input w-40" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Lọc trạng thái"><option value="">Mọi trạng thái</option>{(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}</select>
        <button className={cn("btn-ghost", onlyCrit && "!border-red-400 !bg-red-50 !text-red-600")} onClick={() => setOnlyCrit((v) => !v)}><Flame className="h-4 w-4" /> Đường găng</button>
        <button className={cn("btn-ghost", onlyWarn && "!border-amber-400 !bg-amber-50 !text-amber-700")} onClick={() => setOnlyWarn((v) => !v)}><AlertTriangle className="h-4 w-4" /> Cảnh báo</button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded border border-surface-line" role="group" aria-label="Chế độ xem">
            {([["grid", "Lưới"], ["both", "Lưới + Gantt"], ["gantt", "Gantt"]] as const).map(([k, l]) => <button key={k} onClick={() => setView(k)} className={cn("h-9 px-3", view === k ? "bg-brand font-semibold text-white" : "bg-white hover:bg-surface-head")}>{l}</button>)}
          </div>
          {view !== "grid" && (
            <div className="flex overflow-hidden rounded border border-surface-line" role="group" aria-label="Thu phóng">
              {([["week", "Tuần"], ["month", "Tháng"], ["quarter", "Quý"]] as const).map(([k, l]) => <button key={k} onClick={() => setZoom(k)} className={cn("h-9 px-3", zoom === k ? "bg-ink-soft font-semibold text-white" : "bg-white hover:bg-surface-head")}>{l}</button>)}
            </div>
          )}
          <button className="btn-ghost" onClick={() => expandTo(1)} title="Thu gọn đến cấp 1"><Shrink className="h-4 w-4" /></button>
          <button className="btn-ghost" onClick={() => expandTo(3)} title="Mở đến cấp 3"><Expand className="h-4 w-4" /></button>
          <button className="btn-ghost" onClick={() => setCollapsed(new Set())} title="Mở tất cả">Mở tất cả</button>
        </div>
      </div>

      {/* thân: một vùng cuộn chung -> lưới (sticky trái) và Gantt cuộn cùng nhau */}
      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-auto max-lg:max-h-[75vh]" style={{ minHeight: 320 }}>
        <div style={{ width: (colsGrid ? leftW : leftW + geo.w), minWidth: "100%" }}>
          {/* header */}
          <div className="sticky top-0 z-30 flex border-b border-surface-line bg-surface-head" style={{ height: 44 }}>
            <div className="sticky left-0 z-20 flex shrink-0 items-center bg-surface-head text-[12px] font-semibold uppercase text-ink-head" style={{ width: leftW }}>
              <Cell w={92}>WBS</Cell><Cell w={colsGantt ? 328 : 330} grow>Công việc</Cell>
              {!colsGantt && <>
                {colsGrid && <><Cell w={52}>Ban</Cell><Cell w={190}>Chức danh</Cell></>}
                <Cell w={64} center>Ngày</Cell><Cell w={78} center>Bắt đầu</Cell><Cell w={78} center>Kết thúc</Cell><Cell w={118}>Trạng thái</Cell>{colsGrid && <Cell w={44} center>⚠</Cell>}
              </>}
            </div>
            {!colsGrid && (
              <div className="relative shrink-0" style={{ width: geo.w }}>
                {months.map((m) => (
                  <div key={m.left} className="absolute top-0 h-full border-l border-surface-line text-center" style={{ left: m.left, width: m.width }}>
                    {m.year && <div className="absolute left-1 top-0.5 text-[10px] font-bold text-ink-soft">{m.year}</div>}
                    <div className="absolute bottom-1 w-full text-[11px] text-ink-mute">{zoom === "quarter" ? (Number(m.label) % 3 === 1 ? `Q${Math.ceil(Number(m.label) / 3)}` : "") : m.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* các dòng */}
          <div className="relative" style={{ height: totalH }}>
            {/* đường dọc mốc + hôm nay (nằm dưới các dòng) */}
            {!colsGrid && (
              <div className="pointer-events-none absolute top-0 z-[5]" style={{ left: leftW, width: geo.w, height: totalH }}>
                <div className="absolute top-0 h-full w-px border-l border-dashed border-blue-500" style={{ left: x(today) }} title={`Hôm nay ${today}`} />
                {anchors.map((m) => <div key={m.id} className="absolute top-0 h-full w-px bg-amber-400/70" style={{ left: x(m.start!) }} />)}
              </div>
            )}
            {rows.map((t, i) => {
              const d = depth.get(t.id) ?? 0;
              const isSum = t.kind === "summary";
              const leaf = t.kind === "task" || t.kind === "periodic";
              const sel = t.id === selectedId;
              const pct = percents.get(t.id) ?? (t.status === "done" ? 100 : 0);
              const edit = canEdit && t.kind === "task";
              return (
                <div key={t.id} className={cn("group absolute left-0 flex w-full border-b border-slate-100", sel ? "bg-blue-50" : i % 2 ? "bg-slate-50/60" : "bg-white", t.status === "closed" && "opacity-60")} style={{ top: i * ROW, height: ROW }} onClick={() => onSelect(t)}>
                  <div className={cn("sticky left-0 z-10 flex shrink-0 items-center", sel ? "bg-blue-50" : i % 2 ? "bg-slate-50" : "bg-white", isSum && "font-semibold")} style={{ width: leftW }}>
                    <Cell w={92}><span className="truncate font-mono text-[11px] text-ink-mute" title={t.wbs}>{t.wbs}</span></Cell>
                    <Cell w={colsGantt ? 328 : 330} grow>
                      <div className="flex min-w-0 items-center" style={{ paddingLeft: Math.min(d, 6) * 12 }}>
                        {isSum ? (
                          <button className="mr-1 shrink-0 rounded p-0.5 hover:bg-slate-200" onClick={(e) => { e.stopPropagation(); toggle(t.id); }} aria-label={collapsed.has(t.id) ? "Mở nhánh" : "Thu nhánh"}>
                            {collapsed.has(t.id) && !filtering ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        ) : t.kind === "milestone" ? <Diamond className="mr-1 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" /> : <span className="mr-1 w-4 shrink-0" />}
                        <span className="truncate" title={t.name}>{t.name}</span>
                        {t.tags?.includes("demo_supplement") && <span className="ml-1 shrink-0 rounded bg-violet-100 px-1 text-[10px] text-violet-700" title="Tác vụ minh họa do demo bổ sung, không có trong Excel">demo</span>}
                        {t.kind === "periodic" && <span className="ml-1 shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">định kỳ</span>}
                      </div>
                    </Cell>
                    {!colsGantt && <>
                      {colsGrid && <>
                        <Cell w={52}><span className="text-[11px] text-ink-mute">{t.ban}</span></Cell>
                        <Cell w={190}>
                          {edit ? (
                            <select className="h-7 w-full rounded border border-transparent bg-transparent text-[12px] hover:border-surface-line focus:border-brand" value={t.assigneeTitle ?? ""} disabled={busy === t.id} onClick={(e) => e.stopPropagation()} onChange={(e) => commit(t.id, { assigneeTitle: e.target.value })} aria-label="Chức danh chịu trách nhiệm">
                              <option value="">— Chưa gán —</option>
                              {[...new Set([...(t.assigneeTitle ? [t.assigneeTitle] : []), ...TITLES])].map((x) => <option key={x}>{x}</option>)}
                            </select>
                          ) : <span className="truncate text-[12px]" title={t.assigneeTitle}>{t.assigneeTitle ?? ""}</span>}
                        </Cell>
                      </>}
                      <Cell w={64} center>
                        {edit && t.status !== "closed" ? (
                          <input className="h-7 w-14 rounded border border-transparent bg-transparent text-center hover:border-surface-line focus:border-brand" type="number" min={1} defaultValue={t.durationDays} key={`${t.id}-${t.durationDays}`} disabled={busy === t.id} onClick={(e) => e.stopPropagation()} aria-label="Số ngày làm việc"
                            onBlur={(e) => { const v = Number(e.target.value); if (v && v !== t.durationDays) commit(t.id, { durationDays: v }); else e.target.value = String(t.durationDays); }}
                            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                        ) : <span>{t.kind === "milestone" ? "—" : t.durationDays}</span>}
                      </Cell>
                      <Cell w={78} center>{fmtDM(t.start)}<span className="text-[10px] text-ink-mute">/{t.start?.slice(2, 4)}</span></Cell>
                      <Cell w={78} center>{fmtDM(t.finish)}<span className="text-[10px] text-ink-mute">/{t.finish?.slice(2, 4)}</span></Cell>
                      <Cell w={118}>
                        {edit ? (
                          <select className={cn("h-7 w-full rounded px-1 text-[12px] font-medium", STATUS_TONE[t.status])} value={t.status} disabled={busy === t.id} onClick={(e) => e.stopPropagation()} onChange={(e) => commit(t.id, { status: e.target.value as TaskStatus })} aria-label="Trạng thái công việc">
                            {(Object.keys(TASK_STATUS_LABEL) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
                          </select>
                        ) : leaf ? <span className={cn("badge", STATUS_TONE[t.status])}>{TASK_STATUS_LABEL[t.status]}</span> : null}
                      </Cell>
                      {colsGrid && <Cell w={44} center>{t.conflict ? <AlertTriangle className="h-4 w-4 text-amber-500" aria-label={t.conflict}><title>{t.conflict}</title></AlertTriangle> : t.critical && leaf ? <Flame className="h-4 w-4 text-red-500"><title>Đường găng</title></Flame> : null}</Cell>}
                    </>}
                  </div>
                  {!colsGrid && (
                    <div className="relative shrink-0" style={{ width: geo.w }}>
                      <Bar t={t} x={x} ppd={ppd} pct={pct} w={geo.w} sel={sel} />
                    </div>
                  )}
                </div>
              );
            })}
            {!rows.length && <div className="absolute inset-0 flex items-center justify-center text-ink-mute" style={{ minHeight: 200 }}>Không có công việc phù hợp bộ lọc</div>}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-surface-line bg-white px-3 py-1 text-[11px] text-ink-mute">
        <div className="flex flex-wrap items-center gap-1.5">{extra}</div>
        <span>{rows.filter((r) => r.kind !== "summary").length} / {tasks.filter((r) => r.kind !== "summary").length} dòng</span>
        <Leg c="bg-blue-500" l="Đang thực hiện" /><Leg c="bg-brand" l="Hoàn thành" /><Leg c="bg-slate-300" l="Đóng / định kỳ" /><Leg c="bg-red-500" l="Viền đỏ = đường găng" /><Leg c="bg-amber-400" l="Mốc" />
      </div>
    </div>
  );
}

function Leg({ c, l }: { c: string; l: string }) { return <span className="flex items-center gap-1.5"><span className={cn("inline-block h-2.5 w-4 rounded-sm", c)} />{l}</span>; }

function Cell({ w, grow, center, children }: { w: number; grow?: boolean; center?: boolean; children?: React.ReactNode }) {
  return <div className={cn("flex shrink-0 items-center overflow-hidden px-2", center && "justify-center")} style={{ width: w }} data-grow={grow}>{children}</div>;
}

function Bar({ t, x, ppd, pct, w, sel }: { t: TaskNode; x: (d: string) => number; ppd: number; pct: number; w: number; sel: boolean }) {
  if (!t.start || !t.finish) return null;
  const left = x(t.start);
  const right = x(t.finish) + ppd;
  if (t.kind === "milestone") {
    return <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-amber-400 ring-1 ring-amber-600" style={{ left }} title={`${t.name}: ${t.start}`} />;
  }
  if (left > w) return null;
  const width = Math.max(3, Math.min(right, w) - left);
  const clipped = right > w;
  const tip = `${t.name}\n${t.start} → ${t.finish} (${t.durationDays} ngày LV)${t.status === "closed" ? "\nTrạng thái: Đóng" : ""}${pct ? `\nHoàn thành: ${pct}%` : ""}${t.critical ? "\nTHUỘC ĐƯỜNG GĂNG" : ""}${t.floatDays !== undefined && t.kind === "task" ? `\nDự phòng (float): ${t.floatDays} ngày LV` : ""}${t.conflict ? `\n⚠ ${t.conflict}` : ""}`;
  if (t.kind === "summary") {
    return (
      <div className="absolute top-1/2 -translate-y-1/2" style={{ left, width }} title={tip}>
        <div className={cn("h-2 rounded-sm", t.critical ? "bg-red-700" : "bg-slate-700")} />
        <div className="absolute -bottom-1 left-0 h-2 w-0.5 bg-slate-700" /><div className="absolute -bottom-1 right-0 h-2 w-0.5 bg-slate-700" />
      </div>
    );
  }
  if (t.kind === "periodic") {
    return <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded bg-slate-300" style={{ left, width, backgroundImage: "repeating-linear-gradient(90deg,#94a3b8 0 4px,transparent 4px 7px)" }} title={tip} />;
  }
  const base = t.status === "closed" ? "bg-slate-300" : t.status === "done" ? "bg-brand" : "bg-blue-500";
  return (
    <div className={cn("absolute top-1/2 h-[18px] -translate-y-1/2 overflow-hidden rounded-sm", base, t.critical && t.status !== "closed" && "ring-2 ring-red-500", sel && "ring-2 ring-ink", t.conflict && "outline outline-2 outline-amber-400")} style={{ left, width, backgroundImage: t.status === "closed" ? "repeating-linear-gradient(45deg,transparent 0 4px,rgba(255,255,255,.7) 4px 8px)" : undefined }} title={tip}>
      {pct > 0 && pct < 100 && t.status !== "done" && <div className="h-full bg-brand" style={{ width: `${pct}%` }} />}
      {clipped && <span className="absolute right-0 top-0 text-[10px] leading-[18px] text-white">▶</span>}
    </div>
  );
}
