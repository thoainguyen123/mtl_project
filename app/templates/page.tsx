"use client";
// Module Quản trị danh mục cấu trúc MTL chuẩn (BRD 3.5): xem Master Template + cấu hình định mức & tham số.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Save, Search } from "lucide-react";
import { api, fmtNum } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Field, PageTitle, Spinner, Tabs, useToast, cn } from "@/components/ui";
import type { DurationConfig } from "@/lib/types";

interface T { code: string; wbs: string; name: string; level: number; parent?: string; ban?: string; kind: string; pred?: { code: string; rel: string }; applies: { low: boolean; high: boolean; hotel: boolean }; baseLow?: number; baseHigh?: number; demo: boolean; hangmuc?: string[] }

export default function Templates() {
  const { can } = useMe();
  const toast = useToast();
  const [tab, setTab] = useState<"tree" | "config">("tree");
  const [tpl, setTpl] = useState<{ tasks: T[]; overrides: Record<string, { baseHigh?: number; baseLow?: number }> } | null>(null);
  const [cfg, setCfg] = useState<DurationConfig | null>(null);
  const [q, setQ] = useState("");
  const [ban, setBan] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const load = () => { api<{ tasks: T[]; overrides: Record<string, { baseHigh?: number; baseLow?: number }> }>("/api/template").then(setTpl); api<{ config: DurationConfig }>("/api/config").then((r) => setCfg(r.config)); };
  useEffect(load, []);

  const kids = useMemo(() => { const m = new Map<string, T[]>(); for (const t of tpl?.tasks ?? []) { const k = t.parent ?? "__root__"; if (!m.has(k)) m.set(k, []); m.get(k)!.push(t); } return m; }, [tpl]);
  const bans = useMemo(() => [...new Set((tpl?.tasks ?? []).map((t) => t.ban).filter(Boolean))].sort() as string[], [tpl]);
  const rows = useMemo(() => {
    if (!tpl) return [];
    const out: T[] = [];
    if (q || ban) {
      const ok = new Set<string>(); const byCode = new Map(tpl.tasks.map((t) => [t.code, t]));
      for (const t of tpl.tasks) {
        if (t.kind === "summary") continue;
        if (q && !`${t.name} ${t.wbs}`.toLowerCase().includes(q.toLowerCase())) continue;
        if (ban && t.ban !== ban) continue;
        ok.add(t.code); for (let p = t.parent; p; p = byCode.get(p)?.parent) ok.add(p);
      }
      return tpl.tasks.filter((t) => ok.has(t.code));
    }
    const walk = (p: string) => { for (const t of kids.get(p) ?? []) { out.push(t); if (t.kind === "summary" && open.has(t.code)) walk(t.code); } };
    walk("__root__");
    return out;
  }, [tpl, kids, open, q, ban]);

  const saveOverride = async (code: string, field: "baseHigh" | "baseLow", v: string) => {
    const num = v === "" ? null : Number(v);
    if (num !== null && (!Number.isFinite(num) || num < 1)) return toast("Định mức phải ≥ 1 ngày", "err");
    setBusy(code);
    try { await api("/api/template", { method: "PATCH", json: { code, [field]: num } }); toast("Đã lưu định mức — áp dụng cho MTL sinh MỚI"); load(); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };
  const saveCfg = async () => {
    setBusy("cfg");
    try { await api("/api/config", { method: "PUT", json: cfg }); toast("Đã lưu cấu hình định mức"); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };

  if (!tpl || !cfg) return <Spinner />;
  const manage = can("template.manage");
  const settings = can("settings.manage");
  const numF = (label: string, k: keyof DurationConfig, hint: string, step = 1) => (
    <Field label={label} hint={hint}><input className="input" type="number" step={step} disabled={!settings} value={cfg[k] as number} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} /></Field>
  );
  return (
    <div className="mx-auto max-w-[1400px]">
      <PageTitle title="Template & Định mức" sub={`Master Template chuẩn toàn Tập đoàn — ${fmtNum(tpl.tasks.length)} mã WBS (nguồn: Excel “1.Duration & He so”)`} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "tree", label: "Cấu trúc WBS chuẩn" }, { key: "config", label: "Định mức & hệ số" }]} />
      <div className="mt-4">
        {tab === "tree" && (
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-line p-3">
              <div className="relative w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" /><input className="input pl-9" placeholder="Tìm tên công việc / WBS…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <select className="input w-40" value={ban} onChange={(e) => setBan(e.target.value)} aria-label="Ban"><option value="">Tất cả Ban</option>{bans.map((b) => <option key={b}>{b}</option>)}</select>
              <button className="btn-ghost" onClick={() => setOpen(new Set(tpl.tasks.filter((t) => t.kind === "summary").map((t) => t.code)))}>Mở tất cả</button>
              <button className="btn-ghost" onClick={() => setOpen(new Set())}>Thu gọn</button>
              <span className="ml-auto text-ink-mute">{manage ? "Bạn có thể sửa định mức (cột Cao tầng / Thấp tầng)" : "Chỉ xem — cần quyền Quản trị template để sửa"}</span>
            </div>
            <div className="max-h-[calc(100vh-300px)] overflow-auto">
              <table className="w-full min-w-[1000px] text-left">
                <thead className="th sticky top-0 z-10"><tr><th className="px-3 py-2">WBS</th><th className="px-3 py-2">Công việc chuẩn hóa</th><th className="px-3 py-2">Ban</th><th className="px-3 py-2">Tiền nhiệm</th><th className="px-3 py-2">Áp dụng</th><th className="px-3 py-2 text-right">Cao tầng (ngày)</th><th className="px-3 py-2 text-right">Thấp tầng (ngày)</th></tr></thead>
                <tbody>
                  {rows.map((t) => {
                    const isSum = t.kind === "summary"; const ov = tpl.overrides[t.code];
                    return (
                      <tr key={t.code} className="border-t border-surface-line hover:bg-surface">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-ink-mute">{t.wbs}</td>
                        <td className={cn("px-3 py-1.5", isSum && "font-semibold")}><div className="flex items-center" style={{ paddingLeft: (t.level - 1) * 14 }}>
                          {isSum ? <button onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(t.code)) n.delete(t.code); else n.add(t.code); return n; })} className="mr-1 rounded p-0.5 hover:bg-slate-200">{open.has(t.code) || q || ban ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</button> : <span className="mr-1 w-5" />}
                          {t.name}{t.demo && <Badge tone="violet" className="ml-2">demo</Badge>}{t.kind === "periodic" && <Badge className="ml-2">định kỳ</Badge>}</div></td>
                        <td className="px-3 py-1.5">{t.ban}</td>
                        <td className="px-3 py-1.5 font-mono text-[11px]">{t.pred ? `${t.pred.code} ${t.pred.rel}` : ""}</td>
                        <td className="px-3 py-1.5 text-[12px]">{!isSum && [t.applies.high && "Cao", t.applies.low && "Thấp", t.applies.hotel && "KS"].filter(Boolean).join(" · ")}</td>
                        {(["baseHigh", "baseLow"] as const).map((f) => (
                          <td key={f} className="px-3 py-1.5 text-right">
                            {isSum || t[f] === undefined ? <span className="text-ink-mute">—</span> : manage ? (
                              <input type="number" min={1} className={cn("h-7 w-20 rounded border px-2 text-right", ov?.[f] ? "border-amber-400 bg-amber-50" : "border-transparent hover:border-surface-line")} defaultValue={ov?.[f] ?? t[f]} key={`${t.code}${f}${ov?.[f]}`} disabled={busy === t.code}
                                onBlur={(e) => { const nv = Number(e.target.value); if (nv !== (ov?.[f] ?? t[f])) saveOverride(t.code, f, nv === t[f] ? "" : e.target.value); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label={`Định mức ${f}`} />
                            ) : <span className={cn(ov?.[f] && "font-bold text-amber-600")}>{ov?.[f] ?? t[f]}</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === "config" && (
          <Card className="p-5">
            <h2 className="text-[16px] font-semibold">Cấu hình định mức & tham số động cơ</h2>
            <p className="mb-4 text-ink-mute">Áp dụng khi sinh/tính lại MTL. {settings ? "" : "Chỉ xem — cần quyền Cài đặt hệ thống để sửa."}</p>
            <div className="grid gap-4 md:grid-cols-3">
              {numF("Ngày thi công / sàn", "daysPerFloor", "BRD 3.5: mặc định 6 ngày/sàn")}
              {numF("So le giữa các tháp (ngày)", "towerStaggerDays", "BRD 3.1: SS + 15 ngày")}
              {numF("So le giữa các phân kỳ (ngày)", "phaseStaggerDays", "GIẢ ĐỊNH demo (BRD chưa quy định)")}
              {numF("Số hầm chuẩn của định mức", "basementBaseCount", "GIẢ ĐỊNH: thời lượng phần ngầm tỷ lệ số hầm / số này")}
              {numF("GFA tham chiếu (m²)", "gfaReference", "BRD 3.1: mặc định 60.000 m²")}
              <Field label="Tuần làm việc" hint="Ảnh hưởng toàn bộ phép tính ngày"><select className="input" disabled={!settings} value={cfg.workWeek} onChange={(e) => setCfg({ ...cfg, workWeek: Number(e.target.value) as 5 | 6 })}><option value={6}>6 ngày (T2–T7)</option><option value={5}>5 ngày (T2–T6)</option></select></Field>
              {numF("Hệ số GFA tối thiểu", "gfaMin", "Chặn dưới khi nhân hệ số quy mô", 0.05)}
              {numF("Hệ số GFA tối đa", "gfaMax", "Chặn trên", 0.05)}
              <Field label="Cộng ngày dự phòng" hint="Cộng cột “Ngày dự phòng” vào thời lượng"><label className="flex h-9 items-center gap-2"><input type="checkbox" disabled={!settings} className="accent-[#2DB34B]" checked={cfg.includeBuffer} onChange={(e) => setCfg({ ...cfg, includeBuffer: e.target.checked })} /> Có</label></Field>
            </div>
            <Field label="Ngày nghỉ lễ (yyyy-mm-dd, cách nhau dấu phẩy)" hint="Cần HR xác nhận lịch chính thức"><textarea className="input mt-1 h-20 py-2 font-mono text-[12px]" disabled={!settings} value={cfg.holidays.join(", ")} onChange={(e) => setCfg({ ...cfg, holidays: e.target.value.split(/[,\s]+/).filter(Boolean) })} /></Field>
            {settings && <button className="btn-primary mt-4" disabled={busy === "cfg"} onClick={saveCfg}>{busy === "cfg" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu cấu hình</button>}
          </Card>
        )}
      </div>
    </div>
  );
}
