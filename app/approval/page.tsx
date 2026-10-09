"use client";
// Trình Phê Duyệt: hàng đợi trình ký của TẤT CẢ MTL (BRD 2.1 bước 5-6), E-Approval mô phỏng.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileText, GitBranch, Loader2, Send, Undo2 } from "lucide-react";
import { api, ApiError, fmtTime } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Empty, PageTitle, Spinner, StatusBadge, Tabs, useToast } from "@/components/ui";
import { PROJECT_TYPE_LABEL, type MtlStatus, type Project } from "@/lib/types";

interface Item extends Project {
  canEdit: boolean;
  current: { id: string; label: string; status: MtlStatus; curConflicts: number; curUnassigned: number; review?: { result: "passed" | "changes" }; approval?: { ticket: string; submittedAt: string; approvedAt?: string; approver?: string } };
}
type Filter = "all" | "draft" | "approval_pending" | "approved";

export default function ApprovalQueue() {
  const { can } = useMe();
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [f, setF] = useState<Filter>("all");
  const [busy, setBusy] = useState("");
  const load = useCallback(() => api<{ projects: Item[] }>("/api/projects").then((d) => setItems(d.projects)), []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { all: 0, draft: 0, approval_pending: 0, approved: 0 } as Record<Filter, number>;
    for (const p of items ?? []) { c.all++; if (p.current.status in c) c[p.current.status as Filter]++; }
    return c;
  }, [items]);
  const rows = (items ?? []).filter((p) => f === "all" || p.current.status === f);

  const act = async (p: Item, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${p.id}:${action}`);
    try {
      await api(`/api/versions/${p.current.id}/action`, { method: "POST", json: { action, ...extra } });
      toast(action === "submit" ? `${p.params.anchors.code}: đã trình E-Approval (mô phỏng)` : action === "approve" ? `${p.params.anchors.code}: đã phê duyệt` : action === "reject" ? `${p.params.anchors.code}: đã trả về soạn thảo` : `${p.params.anchors.code}: đã tạo REV mới`);
      await load();
    } catch (e) {
      if (e instanceof ApiError && (e.data as { needForce?: boolean })?.needForce) {
        if (confirm(`${e.message}\n\nVẫn trình kèm cảnh báo?`)) { setBusy(""); return act(p, action, { force: true }); }
      } else toast((e as Error).message, "err");
    } finally { setBusy(""); }
  };

  if (!items) return <Spinner />;
  const spin = (k: string) => busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : null;
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageTitle title="Trình Phê Duyệt" sub="Hàng đợi trình ký E-Approval (mô phỏng): soạn thảo xong → trình → BOD phê duyệt → Baseline / REV" />
      <Tabs<Filter> value={f} onChange={setF} tabs={[
        { key: "all", label: <>Tất cả <Badge>{counts.all}</Badge></> },
        { key: "draft", label: <>Chờ trình <Badge tone="amber">{counts.draft}</Badge></> },
        { key: "approval_pending", label: <>Đang trình <Badge tone="blue">{counts.approval_pending}</Badge></> },
        { key: "approved", label: <>Đã duyệt <Badge tone="green">{counts.approved}</Badge></> },
      ]} />
      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[980px] text-left">
          <thead className="th"><tr><th className="px-4 py-2.5">Dự án</th><th className="px-4 py-2.5">Phiên bản</th><th className="px-4 py-2.5">Trạng thái</th><th className="px-4 py-2.5">Kiểm tra</th><th className="px-4 py-2.5">Mã trình / thời điểm</th><th className="px-4 py-2.5 text-right">Thao tác</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const c = p.current, a = p.params.anchors;
              const canSubmit = can("mtl.submit_approval") && p.canEdit;
              const canApprove = can("mtl.approve") && p.canEdit;
              const canRev = can("mtl.generate") && p.canEdit;
              return (
                <tr key={p.id} className="border-t border-surface-line hover:bg-surface">
                  <td className="px-4 py-3"><Link href={`/mtl/${p.id}?v=${c.id}`} className="font-semibold text-brand hover:underline">{a.code} — {a.name}</Link><div className="text-[12px] text-ink-mute">{PROJECT_TYPE_LABEL[a.type]} · {a.region}</div></td>
                  <td className="px-4 py-3">{c.label}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3">
                    {c.status === "draft" ? <div className="space-y-1">
                      {c.review ? <Badge tone={c.review.result === "passed" ? "green" : "amber"}>{c.review.result === "passed" ? "Đã thẩm định đạt" : "Thẩm định: cần sửa"}</Badge> : <Badge>Chưa thẩm định</Badge>}
                      {c.curConflicts ? <Badge tone="red">{c.curConflicts} xung đột mốc</Badge> : <Badge tone="green">Không xung đột</Badge>}
                      {c.curUnassigned > 0 && <div className="text-[12px] text-amber-700">{c.curUnassigned} việc chưa gán chức danh</div>}
                    </div> : <span className="text-ink-mute">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px]">{c.approval ? <><b>{c.approval.ticket}</b><div className="text-ink-mute">{c.approval.approvedAt ? `Duyệt ${fmtTime(c.approval.approvedAt)}` : `Trình ${fmtTime(c.approval.submittedAt)}`}</div></> : <span className="text-ink-mute">Chưa trình</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      {c.status === "draft" && <>
                        <Link className="btn-ghost" href={`/mtl/${p.id}/to-trinh?v=${c.id}`} target="_blank"><FileText className="h-4 w-4" /> Tờ trình</Link>
                        <button className="btn-primary" disabled={!canSubmit || !!busy} title={canSubmit ? "" : "Không đủ quyền hoặc ngoài phạm vi"} onClick={() => act(p, "submit")}>{spin(`${p.id}:submit`) ?? <Send className="h-4 w-4" />} Trình E-Approval</button>
                      </>}
                      {c.status === "approval_pending" && <>
                        <button className="btn-primary" disabled={!canApprove || !!busy} title={canApprove ? "" : "Không đủ quyền phê duyệt"} onClick={() => act(p, "approve")}>{spin(`${p.id}:approve`) ?? <CheckCircle2 className="h-4 w-4" />} BOD phê duyệt</button>
                        <button className="btn-ghost" disabled={!canApprove || !!busy} onClick={() => act(p, "reject", { note: "E-Approval trả về để chỉnh sửa" })}>{spin(`${p.id}:reject`) ?? <Undo2 className="h-4 w-4" />} Trả về</button>
                      </>}
                      {c.status === "approved" && <>
                        <Link className="btn-ghost" href={`/tracking?v=${c.id}`}>Theo dõi</Link>
                        <button className="btn-ghost" disabled={!canRev || !!busy} title={canRev ? "" : "Không đủ quyền"} onClick={() => act(p, "new_rev")}>{spin(`${p.id}:new_rev`) ?? <GitBranch className="h-4 w-4" />} Tạo REV mới</button>
                      </>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6}><Empty title="Không có MTL ở trạng thái này" /></td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
