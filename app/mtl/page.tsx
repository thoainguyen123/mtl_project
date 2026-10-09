"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { api, fmtDate } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Empty, PageTitle, Progress, Spinner, StatusBadge } from "@/components/ui";
import { MTL_STATUS_LABEL, PROJECT_TYPE_LABEL, type MtlStatus, type Project, type ProjectType } from "@/lib/types";

interface ListItem extends Project {
  versions: { id: string; label: string; status: MtlStatus; taskCount: number }[];
  current: { id: string; label: string; status: MtlStatus; start?: string; finish?: string; actual: number; plan: number; late: number; conflicts: number };
  canEdit: boolean;
}

export default function MtlList() {
  const { can } = useMe();
  const [items, setItems] = useState<ListItem[] | null>(null);
  const [q, setQ] = useState("");
  const [st, setSt] = useState("");
  useEffect(() => { api<{ projects: ListItem[] }>("/api/projects").then((d) => setItems(d.projects)); }, []);
  const rows = useMemo(() => (items ?? []).filter((p) => {
    const a = p.params.anchors;
    return (!q || `${a.code} ${a.name} ${a.region}`.toLowerCase().includes(q.toLowerCase())) && (!st || p.current.status === st);
  }), [items, q, st]);
  if (!items) return <Spinner />;
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageTitle title="Lập Master Timeline" sub="Danh sách MTL và trạng thái phê duyệt của từng dự án" actions={can("project.create") ? <Link href="/mtl/new" className="btn-primary"><Plus className="h-4 w-4" /> Tạo MTL mới</Link> : <span className="text-ink-mute">Bạn chỉ có quyền xem</span>} />
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="relative w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" /><input className="input pl-9" placeholder="Tìm mã, tên dự án, vùng…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input w-56" value={st} onChange={(e) => setSt(e.target.value)} aria-label="Lọc trạng thái">
          <option value="">Tất cả trạng thái</option>
          {(Object.keys(MTL_STATUS_LABEL) as MtlStatus[]).map((s) => <option key={s} value={s}>{MTL_STATUS_LABEL[s]}</option>)}
        </select>
        <span className="ml-auto text-ink-mute">{rows.length} / {items.length} MTL</span>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left">
          <thead className="th"><tr><th className="px-4 py-2.5">Dự án</th><th className="px-4 py-2.5">Loại hình</th><th className="px-4 py-2.5">Phiên bản</th><th className="px-4 py-2.5">Trạng thái</th><th className="px-4 py-2.5">Thời gian</th><th className="px-4 py-2.5 w-52">Tiến độ thực tế</th><th className="px-4 py-2.5"></th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const a = p.params.anchors;
              return (
                <tr key={p.id} className="border-t border-surface-line hover:bg-surface">
                  <td className="px-4 py-3"><Link href={`/mtl/${p.id}`} className="font-semibold text-brand hover:underline">{a.code} — {a.name}</Link><div className="text-[12px] text-ink-mute">{a.region} · {a.investor}</div></td>
                  <td className="px-4 py-3">{PROJECT_TYPE_LABEL[a.type as ProjectType]}</td>
                  <td className="px-4 py-3">{p.current.label}<div className="text-[12px] text-ink-mute">{p.versions.length} phiên bản</div></td>
                  <td className="px-4 py-3"><StatusBadge status={p.current.status} />{p.current.conflicts > 0 && <Badge tone="red" className="ml-2">{p.current.conflicts} xung đột</Badge>}</td>
                  <td className="px-4 py-3">{fmtDate(a.t0)} → {fmtDate(p.current.finish)}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="flex-1"><Progress value={p.current.actual} plan={p.current.plan} /></div><span className="w-10 text-right font-semibold">{p.current.actual}%</span></div>{p.current.late > 0 && <div className="mt-1 text-[12px] text-red-600">{p.current.late} việc trễ hạn</div>}</td>
                  <td className="px-4 py-3 text-right"><Link href={`/mtl/${p.id}`} className="btn-ghost">{p.canEdit ? "Mở & chỉnh sửa" : "Xem"}</Link></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7}><Empty title="Không có MTL phù hợp" hint="Thử xóa bộ lọc hoặc tạo MTL mới." /></td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
