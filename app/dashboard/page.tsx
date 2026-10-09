"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, FolderKanban, Layers, Trophy } from "lucide-react";
import { api, fmtDate } from "@/lib/client";
import { Badge, Card, Empty, Progress, Spinner, StatusBadge, Tabs, cn } from "@/components/ui";
import { PlanActualBars } from "@/components/charts";
import { PROJECT_TYPE_LABEL, type ProjectType } from "@/lib/types";

interface Row { label: string; plan: number; actual: number; total: number; done: number; late: number }
interface Dash {
  today: string;
  projects: { id: string; code: string; name: string }[];
  selected: { id: string; versionId: string; version: string; status: string; name: string; code: string };
  kpi: { mtlCount: number; approved: number; pending: number; draft: number; lateTasks: number };
  rows: { id: string; code: string; name: string; region: string; type: ProjectType; versionId: string; version: string; status: string; plan: number; actual: number; late: number; total: number; conflicts: number; finish?: string }[];
  metrics: { overall: Row; byBan: Row[]; copies: Row[]; byTitle: Row[]; risky: { id: string; wbs: string; name: string; ban?: string; title?: string; finish: string; percent: number; daysLeft: number }[]; openTasks: number; conflicts: number };
}

function Kpi({ icon, label, value, badge, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; badge?: React.ReactNode; sub: string; tone: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-bold uppercase tracking-wide text-ink-soft">{label}</div>
          <div className="mt-1 flex items-center gap-2 text-[28px] font-bold leading-none text-ink">{value}{badge}</div>
        </div>
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", tone)}>{icon}</div>
      </div>
      <div className="mt-2 text-ink-mute">{sub}</div>
    </Card>
  );
}

export default function Dashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [pid, setPid] = useState<string>("");
  const [tab, setTab] = useState<"overview" | "titles" | "list">("overview");
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Dash>(`/api/dashboard${pid ? `?projectId=${pid}` : ""}`).then((x) => { setD(x); if (!pid) setPid(x.selected.id); }).catch((e) => setErr(e.message));
  }, [pid]);
  if (err) return <Empty title="Không tải được Dashboard" hint={err} />;
  if (!d) return <Spinner />;
  const m = d.metrics;
  const delta = m.overall.actual - m.overall.plan;
  const groups: Row[] = m.copies.length ? m.copies : m.byBan.slice(0, 6);
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="flex items-center gap-2"><Badge tone="green" className="uppercase">Bảng điều hành tổng hợp MTL</Badge><span className="text-ink-mute">— Cập nhật {fmtDate(d.today)}</span></div>
          <h1 className="mt-1 text-[24px] font-bold">Tiến độ Master Timeline</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-72 font-medium" value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Chọn dự án">
            {d.projects.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
          </select>
          <StatusBadge status={d.selected.status} /><Badge>{d.selected.version}</Badge>
          <Link href={`/mtl/${d.selected.id}`} className="btn-primary">Mở Workspace</Link>
        </div>
      </Card>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "overview", label: <><BarChart3 className="h-4 w-4" /> Tổng quan</> },
        { key: "titles", label: <><Trophy className="h-4 w-4" /> Hiệu suất theo Chức danh</> },
        { key: "list", label: <><FolderKanban className="h-4 w-4" /> Danh sách MTL</> },
      ]} />

      {tab === "overview" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Số MTL" icon={<FolderKanban className="h-5 w-5 text-brand" />} tone="bg-green-50" value={d.kpi.mtlCount} badge={<Badge tone="green">{d.kpi.approved} đã duyệt</Badge>} sub={`${d.kpi.pending} đang trình · ${d.kpi.draft} đang soạn`} />
            <Kpi label="Công việc đang theo dõi" icon={<Layers className="h-5 w-5 text-blue-600" />} tone="bg-blue-50" value={<>{m.openTasks} / {m.overall.total}</>} sub="Chưa xong / Tất cả (không tính việc Đóng)" />
            <Kpi label="Tỷ lệ hoàn thành" icon={<CheckCircle2 className="h-5 w-5 text-brand" />} tone="bg-green-50" value={`${m.overall.actual}%`} badge={<Badge tone={delta >= -2 ? "green" : "red"}>{delta >= 0 ? "+" : ""}{delta}% so KH</Badge>} sub={`Kế hoạch đến hôm nay: ${m.overall.plan}% · ${m.overall.done} việc xong`} />
            <Kpi label="Cảnh báo trễ hạn" icon={<AlertTriangle className="h-5 w-5 text-red-500" />} tone="bg-red-50" value={m.overall.late} badge={<Badge tone={m.overall.late ? "red" : "green"}>{m.overall.late ? "Cần xử lý" : "Ổn"}</Badge>} sub={`Việc quá hạn chưa xong · ${m.conflicts} xung đột mốc`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="p-4 xl:col-span-2">
              <h2 className="text-[16px] font-semibold">Tiến độ Thực tế so với Kế hoạch</h2>
              <p className="mb-2 text-ink-mute">Trọng số = thời lượng công việc, theo Ban/Phòng chịu trách nhiệm (OC 9-4)</p>
              <PlanActualBars rows={m.byBan.slice(0, 10).map((r) => ({ label: r.label, plan: r.plan, actual: r.actual, sub: `${r.total} việc` }))} />
            </Card>
            <Card className="p-4">
              <h2 className="text-[16px] font-semibold">{m.copies.length ? "Tiến độ theo Phân khu / Tháp" : "Tiến độ theo Ban"}</h2>
              <p className="mb-3 text-ink-mute">{groups.length} nhóm</p>
              <div className="space-y-4">
                {groups.map((g) => (
                  <div key={g.label}>
                    <div className="mb-1 flex items-center justify-between"><span className="font-semibold">{g.label}</span><span className="font-bold">{g.actual}%</span></div>
                    <Progress value={g.actual} plan={g.plan} tone={g.actual >= g.plan - 2 ? "green" : "red"} />
                    <div className="mt-1 flex justify-between text-[12px] text-ink-mute"><span>Xong: {g.done}/{g.total}</span><span>Còn: {g.total - g.done}{g.late ? ` · trễ ${g.late}` : ""}</span></div>
                  </div>
                ))}
                {!groups.length && <Empty title="Chưa có dữ liệu tracking" hint="MTL phải được phê duyệt rồi cập nhật % tiến độ ở mục Theo dõi Dự án." />}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between p-4"><h2 className="text-[16px] font-semibold">Cảnh báo nguy cơ chậm tiến độ</h2><Link className="text-brand hover:underline" href="/tracking">Mở Theo dõi →</Link></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="th"><tr><th className="px-4 py-2">Tên công việc</th><th className="px-4 py-2">Ban & Chức danh</th><th className="px-4 py-2">Hạn</th><th className="px-4 py-2">% xong</th><th className="px-4 py-2">Còn lại</th></tr></thead>
                <tbody>
                  {m.risky.map((r) => (
                    <tr key={r.id} className="border-t border-surface-line">
                      <td className="px-4 py-2"><div className="font-medium">{r.name}</div><div className="text-[12px] text-ink-mute">WBS {r.wbs}</div></td>
                      <td className="px-4 py-2"><div>{r.ban ?? "—"}</div><div className="text-[12px] text-ink-mute">{r.title ?? "Chưa gán chức danh"}</div></td>
                      <td className="px-4 py-2">{fmtDate(r.finish)}</td>
                      <td className="px-4 py-2 w-40"><div className="flex items-center gap-2"><div className="w-24"><Progress value={r.percent} tone="blue" /></div>{r.percent}%</div></td>
                      <td className="px-4 py-2">{r.daysLeft < 0 ? <Badge tone="red">Quá hạn {-r.daysLeft} ngày</Badge> : <Badge tone={r.daysLeft < 7 ? "amber" : "slate"}>{r.daysLeft} ngày</Badge>}</td>
                    </tr>
                  ))}
                  {!m.risky.length && <tr><td colSpan={5}><Empty title="Không có công việc nguy cơ" hint="Các việc đang thực hiện đều trong hạn." /></td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "titles" && (
        <Card className="overflow-hidden">
          <div className="p-4"><h2 className="text-[16px] font-semibold">Hiệu suất theo Chức danh</h2><p className="text-ink-mute">Tổng hợp % hoàn thành phần việc được giao theo trọng số thời lượng (BRD 3.4)</p></div>
          <table className="w-full text-left">
            <thead className="th"><tr><th className="px-4 py-2">Chức danh</th><th className="px-4 py-2 text-right">Số việc</th><th className="px-4 py-2 text-right">Đã xong</th><th className="px-4 py-2 text-right">Trễ</th><th className="px-4 py-2 w-64">Thực tế / Kế hoạch</th></tr></thead>
            <tbody>
              {m.byTitle.map((r) => (
                <tr key={r.label} className="border-t border-surface-line">
                  <td className="px-4 py-2 font-medium">{r.label}</td>
                  <td className="px-4 py-2 text-right">{r.total}</td><td className="px-4 py-2 text-right">{r.done}</td>
                  <td className="px-4 py-2 text-right">{r.late ? <Badge tone="red">{r.late}</Badge> : <span className="text-ink-mute">0</span>}</td>
                  <td className="px-4 py-2"><div className="flex items-center gap-2"><div className="flex-1"><Progress value={r.actual} plan={r.plan} tone={r.actual >= r.plan - 2 ? "green" : "red"} /></div><span className="w-24 text-right text-[12px]"><b>{r.actual}%</b> / {r.plan}%</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "list" && (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead className="th"><tr><th className="px-4 py-2">Dự án</th><th className="px-4 py-2">Loại hình</th><th className="px-4 py-2">Phiên bản</th><th className="px-4 py-2">Trạng thái</th><th className="px-4 py-2">Kết thúc dự kiến</th><th className="px-4 py-2 w-56">Tiến độ</th></tr></thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className="border-t border-surface-line hover:bg-surface">
                  <td className="px-4 py-2"><Link href={`/mtl/${r.id}`} className="font-semibold text-brand hover:underline">{r.code} — {r.name}</Link><div className="text-[12px] text-ink-mute">{r.region}</div></td>
                  <td className="px-4 py-2">{PROJECT_TYPE_LABEL[r.type]}</td>
                  <td className="px-4 py-2">{r.version}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.status} />{r.conflicts > 0 && <Badge tone="red" className="ml-2">{r.conflicts} xung đột</Badge>}</td>
                  <td className="px-4 py-2">{fmtDate(r.finish)}</td>
                  <td className="px-4 py-2"><div className="flex items-center gap-2"><div className="flex-1"><Progress value={r.actual} plan={r.plan} /></div><span className="w-10 text-right font-semibold">{r.actual}%</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
