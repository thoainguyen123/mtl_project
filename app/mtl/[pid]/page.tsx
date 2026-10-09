"use client";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileText, GitBranch, Loader2, Printer, RefreshCw, Save, Send, Settings2, Undo2, XCircle } from "lucide-react";
import { api, ApiError, fmtDate, fmtTime } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Drawer, Empty, Field, Modal, Progress, Spinner, StatusBadge, Tabs, useToast, cn } from "@/components/ui";
import { WbsGantt } from "@/components/WbsGantt";
import { HANG_MUC_LABEL, PROJECT_TYPE_LABEL, TASK_STATUS_LABEL, type DurationConfig, type GenerationReport, type HangMuc, type MtlVersion, type Project, type ProjectParameters, type TaskNode, type TaskStatus, type TaskTracking } from "@/lib/types";

interface VersionResp {
  version: MtlVersion; project: Project; today: string; tracking: TaskTracking[]; config: DurationConfig;
  siblings: (Omit<MtlVersion, "tasks"> & { taskCount: number })[];
  perms: { inScope: boolean; edit: boolean; generate: boolean; newRev: boolean; submit: boolean; approve: boolean; export: boolean; track: boolean; comment: boolean };
}
type TabKey = "wbs" | "approval" | "report" | "params";

export default function Workspace() {
  const { pid } = useParams<{ pid: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { user } = useMe();
  const [data, setData] = useState<VersionResp | null>(null);
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [tab, setTab] = useState<TabKey>("wbs");
  const [sel, setSel] = useState<TaskNode | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [showRegen, setShowRegen] = useState(false);
  const [showReport, setShowReport] = useState(sp.get("report") === "1");
  const [warnTick, setWarnTick] = useState(0);

  const load = useCallback(async (vid?: string) => {
    try {
      const p = await api<{ project: Project }>(`/api/projects/${pid}`);
      const id = vid ?? sp.get("v") ?? p.project.currentVersionId;
      const d = await api<VersionResp>(`/api/versions/${id}`);
      setData(d);
      setTasks(d.version.tasks);
    } catch (e) { setErr((e as Error).message); }
  }, [pid, sp]);
  useEffect(() => { load(); }, [load, user.id]);

  const percents = useMemo(() => {
    const m = new Map<string, number>();
    if (data) for (const t of data.tracking) m.set(t.taskId.slice(data.version.id.length + 1), t.percent);
    return m;
  }, [data]);

  if (err) return <Empty title="Không mở được MTL" hint={err}><Link href="/mtl" className="btn-primary">Về danh sách</Link></Empty>;
  if (!data) return <Spinner />;
  const { version: v, project, perms } = data;
  const A = project.params.anchors;
  const conflicts = tasks.filter((t) => t.conflict);
  const unassigned = tasks.filter((t) => t.kind === "task" && t.status !== "closed" && !t.assigneeTitle).length;
  const closed = tasks.filter((t) => t.status === "closed").length;

  const patch = async (id: string, body: { status?: TaskStatus; assigneeTitle?: string; durationDays?: number }) => {
    try {
      const r = await api<{ task: TaskNode; tasks?: TaskNode[]; warnings: string[] }>(`/api/versions/${v.id}/tasks/${encodeURIComponent(id)}`, { method: "PATCH", json: body });
      if (r.tasks) setTasks([...r.tasks]);
      else setTasks((ts) => ts.map((t) => (t.id === id ? r.task : t)));
      setSel((s) => (s?.id === id ? r.task : s));
      if (r.warnings?.length) toast(r.warnings[0], "warn");
      else if (body.durationDays !== undefined) toast("Đã tính lại toàn bộ tiến độ theo thời lượng mới");
    } catch (e) { toast((e as Error).message, "err"); }
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const r = await api<{ versionId?: string; label?: string }>(`/api/versions/${v.id}/action`, { method: "POST", json: { action, ...extra } });
      if (r.versionId) { toast("Đã tạo REV mới (bản thảo)"); router.push(`/mtl/${pid}?v=${r.versionId}`); await load(r.versionId); }
      else { toast(action === "submit" ? "Đã trình E-Approval (mô phỏng)" : action === "approve" ? `Đã phê duyệt: ${r.label}` : action === "reject" ? "Đã trả về soạn thảo" : "Đã hủy bản"); await load(v.id); }
    } catch (e) {
      if (e instanceof ApiError && (e.data as { needForce?: boolean })?.needForce) {
        if (confirm(`${e.message}\n\nVẫn trình kèm cảnh báo?`)) await act(action, { force: true });
      } else toast((e as Error).message, "err");
    } finally { setBusy(""); }
  };

  const critical = tasks.filter((t) => t.critical && t.kind === "task").length;
  const nTasks = tasks.filter((t) => t.kind === "task").length;
  const btn = "btn-ghost !h-8 !px-2.5 !text-[13px]";
  const closeMenu = (e: React.MouseEvent) => e.currentTarget.closest("details")?.removeAttribute("open");
  const chip = "inline-flex items-center gap-1 rounded bg-surface-head px-2 py-1 text-[12px] font-medium text-ink-soft";

  return (
    <div className={cn("mx-auto flex max-w-[1800px] flex-col gap-2 lg:-mx-3 lg:-mb-3 lg:-mt-4", tab === "wbs" && "lg:h-[calc(100vh-76px)]")}>
      {/* ===== Một hàng duy nhất: dự án · tab · phiên bản + xuất ===== */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:flex-nowrap">
        <div className="flex min-w-0 items-center gap-2 lg:flex-1">
          <Badge tone="green" className="shrink-0 font-bold">{A.code}</Badge>
          <h1 className="min-w-0 truncate text-[15px] font-bold" title={`${A.name} · ${PROJECT_TYPE_LABEL[A.type]} · ${A.region}`}>{A.name}</h1>
          <button className="shrink-0" onClick={() => setTab("approval")} title="Xem chu trình phê duyệt"><StatusBadge status={v.status} /></button>
        </div>
        <div className="shrink-0 [&>div]:border-b-0 [&_button]:!px-2.5 [&_button]:!py-1.5">
          <Tabs<TabKey> value={tab} onChange={setTab} tabs={[
            { key: "wbs", label: "Lưới & Gantt" },
            { key: "approval", label: <>Trình phê duyệt {v.status === "approval_pending" && <span className="h-2 w-2 rounded-full bg-blue-500" title="Đang chờ phê duyệt" />}{v.status === "approved" && <CheckCircle2 className="h-3.5 w-3.5 text-brand" />}</> },
            { key: "report", label: "Báo cáo" },
            { key: "params", label: <><Settings2 className="h-4 w-4" /> Tham số</> },
          ]} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <select className="input !h-8 w-40 !text-[13px] font-medium" value={v.id} onChange={(e) => { router.push(`/mtl/${pid}?v=${e.target.value}`); load(e.target.value); }} aria-label="Phiên bản">
            {data.siblings.map((s2) => <option key={s2.id} value={s2.id}>{s2.label}</option>)}
          </select>
          {perms.export && (
            <details className="relative">
              <summary className={cn(btn, "cursor-pointer list-none")} title="Xuất MS Project XML / Excel / Tờ trình" aria-label="Xuất dữ liệu"><Download className="h-4 w-4" /><ChevronDown className="h-3.5 w-3.5" /></summary>
              <div className="card absolute right-0 z-40 mt-1 w-52 p-1 shadow-lg">
                <a className="flex items-center gap-2 rounded px-3 py-2 hover:bg-surface-head" href={`/api/versions/${v.id}/export?format=xml`} download onClick={closeMenu}><Download className="h-4 w-4" /> MS Project XML</a>
                <a className="flex items-center gap-2 rounded px-3 py-2 hover:bg-surface-head" href={`/api/versions/${v.id}/export?format=xlsx`} download onClick={closeMenu}><Download className="h-4 w-4" /> Excel (form Tập đoàn)</a>
                <Link className="flex items-center gap-2 rounded px-3 py-2 hover:bg-surface-head" href={`/mtl/${pid}/to-trinh?v=${v.id}`} target="_blank" onClick={closeMenu}><Printer className="h-4 w-4" /> Tờ trình / PDF</Link>
              </div>
            </details>
          )}
        </div>
      </div>

      {!perms.inScope && <div className="rounded border border-amber-300 bg-amber-50 px-3 py-1 text-[12px] text-amber-800">Dự án nằm ngoài phạm vi quản trị của bạn — chế độ chỉ xem.</div>}

      {tab === "wbs" && (
        <WbsGantt tasks={tasks} today={data.today} canEdit={perms.edit} percents={percents} selectedId={sel?.id} onSelect={setSel} onPatch={patch} warnTick={warnTick}
          extra={<>
            <span className={chip} title="Số công việc (không tính nhóm / mốc)"><b>{nTasks}</b> việc{closed ? ` · ${closed} đóng` : ""}</span>
            <span className={chip} title="Khoảng thời gian thực hiện (không tính việc định kỳ và vận hành sau bàn giao)">{fmtDate(v.generation?.projectStart)} → {fmtDate(v.generation?.projectFinish)}</span>
            <span className={cn(chip, "!bg-red-50 !text-red-700")} title="Việc thuộc đường găng (float nhỏ nhất)">Găng <b>{critical}</b></span>
            {conflicts.length > 0
              ? <button className={cn(chip, "!bg-amber-100 !text-amber-800 hover:!bg-amber-200")} onClick={() => setWarnTick((n) => n + 1)} title={`${conflicts[0].name}: ${conflicts[0].conflict}`}><AlertTriangle className="h-3.5 w-3.5" /> <b>{conflicts.length}</b> cảnh báo mốc — xem</button>
              : <span className={cn(chip, "!bg-green-50 !text-green-700")}>Không xung đột mốc</span>}
            {unassigned > 0 && <span className={cn(chip, "!bg-amber-50 !text-amber-700")} title="Việc đang mở chưa gán chức danh">{unassigned} chưa gán chức danh</span>}
          </>} />
      )}

      {tab === "report" && <ReportTab report={v.generation} />}
      {tab === "approval" && (
        <div className="mx-auto w-full max-w-[1100px] space-y-4">
          <ApprovalActions v={v} perms={perms} pid={pid} conflicts={conflicts.length} unassigned={unassigned} closed={closed} busy={busy} act={act} onTrack={() => router.push(`/tracking?v=${v.id}`)} />
          <VersionsTab data={data} onOpen={(id) => { router.push(`/mtl/${pid}?v=${id}`); load(id); setTab("wbs"); }} />
        </div>
      )}
      {tab === "params" && <ParamsTab params={project.params} canRegen={perms.generate} onRegen={() => setShowRegen(true)} />}

      <TaskDrawer task={sel} tasks={tasks} onClose={() => setSel(null)} percent={sel ? percents.get(sel.id) : undefined} versionId={v.id} canTrack={v.status === "approved"} />
      <RegenModal open={showRegen} onClose={() => setShowRegen(false)} project={project} onDone={async (r) => { setShowRegen(false); toast(`Đã sinh lại: ${r.included} dòng`); await load(v.id); }} />
      <Modal open={showReport && !!v.generation} onClose={() => setShowReport(false)} title="Động cơ đã tự sinh tiến độ" width="max-w-3xl" footer={<button className="btn-primary" onClick={() => setShowReport(false)}>Xem lưới WBS</button>}>
        <ReportTab report={v.generation} compact />
      </Modal>
    </div>
  );
}

function Mini({ label, value, sub, tone, small }: { label: string; value: React.ReactNode; sub: string; tone?: "red" | "amber" | "green"; small?: boolean }) {
  return (
    <Card className="p-3">
      <div className="text-[12px] font-bold uppercase text-ink-head">{label}</div>
      <div className={cn("font-bold", small ? "text-[15px] leading-7" : "text-[24px]", tone === "red" && "text-red-600", tone === "amber" && "text-amber-600", tone === "green" && "text-brand")}>{value}</div>
      <div className="text-[12px] text-ink-mute">{sub}</div>
    </Card>
  );
}

function ReportTab({ report, compact }: { report?: GenerationReport; compact?: boolean }) {
  if (!report) return <Empty title="Chưa có báo cáo sinh tự động" />;
  const Stat = ({ l, v, t }: { l: string; v: number | string; t?: string }) => <div className="rounded border border-surface-line p-3"><div className="text-[12px] text-ink-mute">{l}</div><div className={cn("text-[22px] font-bold", t)}>{v}</div></div>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat l="Task trong template chuẩn" v={report.templateTasks} />
        <Stat l="Giữ lại sau khi lọc" v={report.included} t="text-brand" />
        <Stat l="Loại bỏ theo quy tắc" v={report.removed} t="text-red-600" />
        <Stat l="Tạo thêm do nhân bản" v={report.duplicated} t="text-blue-600" />
      </div>
      <Card className="overflow-hidden">
        <div className="th px-4 py-2">1. Cơ chế lọc task — vì sao bị loại</div>
        <table className="w-full text-left"><tbody>
          {report.removedByRule.map((r) => <tr key={r.rule} className="border-t border-surface-line"><td className="px-4 py-2">{r.rule}</td><td className="w-24 px-4 py-2 text-right font-semibold">{r.count}</td></tr>)}
          {!report.removedByRule.length && <tr><td className="px-4 py-3 text-ink-mute">Không có</td></tr>}
        </tbody></table>
      </Card>
      <Card className="overflow-hidden">
        <div className="th px-4 py-2">2. Cơ chế nhân bản cấu trúc</div>
        <table className="w-full text-left"><tbody>
          {report.duplications.map((r) => <tr key={r.rule} className="border-t border-surface-line"><td className="px-4 py-2">{r.rule}</td><td className="w-32 px-4 py-2 text-right text-ink-mute">{r.copies} bản</td><td className="w-28 px-4 py-2 text-right font-semibold">+{r.addedTasks} dòng</td></tr>)}
          {!report.duplications.length && <tr><td className="px-4 py-3 text-ink-mute">Dự án không có tháp/phân kỳ cần nhân bản</td></tr>}
        </tbody></table>
      </Card>
      {report.warnings.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 p-3"><div className="mb-1 font-semibold text-amber-900">Lưu ý & cảnh báo</div><ul className="list-inside list-disc text-[13px] text-amber-900">{report.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Card>
      )}
      {!compact && <p className="text-[12px] text-ink-mute">Sinh lúc {fmtTime(report.generatedAt)} · {report.criticalCount} việc thuộc đường găng · {fmtDate(report.projectStart)} → {fmtDate(report.projectFinish)}</p>}
    </div>
  );
}

function ApprovalActions({ v, perms, pid, conflicts, unassigned, closed, busy, act, onTrack }: {
  v: MtlVersion; perms: VersionResp["perms"]; pid: string; conflicts: number; unassigned: number; closed: number; busy: string;
  act: (action: string, extra?: Record<string, unknown>) => Promise<void>; onTrack: () => void;
}) {
  const item = (ok: boolean, text: string) => <li className="flex items-start gap-2">{ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}<span>{text}</span></li>;
  if (v.status === "draft") {
    return (
      <Card className="p-5">
        <h2 className="text-[16px] font-semibold">Trình phê duyệt (E-Approval — mô phỏng)</h2>
        <p className="mb-3 text-ink-mute">Soạn thảo xong trên lưới thì trình ký tại đây. Hệ thống kết xuất Tờ trình + file PDF MTL, gửi sang E-Approval; sau khi trình, bản thảo bị khóa.</p>
        <ul className="space-y-2">
          {item(conflicts === 0, conflicts === 0 ? "Không có xung đột ràng buộc mốc" : `${conflicts} công việc/mốc đang xung đột ràng buộc mốc (cần xác nhận mới trình được)`)}
          {item(unassigned === 0, unassigned === 0 ? "Mọi công việc đang mở đã gán chức danh" : `${unassigned} công việc chưa gán chức danh (không chặn trình)`)}
          {item(true, `${closed} công việc ở trạng thái Đóng sẽ không tính vào tiến độ`)}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {perms.submit
            ? <button className="btn-primary" disabled={!!busy} onClick={() => act("submit")}>{busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Trình E-Approval</button>
            : <span className="text-amber-700">Vai trò hiện tại không có quyền trình phê duyệt.</span>}
          <Link href={`/mtl/${pid}/to-trinh?v=${v.id}`} target="_blank" className="inline-flex items-center gap-2 text-brand hover:underline"><FileText className="h-4 w-4" /> Xem trước Tờ trình</Link>
        </div>
      </Card>
    );
  }
  if (v.status === "approval_pending") {
    return (
      <Card className="border-blue-300 bg-blue-50 p-5">
        <h2 className="text-[16px] font-semibold text-blue-900">Đang chờ phê duyệt — {v.approval?.ticket}</h2>
        <p className="mb-3 text-blue-900/80">Bản thảo đang bị khóa trong thời gian trình ký. Prototype mô phỏng kết quả trả về từ E-Approval:</p>
        {perms.approve ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!busy} onClick={() => act("approve")}>{busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} BOD phê duyệt (mô phỏng)</button>
            <button className="btn-ghost" disabled={!!busy} onClick={() => act("reject", { note: "E-Approval trả về để chỉnh sửa" })}><Undo2 className="h-4 w-4" /> Trả về để chỉnh sửa</button>
          </div>
        ) : <span className="text-blue-900/80">Vai trò hiện tại không có quyền phê duyệt.</span>}
      </Card>
    );
  }
  if (v.status === "approved") {
    return (
      <Card className="border-green-300 bg-green-50 p-5">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-green-900"><CheckCircle2 className="h-5 w-5" /> {v.label} đã được phê duyệt</h2>
        <p className="mb-3 text-green-900/80">Cấu trúc đã khóa. Muốn thay đổi hãy tạo REV mới (kế thừa % tiến độ); muốn cập nhật tiến độ thực hiện hãy sang mục Theo dõi.</p>
        <div className="flex flex-wrap gap-2">
          {perms.newRev && <button className="btn-primary" disabled={!!busy} onClick={() => act("new_rev")}>{busy === "new_rev" ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />} Tạo REV mới</button>}
          <button className="btn-ghost" onClick={onTrack}>Theo dõi tiến độ</button>
        </div>
      </Card>
    );
  }
  return <Card className="p-5 text-ink-mute">Bản này đã bị hủy.</Card>;
}

function VersionsTab({ data, onOpen }: { data: VersionResp; onOpen: (id: string) => void }) {
  const steps = ["Soạn thảo", "Trình E-Approval", "Phê duyệt"];
  const cur = data.version.status === "draft" ? 0 : data.version.status === "approval_pending" ? 1 : data.version.status === "approved" ? 2 : -1;
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="mb-3 text-[16px] font-semibold">Chu trình phê duyệt — {data.version.label}</h2>
        <ol className="flex items-center gap-2">
          {steps.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2">
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold", i <= cur ? "bg-brand text-white" : "bg-surface-head text-ink-mute")}>{i + 1}</span>
              <span className={cn("font-medium", i <= cur ? "text-ink" : "text-ink-mute")}>{s}</span>
              {i < steps.length - 1 && <span className={cn("h-0.5 flex-1", i < cur ? "bg-brand" : "bg-surface-line")} />}
            </li>
          ))}
        </ol>
        {data.version.approval && (
          <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-3">
            <div><span className="text-ink-mute">Mã tờ trình:</span> <b>{data.version.approval.ticket}</b></div>
            <div><span className="text-ink-mute">Trình lúc:</span> {fmtTime(data.version.approval.submittedAt)}</div>
            <div><span className="text-ink-mute">Phê duyệt:</span> {data.version.approval.approvedAt ? `${fmtTime(data.version.approval.approvedAt)} · ${data.version.approval.approver}` : "Chưa"}</div>
          </div>
        )}
      </Card>
      <Card className="overflow-hidden">
        <table className="w-full text-left">
          <thead className="th"><tr><th className="px-4 py-2">Phiên bản</th><th className="px-4 py-2">Loại</th><th className="px-4 py-2">Trạng thái</th><th className="px-4 py-2">Tạo lúc</th><th className="px-4 py-2">Người tạo</th><th className="px-4 py-2 text-right">Số dòng</th><th /></tr></thead>
          <tbody>
            {data.siblings.map((s) => (
              <tr key={s.id} className={cn("border-t border-surface-line", s.id === data.version.id && "bg-brand-soft")}>
                <td className="px-4 py-2 font-semibold">{s.label}</td>
                <td className="px-4 py-2">{s.kind === "baseline" ? "Baseline" : s.kind === "rev" ? `REV ${s.rev}` : "Bản thảo"}</td>
                <td className="px-4 py-2"><StatusBadge status={s.status} /></td>
                <td className="px-4 py-2">{fmtTime(s.createdAt)}</td><td className="px-4 py-2">{s.createdBy}</td>
                <td className="px-4 py-2 text-right">{s.taskCount}</td>
                <td className="px-4 py-2 text-right">{s.id !== data.version.id && <button className="btn-ghost" onClick={() => onOpen(s.id)}>Mở</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ParamsTab({ params, canRegen, onRegen }: { params: ProjectParameters; canRegen: boolean; onRegen: () => void }) {
  const A = params.anchors;
  const rows: [string, string][] = [
    ["1. Tên dự án", A.name], ["2. Mã dự án", A.code], ["3. Chủ đầu tư / Pháp nhân", A.investor], ["4. Loại hình", PROJECT_TYPE_LABEL[A.type]], ["5. Vùng", A.region],
    ["6. Ngày bắt đầu (T₀)", fmtDate(A.t0)], ["7. Mục tiêu Khởi công", fmtDate(A.startConstruction)], ["8. Mục tiêu Mở bán", fmtDate(A.openSale)], ["9. Mục tiêu Bàn giao", fmtDate(A.handover)], ["10. Kết thúc hoàn toàn", fmtDate(A.closeOut)],
  ];
  const tech: [string, string][] = params.high
    ? [["Số tháp", String(params.high.towers)], ["Số tầng hầm", String(params.high.basements)], ["Số tầng nổi", String(params.high.floors)], ["GFA", `${params.high.gfa.toLocaleString("vi-VN")} m²`], ["Diện tích lô đất", `${params.high.landHa} ha`], ["Hồ bơi", params.high.pool ? "Có" : "Không"]]
    : params.low ? [["Số căn", String(params.low.units)], ["Số phân kỳ", String(params.low.phases)], ["Diện tích đất", `${params.low.landHa} ha`], ["Công viên trung tâm", `${params.low.parkM2.toLocaleString("vi-VN")} m²`], ["Clubhouse", params.low.clubhouse ? "Có" : "Không"]] : [];
  return (
    <div className="space-y-4">
    {canRegen && (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><div className="font-semibold">Thay đổi tham số dự án</div><div className="text-ink-mute">Sửa số tháp, số hầm, số tầng, mốc… rồi để động cơ sinh lại tiến độ. Việc chỉnh tay trên lưới sẽ bị ghi đè — chỉ áp dụng cho bản đang soạn thảo.</div></div>
        <button className="btn-ghost" onClick={onRegen}><RefreshCw className="h-4 w-4" /> Sửa tham số &amp; sinh lại</button>
      </Card>
    )}
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="overflow-hidden"><div className="th px-4 py-2">Mốc dự án</div><dl>{rows.map(([k, v]) => <div key={k} className="flex border-t border-surface-line px-4 py-2"><dt className="w-56 text-ink-mute">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl></Card>
      <div className="space-y-4">
        <Card className="overflow-hidden"><div className="th px-4 py-2">Tham số kỹ thuật</div><dl>{tech.map(([k, v]) => <div key={k} className="flex border-t border-surface-line px-4 py-2"><dt className="w-56 text-ink-mute">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl></Card>
        <Card className="p-4"><div className="mb-2 font-semibold">Hạng mục triển khai</div><div className="flex flex-wrap gap-2">{(Object.keys(HANG_MUC_LABEL) as HangMuc[]).map((h) => <Badge key={h} tone={params.hangMuc.includes(h) ? "green" : "slate"} className={cn(!params.hangMuc.includes(h) && "line-through")}>{HANG_MUC_LABEL[h]}</Badge>)}</div></Card>
      </div>
    </div>
    </div>
  );
}

function TaskDrawer({ task, tasks, onClose, percent, versionId, canTrack }: { task: TaskNode | null; tasks: TaskNode[]; onClose: () => void; percent?: number; versionId: string; canTrack: boolean }) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  if (!task) return null;
  const succ = tasks.filter((t) => t.deps.some((d) => d.predId === task.id));
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-3 border-t border-surface-line py-1.5"><span className="text-ink-mute">{k}</span><span className="text-right font-medium">{v}</span></div>;
  return (
    <Drawer open onClose={onClose} title={<><div className="font-mono text-[12px] text-ink-mute">WBS {task.wbs}{task.copyLabel ? ` · ${task.copyLabel}` : ""}</div><div className="text-[16px] font-semibold leading-snug">{task.name}</div></>}>
      <div className="space-y-4 p-4">
        {task.conflict && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900"><b>⚠ Cảnh báo:</b> {task.conflict}</div>}
        <div>
          {row("Ban / Phòng", task.ban ?? "—")}
          {row("Chức danh chịu trách nhiệm", task.assigneeTitle ?? "Chưa gán")}
          {row("Trạng thái", TASK_STATUS_LABEL[task.status])}
          {row("Thời lượng", task.kind === "milestone" ? "Mốc" : `${task.durationDays} ngày làm việc`)}
          {row("Bắt đầu → Kết thúc", `${fmtDate(task.start)} → ${fmtDate(task.finish)}`)}
          {task.kind === "task" && row("Sớm nhất (ES → EF)", `${fmtDate(task.earlyStart)} → ${fmtDate(task.earlyFinish)}`)}
          {task.kind === "task" && row("Muộn nhất (LS → LF)", `${fmtDate(task.lateStart)} → ${fmtDate(task.lateFinish)}`)}
          {task.kind === "task" && row("Dự phòng (float)", <span className={cn(task.critical && "text-red-600")}>{task.floatDays} ngày LV {task.critical ? "· ĐƯỜNG GĂNG" : ""}</span>)}
          {percent !== undefined && row("% hoàn thành (tracking)", `${percent}%`)}
        </div>
        {task.durationNote && <div className="rounded bg-surface p-3"><div className="mb-1 text-[12px] font-semibold uppercase text-ink-head">Cách tính thời lượng</div>{task.durationNote}</div>}
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase text-ink-head">Công việc tiền nhiệm ({task.deps.length})</div>
          {task.deps.length === 0 && <div className="text-ink-mute">Không có (bắt đầu theo mốc T₀)</div>}
          {task.deps.map((d) => { const p = byId.get(d.predId); return <div key={d.predId + d.rel} className="flex items-start gap-2 border-t border-surface-line py-1.5"><Badge tone="violet">{d.rel}{d.lag ? `${d.lag > 0 ? "+" : ""}${d.lag}` : ""}</Badge><span>{p?.name ?? d.predId}{p?.copyLabel ? "" : ""}<span className="block text-[12px] text-ink-mute">{fmtDate(p?.start)} → {fmtDate(p?.finish)}</span></span></div>; })}
        </div>
        <div>
          <div className="mb-1 text-[12px] font-semibold uppercase text-ink-head">Công việc kế tiếp ({succ.length})</div>
          {succ.slice(0, 8).map((s) => <div key={s.id} className="border-t border-surface-line py-1.5">{s.name}<span className="block text-[12px] text-ink-mute">{fmtDate(s.start)} → {fmtDate(s.finish)}</span></div>)}
          {succ.length > 8 && <div className="text-ink-mute">… và {succ.length - 8} việc khác</div>}
          {!succ.length && <div className="text-ink-mute">Không có</div>}
        </div>
        {canTrack && task.kind === "task" && <Link className="btn-primary w-full" href={`/tracking?v=${versionId}&t=${encodeURIComponent(task.id)}`}>Mở trong Theo dõi (cập nhật %, minh chứng, trao đổi)</Link>}
      </div>
    </Drawer>
  );
}

function RegenModal({ open, onClose, project, onDone }: { open: boolean; onClose: () => void; project: Project; onDone: (r: GenerationReport) => void }) {
  const toast = useToast();
  const [p, setP] = useState<ProjectParameters>(() => structuredClone(project.params));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setP(structuredClone(project.params)); }, [open, project]);
  const num = (v: string) => (v === "" ? NaN : Number(v));
  const go = async () => {
    setBusy(true);
    try { const r = await api<{ report: GenerationReport }>(`/api/projects/${project.id}/generate`, { method: "POST", json: { params: p } }); onDone(r.report); }
    catch (e) { const d = (e as ApiError).data as { errors?: { message: string }[] } | undefined; toast(d?.errors?.map((x) => x.message).join(" · ") ?? (e as Error).message, "err"); }
    finally { setBusy(false); }
  };
  const A = p.anchors;
  const setA = (k: keyof typeof A, v: string) => setP({ ...p, anchors: { ...A, [k]: v } });
  return (
    <Modal open={open} onClose={onClose} width="max-w-2xl" title="Sinh lại tiến độ theo tham số mới" footer={<><button className="btn-ghost" onClick={onClose}>Hủy</button><button className="btn-primary" disabled={busy} onClick={go}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Sinh lại</button></>}>
      <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">⚠ Sinh lại sẽ <b>ghi đè</b> các chỉnh sửa tay (trạng thái Đóng, chức danh, thời lượng) trong bản thảo hiện tại.</div>
      <div className="grid gap-3 sm:grid-cols-3">
        {p.high && <>
          <Field label="Số tháp (1-10)"><input className="input" type="number" min={1} max={10} value={p.high.towers} onChange={(e) => setP({ ...p, high: { ...p.high!, towers: num(e.target.value) } })} /></Field>
          <Field label="Số tầng hầm (0-4)"><input className="input" type="number" min={0} max={4} value={p.high.basements} onChange={(e) => setP({ ...p, high: { ...p.high!, basements: num(e.target.value) } })} /></Field>
          <Field label="Số tầng nổi (5-50)"><input className="input" type="number" min={5} max={50} value={p.high.floors} onChange={(e) => setP({ ...p, high: { ...p.high!, floors: num(e.target.value) } })} /></Field>
          <Field label="GFA (m²)"><input className="input" type="number" value={p.high.gfa} onChange={(e) => setP({ ...p, high: { ...p.high!, gfa: num(e.target.value) } })} /></Field>
          <Field label="Đất (ha)"><input className="input" type="number" step={0.1} value={p.high.landHa} onChange={(e) => setP({ ...p, high: { ...p.high!, landHa: num(e.target.value) } })} /></Field>
          <Field label="Hồ bơi"><label className="flex h-9 items-center gap-2"><input type="checkbox" className="accent-[#2DB34B]" checked={p.high.pool} onChange={(e) => setP({ ...p, high: { ...p.high!, pool: e.target.checked } })} /> Có</label></Field>
        </>}
        {p.low && <>
          <Field label="Số căn (10-2000)"><input className="input" type="number" value={p.low.units} onChange={(e) => setP({ ...p, low: { ...p.low!, units: num(e.target.value) } })} /></Field>
          <Field label="Số phân kỳ (1-5)"><input className="input" type="number" min={1} max={5} value={p.low.phases} onChange={(e) => setP({ ...p, low: { ...p.low!, phases: num(e.target.value) } })} /></Field>
          <Field label="Đất (ha)"><input className="input" type="number" step={0.1} value={p.low.landHa} onChange={(e) => setP({ ...p, low: { ...p.low!, landHa: num(e.target.value) } })} /></Field>
          <Field label="Công viên (m²)"><input className="input" type="number" value={p.low.parkM2} onChange={(e) => setP({ ...p, low: { ...p.low!, parkM2: num(e.target.value) } })} /></Field>
          <Field label="Clubhouse"><label className="flex h-9 items-center gap-2"><input type="checkbox" className="accent-[#2DB34B]" checked={p.low.clubhouse} onChange={(e) => setP({ ...p, low: { ...p.low!, clubhouse: e.target.checked } })} /> Có</label></Field>
        </>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-5">
        {(["t0", "startConstruction", "openSale", "handover", "closeOut"] as const).map((k, i) => <Field key={k} label={["T₀", "Khởi công", "Mở bán", "Bàn giao", "Kết thúc"][i]}><input className="input px-2" type="date" value={A[k]} onChange={(e) => setA(k, e.target.value)} /></Field>)}
      </div>
    </Modal>
  );
}
