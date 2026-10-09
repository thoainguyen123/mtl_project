"use client";
// Thẩm định MTL (GIẢ ĐỊNH demo): người thẩm định kiểm tra bản thảo, ghi ý kiến, kết luận đạt / yêu cầu chỉnh sửa trước khi trình duyệt.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageSquareWarning } from "lucide-react";
import { api, fmtDate, fmtTime } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Modal, Spinner, StatusBadge, useToast, cn } from "@/components/ui";
import { PROJECT_TYPE_LABEL, type MtlStatus, type Project } from "@/lib/types";

interface Item extends Project {
  canEdit: boolean;
  current: { id: string; label: string; status: MtlStatus; curConflicts: number; curUnassigned: number; start?: string; finish?: string; review?: { result: "passed" | "changes"; by: string; at: string; note?: string } };
}

export default function ReviewPage() {
  const { can } = useMe();
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState<Item | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(() => api<{ projects: Item[] }>("/api/projects").then((d) => setItems(d.projects)), []);
  useEffect(() => { load(); }, [load]);

  const send = async (p: Item, result: "passed" | "changes", n?: string) => {
    setBusy(p.id);
    try { await api(`/api/versions/${p.current.id}/review`, { method: "POST", json: { result, note: n } }); toast(result === "passed" ? `${p.params.anchors.code}: thẩm định đạt` : `${p.params.anchors.code}: đã yêu cầu chỉnh sửa`); setAsk(null); setNote(""); await load(); }
    catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };

  if (!items) return <Spinner />;
  const rows = items.filter((p) => p.current.status === "draft");
  const th = "px-3 py-2";
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-2 lg:-mx-3 lg:-mb-3 lg:-mt-4 lg:h-[calc(100vh-76px)]">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold">Thẩm định Master Timeline</h1>
        <Badge tone="amber">Nghiệp vụ giả định cho demo</Badge>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto" style={{ minHeight: 320 }}>
          <table className="w-full min-w-[1000px] text-left text-[13px]">
            <thead className="th sticky top-0 z-10"><tr><th className={th}>Dự án</th><th className={th}>Phiên bản</th><th className={th}>Thời gian MTL</th><th className={th}>Kiểm tra tự động</th><th className={th}>Kết quả thẩm định</th><th className={cn(th, "text-right")}>Thao tác</th></tr></thead>
            <tbody>
              {rows.map((p) => { const c = p.current, a = p.params.anchors; const can2 = can("mtl.approve") && p.canEdit; return (
                <tr key={p.id} className="border-t border-surface-line align-top hover:bg-surface">
                  <td className={th}><Link href={`/mtl/${p.id}?v=${c.id}`} className="font-semibold text-brand hover:underline">{a.code} — {a.name}</Link><div className="text-[12px] text-ink-mute">{PROJECT_TYPE_LABEL[a.type]} · {a.region}</div></td>
                  <td className={th}>{c.label} <StatusBadge status={c.status} /></td>
                  <td className={cn(th, "text-ink-soft")}>{fmtDate(c.start)} → {fmtDate(c.finish)}</td>
                  <td className={th}><div className="space-y-1">{c.curConflicts ? <Badge tone="red">{c.curConflicts} xung đột mốc</Badge> : <Badge tone="green">Không xung đột</Badge>}{c.curUnassigned > 0 && <div className="text-[12px] text-amber-700">{c.curUnassigned} việc chưa gán chức danh</div>}</div></td>
                  <td className={th}>{c.review ? <div><Badge tone={c.review.result === "passed" ? "green" : "amber"}>{c.review.result === "passed" ? "Đạt" : "Cần chỉnh sửa"}</Badge><div className="mt-1 text-[12px] text-ink-mute">{c.review.by} · {fmtTime(c.review.at)}</div>{c.review.note && <div className="mt-0.5 max-w-xs text-[12px] text-ink-soft">“{c.review.note}”</div>}</div> : <span className="text-ink-mute">Chưa thẩm định</span>}</td>
                  <td className={th}><div className="flex justify-end gap-2">
                    <button className="btn-ghost" disabled={!can2 || busy === p.id} title={can2 ? "" : "Không đủ quyền thẩm định"} onClick={() => { setAsk(p); setNote(""); }}><MessageSquareWarning className="h-4 w-4" /> Yêu cầu sửa</button>
                    <button className="btn-primary" disabled={!can2 || busy === p.id} title={can2 ? "" : "Không đủ quyền thẩm định"} onClick={() => send(p, "passed")}>{busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Thẩm định đạt</button>
                    {c.review?.result === "passed" && <Link className="btn-ghost" href="/approval">Sang Trình duyệt</Link>}
                  </div></td>
                </tr>); })}
              {!rows.length && <tr><td colSpan={6} className="p-8 text-center text-ink-mute">Không có MTL nào đang chờ thẩm định</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-surface-line bg-white px-3 py-1.5 text-[12px] text-ink-mute">{rows.length} MTL ở trạng thái soạn thảo</div>
      </Card>
      <Modal open={!!ask} onClose={() => setAsk(null)} title={`Yêu cầu chỉnh sửa — ${ask?.params.anchors.code ?? ""}`}
        footer={<><button className="btn-ghost" onClick={() => setAsk(null)}>Hủy</button><button className="btn-primary" disabled={!note.trim() || !!busy} onClick={() => ask && send(ask, "changes", note)}>Gửi yêu cầu</button></>}>
        <label className="label">Ý kiến thẩm định <span className="text-red-500">*</span></label>
        <textarea className="input !h-28 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nêu rõ nội dung cần người lập chỉnh sửa" />
      </Modal>
    </div>
  );
}
