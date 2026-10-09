"use client";
// Thông tin dự án: danh sách + hồ sơ dự án chỉnh sửa được . Phạm vi theo vai trò/vùng/dự án.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Save, Search } from "lucide-react";
import { api, ApiError, fmtDate } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Drawer, Field, Spinner, StatusBadge, useToast } from "@/components/ui";
import { PROJECT_TYPE_LABEL, type AnchorParams, type MtlStatus, type Project, type ProjectInfo } from "@/lib/types";

interface Item extends Project { current: { id: string; label: string; status: MtlStatus }; canEdit: boolean }
const DATES: [keyof AnchorParams, string][] = [["t0", "Ngày bắt đầu dự án (T0)"], ["startConstruction", "Mục tiêu Khởi công"], ["openSale", "Mục tiêu Mở bán"], ["handover", "Mục tiêu Bàn giao"], ["closeOut", "Kết thúc hoàn toàn"]];

function techSummary(p: Project) {
  const h = p.params.high, l = p.params.low;
  if (h) return `${h.towers} tháp · ${h.floors} tầng nổi · ${h.basements} hầm · GFA ${h.gfa.toLocaleString("vi-VN")} m²`;
  if (l) return `${l.units.toLocaleString("vi-VN")} căn · ${l.phases} phân kỳ · ${l.landHa} ha`;
  return "—";
}

export default function ProjectInfoPage() {
  const { can } = useMe();
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Item | null>(null);
  const load = useCallback(() => api<{ projects: Item[] }>("/api/projects").then((d) => { setItems(d.projects); return d.projects; }), []);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => (items ?? []).filter((p) => !q || `${p.params.anchors.code} ${p.params.anchors.name} ${p.params.anchors.region} ${p.params.anchors.investor}`.toLowerCase().includes(q.toLowerCase())), [items, q]);
  if (!items) return <Spinner />;
  const th = "px-3 py-2";
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-2 lg:-mx-3 lg:-mb-3 lg:-mt-4 lg:h-[calc(100vh-76px)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 flex-1 truncate text-[16px] font-bold">Thông tin dự án</h1>
        <div className="relative w-72"><Search className="absolute left-3 top-2 h-4 w-4 text-ink-mute" /><input className="input !h-8 pl-9 !text-[13px]" placeholder="Tìm mã, tên, vùng, chủ đầu tư…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-auto" style={{ minHeight: 320 }}>
          <table className="w-full min-w-[1100px] text-left text-[13px]">
            <thead className="th sticky top-0 z-10"><tr>
              <th className={th}>Mã</th><th className={th}>Tên dự án</th><th className={th}>Chủ đầu tư / pháp nhân</th><th className={th}>Loại hình</th><th className={th}>Vùng</th><th className={th}>Quy mô</th><th className={th}>Khởi công</th><th className={th}>Bàn giao</th><th className={th}>MTL</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => { const a = p.params.anchors; return (
                <tr key={p.id} className="cursor-pointer border-t border-surface-line hover:bg-surface" onClick={() => setSel(p)}>
                  <td className={`${th} font-semibold text-brand`}>{a.code}</td>
                  <td className={th}>{a.name}</td>
                  <td className={`${th} text-ink-soft`}>{a.investor}</td>
                  <td className={th}>{PROJECT_TYPE_LABEL[a.type]}</td>
                  <td className={th}>{a.region}</td>
                  <td className={`${th} text-ink-soft`}>{techSummary(p)}</td>
                  <td className={th}>{fmtDate(a.startConstruction)}</td>
                  <td className={th}>{fmtDate(a.handover)}</td>
                  <td className={th}><StatusBadge status={p.current.status} /></td>
                </tr>); })}
              {!rows.length && <tr><td colSpan={9} className="p-6 text-center text-ink-mute">Không có dự án trong phạm vi của bạn</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-surface-line bg-white px-3 py-1.5 text-[12px] text-ink-mute">
          <Badge>{rows.length} / {items.length} dự án</Badge>
        </div>
      </Card>
      {sel && <ProjectDrawer item={sel} canPerm={can("project.edit")} onClose={() => setSel(null)} onSaved={async (id, changed) => { const l = await load(); setSel(l.find((x) => x.id === id) ?? null); toast(changed ? "Đã lưu — mốc dự án thay đổi, MTL cần tạo REV mới để cập nhật" : "Đã lưu hồ sơ dự án", changed ? "warn" : "ok"); }} />}
    </div>
  );
}

function ProjectDrawer({ item, canPerm, onClose, onSaved }: { item: Item; canPerm: boolean; onClose: () => void; onSaved: (id: string, milestoneChanged: boolean) => void }) {
  const toast = useToast();
  const [a, setA] = useState<AnchorParams>(item.params.anchors);
  const [info, setInfo] = useState<ProjectInfo>(item.info ?? {});
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [investors, setInvestors] = useState<string[]>([]);
  useEffect(() => { api<{ investors: string[] }>("/api/core-projects").then((d) => setInvestors(d.investors)).catch(() => {}); }, []);
  const editable = canPerm && item.canEdit;
  const ro = !editable;
  const set = (k: keyof AnchorParams, v: string) => setA((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true); setErr({});
    try {
      const r = await api<{ milestoneChanged: boolean }>(`/api/projects/${item.id}`, { method: "PATCH", json: { anchors: a, info } });
      onSaved(item.id, r.milestoneChanged);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray((e.data as { errors?: { field: string; message: string }[] })?.errors)) {
        setErr(Object.fromEntries((e.data as { errors: { field: string; message: string }[] }).errors.map((x) => [x.field, x.message])));
      }
      toast((e as Error).message, "err");
    } finally { setBusy(false); }
  };
  const dirtyMilestone = DATES.some(([k]) => a[k] !== item.params.anchors[k]);
  return (
    <Drawer open onClose={onClose} width="w-[560px]" title={<span>{item.params.anchors.code} — Hồ sơ dự án</span>}>
      <div className="space-y-4 p-4">
        {!editable && <div className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900">{canPerm ? "Dự án nằm ngoài phạm vi quản trị của bạn — chỉ xem." : "Vai trò của bạn chỉ có quyền xem hồ sơ dự án."}</div>}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-mute">Thông tin chung</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mã dự án" hint="Không đổi được"><input className="input" value={a.code} disabled /></Field>
            <Field label="Loại hình" hint="Không đổi được (quyết định template MTL)"><input className="input" value={PROJECT_TYPE_LABEL[a.type]} disabled /></Field>
            <div className="col-span-2"><Field label="Tên dự án" required error={err.name}><input className="input" maxLength={150} value={a.name} disabled={ro} onChange={(e) => set("name", e.target.value)} /></Field></div>
            <div className="col-span-2"><Field label="Chủ đầu tư / pháp nhân" required error={err.investor}>
              <select className="input" value={a.investor} disabled={ro} onChange={(e) => set("investor", e.target.value)}>
                {[...new Set([a.investor, ...investors])].map((i) => <option key={i}>{i}</option>)}
              </select></Field></div>
            <Field label="Vùng" hint="Không đổi được (quyết định phạm vi phân quyền)"><input className="input" value={a.region} disabled /></Field>
            <Field label="Quy mô"><input className="input" value={techSummary(item)} disabled /></Field>
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-mute">Mốc dự án</h3>
          <div className="grid grid-cols-2 gap-3">
            {DATES.map(([k, l]) => <Field key={k} label={l} required error={err[k]}><input type="date" className="input" value={a[k]} disabled={ro} onChange={(e) => set(k, e.target.value)} /></Field>)}
          </div>
          {dirtyMilestone && <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900">Đổi mốc dự án không tự sửa MTL đã lập. Sau khi lưu, hãy tạo REV mới hoặc “Tạo lại” ở tab Tham số của MTL.</div>}
        </section>
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-mute">Hồ sơ bổ sung</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Field label="Địa chỉ / vị trí"><input className="input" value={info.address ?? ""} disabled={ro} onChange={(e) => setInfo({ ...info, address: e.target.value })} /></Field></div>
            <Field label="Người phụ trách (PMD)"><input className="input" value={info.pm ?? ""} disabled={ro} onChange={(e) => setInfo({ ...info, pm: e.target.value })} /></Field>
            <Field label="Giám đốc điều hành dự án"><input className="input" value={info.gmd ?? ""} disabled={ro} onChange={(e) => setInfo({ ...info, gmd: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Liên kết hồ sơ dự án"><input className="input" placeholder="https://…" value={info.link ?? ""} disabled={ro} onChange={(e) => setInfo({ ...info, link: e.target.value })} /></Field></div>
            <div className="col-span-2"><Field label="Ghi chú"><textarea className="input !h-20 py-2" value={info.note ?? ""} disabled={ro} onChange={(e) => setInfo({ ...info, note: e.target.value })} /></Field></div>
          </div>
        </section>
        <div className="flex items-center gap-2 border-t border-surface-line pt-3">
          <Link href={`/mtl/${item.id}?v=${item.current.id}`} className="btn-ghost">Mở MTL ({item.current.label})</Link>
          <Link href={`/design-tasks?p=${item.id}`} className="btn-ghost">Nhiệm vụ thiết kế</Link>
          <Link href={`/fs?p=${item.id}`} className="btn-ghost">FS thực thi</Link>
          {editable && <button className="btn-primary ml-auto" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu</button>}
        </div>
      </div>
    </Drawer>
  );
}
