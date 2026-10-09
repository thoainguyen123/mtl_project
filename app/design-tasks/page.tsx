"use client";
// Lập nhiệm vụ thiết kế (GIẢ ĐỊNH DEMO — chưa có đặc tả BRD; căn cứ node 4.0.3.1 và nhánh DMD 12.x của template).
// Luồng: khởi tạo bộ nhiệm vụ từ tham số dự án → soạn từng bộ môn → ban hành cho DMD → DMD xác nhận.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, Plus, Save, Send, Undo2 } from "lucide-react";
import { api, fmtTime } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Field, Spinner, useToast } from "@/components/ui";
import { cn } from "@/components/ui";
import { BRIEF_STATUS_LABEL, type BriefStatus, type DesignBrief, type Project } from "@/lib/types";

interface P extends Pick<Project, "id" | "params"> { canEdit: boolean; counts: { total: number; draft: number; issued: number; confirmed: number } }
interface Disc { branch: string; name: string }
const TONE: Record<BriefStatus, "amber" | "blue" | "green"> = { draft: "amber", issued: "blue", confirmed: "green" };

export default function Page() { return <Suspense fallback={<Spinner />}><DesignTasks /></Suspense>; }

function DesignTasks() {
  const { can } = useMe();
  const toast = useToast();
  const sp = useSearchParams();
  const [projects, setProjects] = useState<P[] | null>(null);
  const [discs, setDiscs] = useState<Disc[]>([]);
  const [pid, setPid] = useState(sp.get("p") ?? "");
  const [briefs, setBriefs] = useState<DesignBrief[]>([]);
  const [sel, setSel] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async (id?: string) => {
    const d = await api<{ projects: P[]; briefs: DesignBrief[]; disciplines: Disc[] }>(`/api/design-briefs${id ?? pid ? `?projectId=${id ?? pid}` : ""}`);
    setProjects(d.projects); setDiscs(d.disciplines); setBriefs(d.briefs);
    if (!(id ?? pid) && d.projects[0]) setPid(d.projects[0].id);
  }, [pid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSel(""); }, [pid]);

  const proj = projects?.find((p) => p.id === pid);
  const editable = !!proj?.canEdit && can("design.edit");
  const nameOf = (b: string) => discs.find((d) => d.branch === b)?.name ?? b;
  const cur = briefs.find((b) => b.id === sel) ?? briefs[0];
  useEffect(() => { if (!sel && briefs[0]) setSel(briefs[0].id); }, [briefs, sel]);

  const init = async () => {
    setBusy("init");
    try { await api("/api/design-briefs", { method: "POST", json: { projectId: pid } }); await load(); toast("Đã khởi tạo bộ nhiệm vụ thiết kế từ tham số dự án"); }
    catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };
  const counts = useMemo(() => proj?.counts ?? { total: 0, draft: 0, issued: 0, confirmed: 0 }, [proj]);

  if (!projects) return <Spinner />;
  const chip = "inline-flex items-center gap-1 rounded bg-surface-head px-2 py-1 text-[12px] font-medium text-ink-soft";
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-2 lg:-mx-3 lg:-mb-3 lg:-mt-4 lg:h-[calc(100vh-76px)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:flex-nowrap">
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold" title="Lập nhiệm vụ thiết kế cho từng bộ môn trước khi giao DMD">Lập Nhiệm vụ Thiết kế</h1>
        <Badge tone="amber">Nghiệp vụ giả định cho demo</Badge>
        <select className="input !h-8 w-64 !text-[13px] font-medium" value={pid} onChange={(e) => { setPid(e.target.value); load(e.target.value); }} aria-label="Dự án">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.params.anchors.code} — {p.params.anchors.name}</option>)}
        </select>
      </div>

      {briefs.length === 0 ? (
        <Card className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
          <div className="text-[15px] font-semibold">Dự án chưa có nhiệm vụ thiết kế</div>
          <div className="max-w-md text-ink-mute">Hệ thống tạo sẵn các bộ môn áp dụng cho loại hình dự án (nhánh DMD 12.x của MTL) và điền gợi ý từ tham số dự án để bạn chỉnh sửa.</div>
          <button className="btn-primary" disabled={!editable || !!busy} title={editable ? "" : "Không đủ quyền hoặc ngoài phạm vi"} onClick={init}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Khởi tạo nhiệm vụ từ tham số dự án</button>
        </Card>
      ) : (
        <Card className="flex min-h-0 flex-1 overflow-hidden">
          <div className="w-72 shrink-0 overflow-auto border-r border-surface-line">
            {briefs.map((b) => (
              <button key={b.id} onClick={() => setSel(b.id)} className={cn("flex w-full flex-col gap-1 border-b border-surface-line px-3 py-2.5 text-left hover:bg-surface", cur?.id === b.id && "bg-surface-head")}>
                <span className="text-[13px] font-semibold">{b.branch} · {nameOf(b.branch)}</span>
                <span className="flex items-center gap-2 text-[12px] text-ink-mute"><Badge tone={TONE[b.status]}>{BRIEF_STATUS_LABEL[b.status]}</Badge>{b.consultant || "Chưa chọn tư vấn"}</span>
              </button>
            ))}
          </div>
          {cur && <BriefEditor key={cur.id + cur.updatedAt} brief={cur} title={`${cur.branch} · ${nameOf(cur.branch)}`} editable={editable} onChanged={(msg) => { load(); toast(msg); }} />}
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-1.5 rounded border border-surface-line bg-white px-3 py-1.5">
        <span className={chip}><b>{counts.total}</b> nhiệm vụ</span>
        <span className={chip}>Đang soạn <b>{counts.draft}</b></span>
        <span className={cn(chip, counts.issued ? "!bg-blue-50 !text-blue-700" : "")}>Đã ban hành <b>{counts.issued}</b></span>
        <span className={cn(chip, counts.confirmed === counts.total && counts.total ? "!bg-green-50 !text-green-700" : "")}>DMD đã xác nhận <b>{counts.confirmed}</b></span>
      </div>
    </div>
  );
}

function BriefEditor({ brief, title, editable, onChanged }: { brief: DesignBrief; title: string; editable: boolean; onChanged: (msg: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ scope: brief.scope, spec: brief.spec, requirements: brief.requirements, consultant: brief.consultant, inputs: brief.inputs.join("\n") });
  const [busy, setBusy] = useState("");
  const { can } = useMe();
  const draft = brief.status === "draft";
  const canEdit = editable && draft;
  const save = async () => api(`/api/design-briefs/${brief.id}`, { method: "PATCH", json: { ...f, inputs: f.inputs.split("\n").map((x) => x.trim()).filter(Boolean) } });
  const run = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); onChanged(msg); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };
  const act = (action: string) => api(`/api/design-briefs/${brief.id}`, { method: "PATCH", json: { action } });
  const dmd = editable && can("design.edit");
  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-4 py-2">
        <h2 className="text-[15px] font-bold">{title}</h2><Badge tone={TONE[brief.status]}>{BRIEF_STATUS_LABEL[brief.status]}</Badge>
        <div className="ml-auto flex items-center gap-2">
          {canEdit && <button className="btn-ghost" disabled={!!busy} onClick={() => run("save", save, "Đã lưu nhiệm vụ")}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu</button>}
          {canEdit && <button className="btn-primary" disabled={!!busy} onClick={() => run("issue", async () => { await save(); await act("issue"); }, "Đã ban hành nhiệm vụ cho DMD")}><Send className="h-4 w-4" /> Ban hành cho DMD</button>}
          {dmd && brief.status === "issued" && <button className="btn-primary" disabled={!!busy} onClick={() => run("confirm", () => act("confirm"), "DMD đã xác nhận nhiệm vụ")}><CheckCircle2 className="h-4 w-4" /> DMD xác nhận</button>}
          {dmd && !draft && <button className="btn-ghost" disabled={!!busy} onClick={() => run("reopen", () => act("reopen"), "Đã mở lại để chỉnh sửa")}><Undo2 className="h-4 w-4" /> Mở lại</button>}
        </div>
      </div>
      <div className="grid gap-3 p-4 xl:grid-cols-2">
        <div className="xl:col-span-2"><Field label="Phạm vi công việc thiết kế" required><textarea className="input !h-24 py-2" value={f.scope} disabled={!canEdit} onChange={(e) => setF({ ...f, scope: e.target.value })} /></Field></div>
        <Field label="Tiêu chuẩn bàn giao / thông số kỹ thuật" required><textarea className="input !h-28 py-2" value={f.spec} disabled={!canEdit} onChange={(e) => setF({ ...f, spec: e.target.value })} /></Field>
        <Field label="Yêu cầu đặc thù"><textarea className="input !h-28 py-2" value={f.requirements} disabled={!canEdit} onChange={(e) => setF({ ...f, requirements: e.target.value })} /></Field>
        <Field label="Đơn vị tư vấn thiết kế dự kiến" required><input className="input" value={f.consultant} disabled={!canEdit} placeholder="Nhập tên đơn vị tư vấn" onChange={(e) => setF({ ...f, consultant: e.target.value })} /></Field>
        <Field label="Hồ sơ đầu vào (mỗi dòng một mục)"><textarea className="input !h-20 py-2" value={f.inputs} disabled={!canEdit} onChange={(e) => setF({ ...f, inputs: e.target.value })} /></Field>
        <div className="xl:col-span-2">
          <div className="label">Lịch sử</div>
          <ul className="space-y-0.5 text-[12px] text-ink-soft">{brief.history.slice(0, 6).map((h, i) => <li key={i}>{fmtTime(h.at)} · <b>{h.by}</b> — {h.action}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
