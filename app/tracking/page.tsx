"use client";
// Module Theo dõi & Tracking (BRD 3.4): % hoàn thành + minh chứng + trao đổi; tổng hợp & đánh giá theo chức danh.
import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Award, FileText, Image as ImageIcon, Loader2, MessageSquare, Paperclip, Search, Send, Star, Upload } from "lucide-react";
import { api, fmtDate, fmtSize, fmtTime } from "@/lib/client";
import { Badge, Card, Drawer, Empty, PageTitle, Progress, Spinner, StatusBadge, Tabs, useToast, cn } from "@/components/ui";
import { planPercent } from "@/lib/metrics";
import { ROLE_LABEL, type MtlVersion, type Project, type TaskNode, type TaskTracking } from "@/lib/types";

interface Row { label: string; plan: number; actual: number; total: number; done: number; late: number; onTime: number | null; quality: number | null }
interface VResp {
  version: MtlVersion; project: Project; today: string; tracking: TaskTracking[];
  metrics: { overall: Row; byTitle: Row[]; byBan: Row[] };
  perms: { track: boolean; comment: boolean };
  siblings: { id: string; label: string; status: string }[];
}
interface PItem { id: string; params: Project["params"]; baselineId: string; current: { label: string; status: string; start?: string; finish?: string; actual: number; plan: number; late: number; conflicts: number } }

function Inner() {
  const sp0 = useSearchParams();
  const [picked, setPicked] = useState<string>(sp0.get("v") ?? "");
  if (!picked) return <Catalog onOpen={setPicked} />;
  return <Detail key={picked} initial={picked} onBack={() => setPicked("")} />;
}

function Catalog({ onOpen }: { onOpen: (vid: string) => void }) {
  const [items, setItems] = useState<PItem[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { api<{ projects: PItem[] }>("/api/projects").then((r) => setItems(r.projects)); }, []);
  if (!items) return <Spinner />;
  const rows = items.filter((p) => !q || `${p.params.anchors.code} ${p.params.anchors.name} ${p.params.anchors.region}`.toLowerCase().includes(q.toLowerCase()));
  const th = "px-3 py-2";
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-2 lg:-mx-3 lg:-mb-3 lg:-mt-4 lg:h-[calc(100vh-76px)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold">Theo dõi tiến độ dự án — Danh mục MTL</h1>
        <div className="relative w-72"><Search className="absolute left-3 top-2 h-4 w-4 text-ink-mute" /><input className="input !h-8 pl-9 !text-[13px]" placeholder="Tìm mã, tên, vùng…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto" style={{ minHeight: 320 }}>
          <table className="w-full min-w-[1000px] text-left text-[13px]">
            <thead className="th sticky top-0 z-10"><tr><th className={th}>Dự án</th><th className={th}>Vùng</th><th className={th}>MTL đang theo dõi</th><th className={th}>Trạng thái</th><th className={th}>Thời gian</th><th className={cn(th, "w-48")}>Thực tế / Kế hoạch</th><th className={th}>Trễ hạn</th></tr></thead>
            <tbody>
              {rows.map((p) => { const c = p.current, a = p.params.anchors; return (
                <tr key={p.id} className="cursor-pointer border-t border-surface-line hover:bg-surface" onClick={() => onOpen(p.baselineId)}>
                  <td className={th}><span className="font-semibold text-brand">{a.code}</span> — {a.name}</td>
                  <td className={th}>{a.region}</td>
                  <td className={th}>{c.label}</td>
                  <td className={th}><StatusBadge status={c.status} /></td>
                  <td className={cn(th, "text-ink-soft")}>{fmtDate(c.start)} → {fmtDate(c.finish)}</td>
                  <td className={th}><Progress value={c.actual} plan={c.plan} /></td>
                  <td className={th}>{c.late ? <Badge tone="red">{c.late}</Badge> : <span className="text-ink-mute">0</span>}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-surface-line bg-white px-3 py-1.5 text-[12px] text-ink-mute">{rows.length} dự án</div>
      </Card>
    </div>
  );
}

function Detail({ initial, onBack }: { initial: string; onBack: () => void }) {
  const sp = useSearchParams();
  const toast = useToast();
  const [projects, setProjects] = useState<PItem[]>([]);
  const [vid, setVid] = useState<string>(initial);
  const [d, setD] = useState<VResp | null>(null);
  const [tab, setTab] = useState<"tasks" | "titles">("tasks");
  const [q, setQ] = useState("");
  const [ban, setBan] = useState("");
  const [flt, setFlt] = useState<"" | "late" | "open" | "done">("");
  const [sel, setSel] = useState<string | null>(sp.get("t"));
  const [w, setW] = useState({ c: 50, p: 30, q: 20 });

  const loadV = useCallback(async (id: string) => { setD(await api<VResp>(`/api/versions/${id}`)); }, []);
  useEffect(() => {
    api<{ projects: PItem[] }>("/api/projects").then((r) => {
      setProjects(r.projects);
    });
  }, []);
  useEffect(() => { if (vid) loadV(vid).catch((e) => toast(e.message, "err")); }, [vid, loadV, toast]);

  const tr = useMemo(() => new Map((d?.tracking ?? []).map((t) => [t.taskId.slice((d?.version.id.length ?? 0) + 1), t])), [d]);
  const tasks = useMemo(() => (d?.version.tasks ?? []).filter((t) => t.kind === "task" && t.status !== "closed"), [d]);
  const pct = (t: TaskNode) => (t.status === "done" ? 100 : tr.get(t.id)?.percent ?? 0);
  const today = d?.today ?? "";
  const rows = useMemo(() => tasks.filter((t) => {
    const p = pct(t);
    if (q && !`${t.name} ${t.wbs}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (ban && t.ban !== ban) return false;
    if (flt === "late" && !(p < 100 && t.finish! < today)) return false;
    if (flt === "open" && p >= 100) return false;
    if (flt === "done" && p < 100) return false;
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tasks, q, ban, flt, tr, today]);

  if (!projects.length || (vid && !d)) return <Spinner />;
  if (!d) return <Empty title="Chưa có MTL nào" />;
  const v = d.version;
  const canTrack = v.status === "approved";
  const bans = [...new Set(tasks.map((t) => t.ban).filter(Boolean))] as string[];
  const ov = d.metrics.overall;
  const score = (r: Row) => {
    const parts: [number, number][] = [[r.actual, w.c]];
    if (r.onTime !== null) parts.push([r.onTime, w.p]);
    if (r.quality !== null) parts.push([(r.quality / 5) * 100, w.q]);
    const tw = parts.reduce((m, x) => m + x[1], 0) || 1;
    return Math.round(parts.reduce((m, x) => m + x[0] * x[1], 0) / tw);
  };
  const grade = (sc: number): [string, "green" | "blue" | "amber" | "red"] => sc >= 90 ? ["Xuất sắc", "green"] : sc >= 75 ? ["Tốt", "blue"] : sc >= 60 ? ["Đạt", "amber"] : ["Cần cải thiện", "red"];
  const selTask = tasks.find((t) => t.id === sel) ?? null;

  const onTracked = (taskId: string, t: TaskTracking, status?: string) => {
    setD((cur) => {
      if (!cur) return cur;
      const key = `${cur.version.id}:${taskId}`;
      const list = cur.tracking.some((x) => x.taskId === key) ? cur.tracking.map((x) => (x.taskId === key ? t : x)) : [...cur.tracking, t];
      const ver = status ? { ...cur.version, tasks: cur.version.tasks.map((x) => (x.id === taskId ? { ...x, status: status as TaskNode["status"] } : x)) } : cur.version;
      return { ...cur, tracking: list, version: ver };
    });
    loadV(v.id).catch(() => {});
  };

  const delta = ov.actual - ov.plan;
  const chip = "inline-flex items-center gap-1 rounded bg-surface-head px-2 py-1 text-[12px] font-medium text-ink-soft";
  const chips = (
    <>
      <span className={chip} title="Hoàn thành thực tế (trọng số theo thời lượng)"><b>{ov.actual}%</b> thực tế</span>
      <span className={cn(chip, delta >= -2 ? "!bg-green-50 !text-green-700" : "!bg-red-50 !text-red-700")} title="Kế hoạch đến hôm nay và chênh lệch so với thực tế">Kế hoạch {ov.plan}% ({delta >= 0 ? "+" : ""}{delta}%)</span>
      <span className={chip} title="Công việc đã xong / tổng (không tính việc Đóng)"><b>{ov.done}</b>/{ov.total} xong · {ov.total - ov.done} còn mở</span>
      <span className={cn(chip, ov.late ? "!bg-red-50 !text-red-700" : "!bg-green-50 !text-green-700")} title="Việc quá hạn mà % chưa đạt 100">Trễ hạn <b>{ov.late}</b></span>
    </>
  );
  const curProjectId = projects.find((p) => p.baselineId === v.id || d.siblings.some((s2) => s2.id === p.baselineId) && p.id === v.projectId)?.id ?? v.projectId;

  return (
    <div className={cn("mx-auto flex max-w-[1800px] flex-col gap-2 lg:-mx-3 lg:-mb-3 lg:-mt-4", tab === "tasks" && "lg:h-[calc(100vh-76px)]")}>
      {/* ===== Một hàng duy nhất: tiêu đề · tab · dự án ===== */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:flex-nowrap">
        <button className="btn-ghost !h-8 !px-2 !text-[13px]" onClick={onBack}>← Danh mục</button>
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold" title="Theo dõi tiến độ dự án">Theo dõi tiến độ</h1>
        <div className="shrink-0 [&>div]:border-b-0 [&_button]:!px-2.5 [&_button]:!py-1.5">
          <Tabs value={tab} onChange={setTab} tabs={[
            { key: "tasks", label: <><Paperclip className="h-4 w-4" /> Công việc</> },
            { key: "titles", label: <><Award className="h-4 w-4" /> Đánh giá chức danh</> },
          ]} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <select className="input !h-8 w-56 !text-[13px] font-medium" value={curProjectId} onChange={(e) => setVid(projects.find((p) => p.id === e.target.value)!.baselineId)} aria-label="Dự án">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.params.anchors.code} — {p.params.anchors.name}</option>)}
          </select>
          <StatusBadge status={v.status} /><Badge>{v.label}</Badge>
          <Link href={`/mtl/${v.projectId}?v=${v.id}`} className="btn-ghost !h-8 !px-2.5 !text-[13px]">Mở MTL</Link>
        </div>
      </div>

      {!canTrack && <div className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-[12px] text-amber-900">MTL này chưa ở trạng thái <b>Đã duyệt</b> nên chưa thể cập nhật tracking (BRD: sau khi MTL được phê duyệt mới tracking). Bạn vẫn xem được dữ liệu.</div>}
      {tab !== "tasks" && <div className="flex flex-wrap items-center gap-1.5">{chips}</div>}

      {tab === "tasks" && (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5 border-b border-surface-line p-2">
            <div className="relative w-64"><Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" /><input className="input pl-9" placeholder="Tìm công việc…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select className="input w-40" value={ban} onChange={(e) => setBan(e.target.value)} aria-label="Ban"><option value="">Tất cả Ban</option>{bans.sort().map((b) => <option key={b}>{b}</option>)}</select>
            <select className="input w-44" value={flt} onChange={(e) => setFlt(e.target.value as typeof flt)} aria-label="Bộ lọc"><option value="">Tất cả</option><option value="late">Trễ hạn</option><option value="open">Chưa xong</option><option value="done">Đã xong</option></select>
          </div>
          <div className="min-h-0 flex-1 overflow-auto max-lg:max-h-[75vh]" style={{ minHeight: 320 }}>
            <table className="w-full min-w-[900px] text-left">
              <thead className="th sticky top-0 z-10"><tr><th className="px-3 py-2">Công việc</th><th className="px-3 py-2">Chức danh</th><th className="px-3 py-2">Hạn</th><th className="w-52 px-3 py-2">% hoàn thành</th><th className="px-3 py-2">Minh chứng</th><th className="px-3 py-2">Trạng thái</th></tr></thead>
              <tbody>
                {rows.slice(0, 400).map((t) => {
                  const p = pct(t); const rec = tr.get(t.id); const late = p < 100 && t.finish! < today;
                  return (
                    <tr key={t.id} onClick={() => setSel(t.id)} className={cn("cursor-pointer border-t border-surface-line hover:bg-surface", t.id === sel && "bg-blue-50")}>
                      <td className="px-3 py-2"><div className="font-medium">{t.name}</div><div className="text-[12px] text-ink-mute">WBS {t.wbs} · {t.ban}</div></td>
                      <td className="px-3 py-2 text-[13px]">{t.assigneeTitle ?? <span className="text-ink-mute">Chưa gán</span>}</td>
                      <td className="px-3 py-2">{fmtDate(t.finish)}</td>
                      <td className="px-3 py-2"><div className="flex items-center gap-2"><div className="w-28"><Progress value={p} plan={planPercent(t, today)} tone={late ? "red" : "green"} /></div><b>{p}%</b></div></td>
                      <td className="px-3 py-2 text-ink-mute">{rec?.evidence.length ? <span className="flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{rec.evidence.length}</span> : "—"}{rec?.comments.length ? <span className="ml-3 inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{rec.comments.length}</span> : null}</td>
                      <td className="px-3 py-2">{p >= 100 ? <Badge tone="green">Hoàn thành</Badge> : late ? <Badge tone="red">Trễ hạn</Badge> : p > 0 ? <Badge tone="blue">Đang thực hiện</Badge> : <Badge>Chưa bắt đầu</Badge>}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={6}><Empty title="Không có công việc phù hợp" /></td></tr>}
              </tbody>
            </table>
            {rows.length > 400 && <div className="p-3 text-center text-ink-mute">Hiển thị 400 / {rows.length} — hãy dùng bộ lọc để thu hẹp</div>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-surface-line bg-white px-3 py-1.5">{chips}<span className="ml-auto text-[11px] text-ink-mute">{rows.length} công việc đang hiển thị</span></div>
        </Card>
      )}

      {tab === "titles" && (
        <Card className="overflow-hidden">
          <div className="grid gap-4 border-b border-surface-line p-4 lg:grid-cols-[1fr_auto]">
            <div><h2 className="text-[16px] font-semibold">Đánh giá hiệu quả theo chức danh</h2><p className="text-ink-mute">Điểm tổng hợp = mức độ hoàn thành (theo trọng số thời lượng) + tính đúng hạn + chất lượng kết quả. Điều chỉnh trọng số phù hợp từng chức danh.</p></div>
            <div className="grid grid-cols-3 gap-3">
              {([["c", "Hoàn thành"], ["p", "Đúng hạn"], ["q", "Chất lượng"]] as const).map(([k, l]) => (
                <label key={k} className="text-[12px] font-semibold text-ink-head">{l}: {w[k]}%<input type="range" min={0} max={100} step={5} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })} className="w-28 accent-[#2DB34B]" /></label>
              ))}
            </div>
          </div>
          <table className="w-full text-left">
            <thead className="th"><tr><th className="px-4 py-2">Hạng</th><th className="px-4 py-2">Chức danh</th><th className="px-4 py-2 text-right">Số việc</th><th className="px-4 py-2 text-right">Hoàn thành</th><th className="px-4 py-2 text-right">Đúng hạn</th><th className="px-4 py-2 text-right">Chất lượng</th><th className="px-4 py-2 text-right">Trễ</th><th className="px-4 py-2 text-right">Điểm</th><th className="px-4 py-2">Xếp loại</th></tr></thead>
            <tbody>
              {[...d.metrics.byTitle].sort((a, b) => score(b) - score(a)).map((r, i) => { const sc = score(r); const [g, tone] = grade(sc); return (
                <tr key={r.label} className="border-t border-surface-line">
                  <td className="px-4 py-2 font-bold">{i + 1}</td><td className="px-4 py-2 font-medium">{r.label}</td>
                  <td className="px-4 py-2 text-right">{r.total}</td><td className="px-4 py-2 text-right">{r.actual}%</td>
                  <td className="px-4 py-2 text-right">{r.onTime === null ? "—" : `${r.onTime}%`}</td><td className="px-4 py-2 text-right">{r.quality === null ? "—" : <span className="inline-flex items-center gap-1">{r.quality}<Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /></span>}</td>
                  <td className="px-4 py-2 text-right">{r.late ? <Badge tone="red">{r.late}</Badge> : 0}</td>
                  <td className="px-4 py-2 text-right text-[16px] font-bold">{sc}</td><td className="px-4 py-2"><Badge tone={tone}>{g}</Badge></td>
                </tr>); })}
              {!d.metrics.byTitle.length && <tr><td colSpan={9}><Empty title="Chưa gán chức danh cho công việc nào" /></td></tr>}
            </tbody>
          </table>
          <p className="border-t border-surface-line p-3 text-[12px] text-ink-mute">“—” nghĩa là chưa có dữ liệu (chưa việc nào xong / chưa được chấm chất lượng) — điểm tổng hợp tự bỏ qua tiêu chí đó. Ngưỡng xếp loại (90/75/60) là giả định demo, cần PMO xác nhận.</p>
        </Card>
      )}

      <TrackDrawer task={selTask} onClose={() => setSel(null)} d={d} rec={selTask ? tr.get(selTask.id) : undefined} pct={selTask ? pct(selTask) : 0} canTrack={canTrack && d.perms.track} canComment={d.perms.comment} onChange={onTracked} />
    </div>
  );
}

export default function TrackingPage() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}

function TrackDrawer({ task, onClose, d, rec, pct, canTrack, canComment, onChange }: { task: TaskNode | null; onClose: () => void; d: VResp; rec?: TaskTracking; pct: number; canTrack: boolean; canComment: boolean; onChange: (taskId: string, t: TaskTracking, status?: string) => void }) {
  const toast = useToast();
  const [val, setVal] = useState(pct);
  const [issue, setIssue] = useState(rec?.issue ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { setVal(pct); setIssue(rec?.issue ?? ""); setText(""); }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!task) return null;
  const base = `/api/tracking/${d.version.id}/${encodeURIComponent(task.id)}`;
  const cur: TaskTracking = rec ?? { taskId: `${d.version.id}:${task.id}`, percent: 0, evidence: [], comments: [] };

  const save = async (body: { percent?: number; issue?: string; quality?: number | null }) => {
    setBusy("save");
    try { const r = await api<{ tracking: TaskTracking; status: string }>(base, { method: "POST", json: body }); onChange(task.id, r.tracking, r.status); toast("Đã cập nhật tracking"); }
    catch (e) { toast((e as Error).message, "err"); }
    finally { setBusy(""); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy("up");
    try {
      let last: TaskTracking = cur;
      for (const f of Array.from(files)) {
        const fd = new FormData(); fd.append("file", f);
        const r = await api<{ evidence: TaskTracking["evidence"][number] }>(`${base}/evidence`, { method: "POST", body: fd });
        last = { ...last, evidence: [...last.evidence, r.evidence] };
      }
      onChange(task.id, last); toast(`Đã đính kèm ${files.length} minh chứng`);
    } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); if (file.current) file.current.value = ""; }
  };
  const send = async () => {
    if (!text.trim()) return;
    setBusy("cm");
    try { const r = await api<{ comment: TaskTracking["comments"][number] }>(`${base}/comments`, { method: "POST", json: { text } }); onChange(task.id, { ...cur, comments: [...cur.comments, r.comment] }); setText(""); }
    catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };

  return (
    <Drawer open onClose={onClose} width="w-[520px]" title={<><div className="font-mono text-[12px] text-ink-mute">WBS {task.wbs} · {task.ban}</div><div className="text-[16px] font-semibold leading-snug">{task.name}</div><div className="text-[12px] text-ink-mute">{task.assigneeTitle ?? "Chưa gán chức danh"} · {fmtDate(task.start)} → {fmtDate(task.finish)}</div></>}>
      <div className="space-y-5 p-4">
        <section>
          <h3 className="mb-2 font-semibold">% hoàn thành</h3>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={100} step={5} value={val} disabled={!canTrack} onChange={(e) => setVal(Number(e.target.value))} className="flex-1 accent-[#2DB34B]" aria-label="Phần trăm hoàn thành" />
            <input type="number" min={0} max={100} className="input w-20 text-center" value={val} disabled={!canTrack} onChange={(e) => setVal(Math.max(0, Math.min(100, Number(e.target.value))))} />
          </div>
          <Progress value={val} plan={planPercent(task, d.today)} />
          <div className="mt-1 text-[12px] text-ink-mute">Vạch đen = kế hoạch đến hôm nay ({planPercent(task, d.today)}%). Hoàn thành 100% bắt buộc có ít nhất 1 minh chứng.</div>
          <textarea className="input mt-3 h-20 py-2" placeholder="Nguyên nhân / vướng mắc (nếu có)" value={issue} disabled={!canTrack} onChange={(e) => setIssue(e.target.value)} />
          {canTrack && <button className="btn-primary mt-2" disabled={busy === "save"} onClick={() => save({ percent: val, issue })}>{busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />} Cập nhật tiến độ</button>}
          {!canTrack && <div className="mt-2 text-[12px] text-amber-700">Bạn không có quyền cập nhật % (hoặc MTL chưa được duyệt).</div>}
          {cur.updatedAt && <div className="mt-2 text-[12px] text-ink-mute">Cập nhật gần nhất: {fmtTime(cur.updatedAt)} · {cur.updatedBy}</div>}
        </section>

        {cur.percent >= 100 && (
          <section>
            <h3 className="mb-2 font-semibold">Đánh giá chất lượng kết quả</h3>
            <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button key={n} disabled={!canTrack} onClick={() => save({ quality: cur.quality === n ? null : n })} aria-label={`${n} sao`}><Star className={cn("h-6 w-6", (cur.quality ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-slate-300")} /></button>)}</div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Minh chứng hoàn thành ({cur.evidence.length})</h3>
            {canTrack && <><input ref={file} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={(e) => upload(e.target.files)} /><button className="btn-ghost" disabled={busy === "up"} onClick={() => file.current?.click()}>{busy === "up" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Tải lên</button></>}</div>
          {!cur.evidence.length && <div className="rounded border border-dashed border-surface-line p-4 text-center text-ink-mute">Chưa có minh chứng (hình ảnh, file). Tối đa 8MB mỗi tệp.</div>}
          <div className="grid grid-cols-2 gap-2">
            {cur.evidence.map((e) => (
              <a key={e.id} href={e.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded border border-surface-line hover:border-brand">
                {e.mime.startsWith("image/") ? <img src={e.url} alt={e.name} className="h-28 w-full object-cover" /> : <div className="flex h-28 items-center justify-center bg-surface"><FileText className="h-8 w-8 text-ink-mute" /></div>}
                <div className="p-2"><div className="flex items-center gap-1 truncate text-[12px] font-medium">{e.mime.startsWith("image/") ? <ImageIcon className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}<span className="truncate">{e.name}</span></div><div className="text-[11px] text-ink-mute">{fmtSize(e.size)} · {e.by}</div></div>
              </a>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Trao đổi công việc ({cur.comments.length})</h3>
          <div className="space-y-2">
            {cur.comments.map((c) => (
              <div key={c.id} className="rounded bg-surface p-3"><div className="mb-1 flex items-center justify-between"><span className="font-semibold">{c.by} <Badge tone="slate" className="ml-1">{ROLE_LABEL[c.role]}</Badge></span><span className="text-[11px] text-ink-mute">{fmtTime(c.at)}</span></div><div className="whitespace-pre-wrap">{c.text}</div></div>
            ))}
            {!cur.comments.length && <div className="text-ink-mute">Chưa có trao đổi nào.</div>}
          </div>
          {canComment && (
            <div className="mt-3 flex gap-2"><textarea className="input h-16 flex-1 py-2" placeholder="Nhập nội dung trao đổi…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }} /><button className="btn-primary self-end" disabled={busy === "cm" || !text.trim()} onClick={send} aria-label="Gửi"><Send className="h-4 w-4" /></button></div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
