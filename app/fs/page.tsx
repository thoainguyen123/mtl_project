"use client";
// Lập FS-ver2 / FS thực thi (GIẢ ĐỊNH DEMO — chưa có đặc tả BRD; căn cứ node 4.0.2.1 của template).
// FS = dự toán đầu tư theo nhóm chi phí (suất đầu tư × quy mô), phân bổ theo tháng theo mốc MTL, chốt rồi chuyển FPA (Capex).
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Copy, Loader2, Save, Send } from "lucide-react";
import { api, fmtDate, fmtNum, fmtTime } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Spinner, useToast, cn } from "@/components/ui";
import type { FsVersion, Project } from "@/lib/types";

interface Calc { scale: number; lines: { key: string; label: string; unit: string; rate: number; total: number; from: string; to: string }[]; total: number; months: string[]; monthly: Record<string, number[]>; monthTotals: number[]; cumulative: number[] }
type V = FsVersion & { calc: Calc; mtlLabel: string };
interface P extends Pick<Project, "id" | "params"> { canEdit: boolean; mtlLabel: string; mtlStatus: string; count: number; latest: { label: string; status: string; sentFpaAt?: string; total: number } | null }
const tỷ = (m: number) => `${(m / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} tỷ`;

export default function Page() { return <Suspense fallback={<Spinner />}><Fs /></Suspense>; }

function Fs() {
  const { can } = useMe();
  const toast = useToast();
  const sp = useSearchParams();
  const [projects, setProjects] = useState<P[] | null>(null);
  const [versions, setVersions] = useState<V[]>([]);
  const [scale, setScale] = useState<{ value: number; note: string } | null>(null);
  const [pid, setPid] = useState(sp.get("p") ?? "");
  const [vid, setVid] = useState("");
  const [rates, setRates] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async (id?: string) => {
    const use = id ?? pid;
    const d = await api<{ projects: P[]; versions: V[]; scale: { value: number; note: string } | null }>(`/api/fs${use ? `?projectId=${use}` : ""}`);
    setProjects(d.projects); setVersions(d.versions); setScale(d.scale);
    if (!use && d.projects[0]) setPid(d.projects[0].id);
    setVid((cur) => (d.versions.some((v) => v.id === cur) ? cur : d.versions[0]?.id ?? ""));
    setDirty(false);
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  const proj = projects?.find((p) => p.id === pid);
  const v = versions.find((x) => x.id === vid);
  useEffect(() => { if (v) setRates(v.rates); }, [v?.id, versions]); // eslint-disable-line react-hooks/exhaustive-deps

  const editable = !!proj?.canEdit && can("fs.edit") && v?.status === "draft";
  const canApprove = !!proj?.canEdit && can("fs.approve");

  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); await load(); toast(msg); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };
  const patch = (json: unknown) => api(`/api/fs/${vid}`, { method: "PATCH", json });

  if (!projects) return <Spinner />;
  const chip = "inline-flex items-center gap-1 rounded bg-surface-head px-2 py-1 text-[12px] font-medium text-ink-soft";
  const th = "px-3 py-2";
  const c = v?.calc;
  // Tính nhanh phía client khi đang sửa suất (để thấy số nhảy ngay), số chính thức lấy từ server sau khi lưu
  const liveTotal = c ? c.lines.reduce((s, l) => s + Math.round((rates[l.key] ?? l.rate) * c.scale), 0) : 0;
  const ya = proj?.params.anchors;
  const years = c ? [...new Set(c.months.map((m) => m.slice(0, 4)))] : [];

  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-2 lg:-mx-3 lg:-mb-3 lg:-mt-4 lg:h-[calc(100vh-76px)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:flex-nowrap">
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold" title="Lập/Cập nhật FS thực thi (FS-ver2)">Lập FS Thực thi (FS-ver2)</h1>
        <Badge tone="amber">Nghiệp vụ giả định cho demo</Badge>
        <select className="input !h-8 w-64 !text-[13px] font-medium" value={pid} onChange={(e) => { setPid(e.target.value); load(e.target.value); }} aria-label="Dự án">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.params.anchors.code} — {p.params.anchors.name}</option>)}
        </select>
        {versions.length > 0 && <select className="input !h-8 w-40 !text-[13px]" value={vid} onChange={(e) => setVid(e.target.value)} aria-label="Phiên bản FS">
          {versions.map((x) => <option key={x.id} value={x.id}>{x.label}{x.status === "draft" ? " (nháp)" : ""}</option>)}
        </select>}
        <button className="btn-primary !h-8" disabled={!proj?.canEdit || !can("fs.edit") || !!busy || versions.some((x) => x.status === "draft")}
          title={versions.some((x) => x.status === "draft") ? "Đang có bản nháp" : ""} onClick={() => run("new", () => api("/api/fs", { method: "POST", json: { projectId: pid } }), "Đã tạo phiên bản FS mới")}>
          {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} {versions.length ? "Tạo phiên bản mới" : "Lập FS-ver2"}
        </button>
      </div>

      {!v || !c || !ya ? (
        <Card className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
          <div className="text-[15px] font-semibold">Dự án chưa có FS thực thi</div>
          <div className="max-w-lg text-ink-mute">Bấm “Lập FS-ver2” để tạo phiên bản đầu tiên từ suất đầu tư mặc định và quy mô dự án. Thời gian phân bổ theo mốc của MTL ({proj?.mtlLabel}).</div>
        </Card>
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-3 py-2">
            <Badge tone={v.status === "draft" ? "amber" : "green"}>{v.status === "draft" ? "Bản nháp" : "Đã chốt"}</Badge>
            {v.sentFpaAt && <Badge tone="blue">Đã chuyển FPA {fmtTime(v.sentFpaAt)}</Badge>}
            <span className="text-[12px] text-ink-mute">Căn cứ MTL <b>{v.mtlLabel}</b> · Quy mô {fmtNum(c.scale)} m² ({scale?.note}) · Giai đoạn {fmtDate(ya.t0)} → {fmtDate(ya.closeOut)}</span>
            <div className="ml-auto flex items-center gap-2">
              {editable && <button className="btn-ghost" disabled={!!busy || !dirty} onClick={() => run("save", () => patch({ rates }), "Đã lưu suất đầu tư")}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu</button>}
              {v.status === "draft" && <button className="btn-primary" disabled={!canApprove || !!busy || dirty} title={dirty ? "Lưu thay đổi trước" : canApprove ? "" : "Không đủ quyền chốt FS"} onClick={() => run("approve", () => patch({ action: "approve" }), "Đã chốt FS thực thi")}><CheckCircle2 className="h-4 w-4" /> Chốt FS</button>}
              {v.status === "approved" && !v.sentFpaAt && <button className="btn-primary" disabled={!canApprove || !!busy} onClick={() => run("fpa", () => patch({ action: "send_fpa" }), "Đã chuyển FPA (Capex) — mô phỏng")}><Send className="h-4 w-4" /> Chuyển FPA (Capex)</button>}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto" style={{ minHeight: 320 }}>
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="th sticky top-0 z-10"><tr><th className={th}>Nhóm chi phí</th><th className={cn(th, "w-40")}>Suất đầu tư</th><th className={cn(th, "text-right")}>Thành tiền (triệu đồng)</th><th className={th}>Tỷ trọng</th><th className={th}>Giai đoạn phân bổ</th></tr></thead>
              <tbody>
                {c.lines.map((l) => {
                  const r = rates[l.key] ?? l.rate;
                  const amount = dirty ? Math.round(r * c.scale) : l.total;
                  return (
                    <tr key={l.key} className="border-t border-surface-line">
                      <td className={cn(th, "font-medium")}>{l.label}</td>
                      <td className={th}>
                        <div className="flex items-center gap-1.5"><input type="number" min={0} step={0.1} className="input !h-7 w-20 !px-2 text-right" value={r} disabled={!editable} onChange={(e) => { setRates({ ...rates, [l.key]: Number(e.target.value) }); setDirty(true); }} aria-label={`Suất đầu tư ${l.label}`} /><span className="text-[11px] text-ink-mute">{l.unit}</span></div>
                      </td>
                      <td className={cn(th, "text-right tabular-nums")}>{fmtNum(amount)}</td>
                      <td className={th}><div className="flex items-center gap-2"><div className="h-1.5 w-24 rounded bg-surface-head"><div className="h-1.5 rounded bg-brand" style={{ width: `${Math.round((amount / Math.max(1, dirty ? liveTotal : c.total)) * 100)}%` }} /></div><span className="text-[12px] text-ink-soft">{Math.round((amount / Math.max(1, dirty ? liveTotal : c.total)) * 100)}%</span></div></td>
                      <td className={cn(th, "text-ink-soft")}>{fmtDate(l.from)} → {fmtDate(l.to)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-surface-line bg-surface-head font-semibold"><td className={th}>Tổng mức đầu tư</td><td className={th}></td><td className={cn(th, "text-right tabular-nums")}>{fmtNum(dirty ? liveTotal : c.total)}</td><td className={th} colSpan={2}>≈ {tỷ(dirty ? liveTotal : c.total)} đồng</td></tr>
              </tbody>
            </table>
            <div className="border-t border-surface-line p-3">
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-mute">Dòng tiền đầu tư theo năm (triệu đồng) — {dirty ? "lưu để cập nhật phân bổ" : "phân bổ đều theo tháng trong giai đoạn của từng nhóm"}</div>
              <table className="w-full text-[12px]">
                <thead><tr className="text-left text-ink-mute"><th className="py-1 pr-3">Nhóm</th>{years.map((y) => <th key={y} className="py-1 pr-3 text-right">{y}</th>)}</tr></thead>
                <tbody>
                  {c.lines.map((l) => <tr key={l.key} className="border-t border-surface-line"><td className="py-1 pr-3">{l.label}</td>{years.map((y) => <td key={y} className="py-1 pr-3 text-right tabular-nums">{fmtNum(c.months.reduce((s, m, i) => s + (m.startsWith(y) ? c.monthly[l.key][i] : 0), 0))}</td>)}</tr>)}
                  <tr className="border-t-2 border-surface-line font-semibold"><td className="py-1 pr-3">Cộng</td>{years.map((y) => <td key={y} className="py-1 pr-3 text-right tabular-nums">{fmtNum(c.months.reduce((s, m, i) => s + (m.startsWith(y) ? c.monthTotals[i] : 0), 0))}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 border-t border-surface-line bg-white px-3 py-1.5">
            <span className={chip}>Tổng đầu tư <b>{tỷ(dirty ? liveTotal : c.total)}</b></span>
            <span className={chip}>Suất bình quân <b>{(((dirty ? liveTotal : c.total) / Math.max(1, c.scale))).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}</b> tr.đ/m²</span>
            <span className={chip}>Đỉnh vốn tháng <b>{tỷ(Math.max(...c.monthTotals))}</b></span>
            <span className={chip}>Tạo bởi {v.createdBy} {fmtTime(v.createdAt)}</span>
            {v.approvedBy && <span className={cn(chip, "!bg-green-50 !text-green-700")}>Chốt bởi {v.approvedBy}</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
