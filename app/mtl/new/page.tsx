"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Database, Loader2, Sparkles } from "lucide-react";
import { api, ApiError, fmtDate } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, Field, PageTitle, useToast, cn } from "@/components/ui";
import { validateAnchors, validateTech, type FieldError } from "@/lib/validate";
import { HANG_MUC_LABEL, PROJECT_TYPE_LABEL, type AnchorParams, type HangMuc, type HighRiseParams, type LowRiseParams, type ProjectParameters, type ProjectType } from "@/lib/types";

interface Core { code: string; name: string; investor: string; region: string; type: ProjectType }
const TYPES = Object.keys(PROJECT_TYPE_LABEL) as ProjectType[];
const isHighType = (t: ProjectType) => t === "high_rise" || t === "mixed_use";
const ALL_HM = Object.keys(HANG_MUC_LABEL) as HangMuc[];
const DEFAULT_HM: Record<"high" | "low", HangMuc[]> = {
  high: ["htkt", "coc", "tien_ich", "canh_quan"],
  low: ["san_lap", "xu_ly_nen", "htkt", "tien_ich", "canh_quan", "tram_dien"],
};

export default function NewMtl() {
  const { can } = useMe();
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [core, setCore] = useState<{ projects: Core[]; investors: string[]; regions: string[] } | null>(null);
  const [loadingCore, setLoadingCore] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [a, setA] = useState<AnchorParams>({ name: "", code: "", investor: "", type: "high_rise", region: "", t0: "", startConstruction: "", openSale: "", handover: "", closeOut: "" });
  const [hi, setHi] = useState<HighRiseParams>({ towers: 2, basements: 2, floors: 25, gfa: 60000, pool: true, landHa: 1.5 });
  const [lo, setLo] = useState<LowRiseParams>({ units: 150, phases: 2, landHa: 15.5, parkM2: 10000, clubhouse: true });
  const [hm, setHm] = useState<HangMuc[]>(DEFAULT_HM.high);
  const [errs, setErrs] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState<{ startConstruction: string; openSale: string; handover: string; closeOut: string; note: string } | null>(null);

  useEffect(() => {
    api<{ projects: { params: { anchors: { code: string } } }[] }>("/api/projects").then((d) => setCodes(d.projects.map((p) => p.params.anchors.code)));
    setLoadingCore(true);
    api<{ projects: Core[]; investors: string[]; regions: string[] }>("/api/core-projects").then(setCore).finally(() => setLoadingCore(false));
  }, []);

  const high = isHighType(a.type);
  const params: ProjectParameters = useMemo(() => ({ anchors: a, ...(high ? { high: hi } : { low: lo }), hangMuc: hm }), [a, hi, lo, hm, high]);
  const err = (f: string) => errs.find((e) => e.field === f)?.message;
  const setType = (t: ProjectType) => { setA({ ...a, type: t }); setHm(DEFAULT_HM[isHighType(t) ? "high" : "low"]); setSug(null); };

  const next = () => {
    const e = validateAnchors(a, codes);
    setErrs(e);
    if (e.length) { toast(`Còn ${e.length} trường chưa hợp lệ ở Bước 1`, "err"); return; }
    setStep(2);
  };

  const suggest = async () => {
    const e = validateTech(params);
    setErrs(e);
    if (e.length) return toast("Hãy nhập tham số kỹ thuật hợp lệ trước", "err");
    if (!a.t0) return toast("Cần nhập Ngày bắt đầu dự án (T0) ở Bước 1", "err");
    setBusy(true);
    try { setSug(await api("/api/suggest", { method: "POST", json: params })); } catch (x) { toast((x as Error).message, "err"); } finally { setBusy(false); }
  };

  const create = async () => {
    const e = [...validateAnchors(a, codes), ...validateTech(params)];
    setErrs(e);
    if (e.length) { toast(`Còn ${e.length} trường chưa hợp lệ`, "err"); if (e.some((x) => !["towers", "basements", "floors", "gfa", "landHa", "units", "phases", "parkM2", "high", "low"].includes(x.field))) setStep(1); return; }
    setBusy(true);
    try {
      const r = await api<{ project: { id: string } }>("/api/projects", { method: "POST", json: params });
      toast("Đã khởi tạo MTL — động cơ đã tự sinh tiến độ");
      router.push(`/mtl/${r.project.id}?report=1`);
    } catch (x) {
      if (x instanceof ApiError && (x.data as { errors?: FieldError[] })?.errors) setErrs((x.data as { errors: FieldError[] }).errors);
      toast((x as Error).message, "err");
    } finally { setBusy(false); }
  };

  const prefill = (code: string) => {
    const c = core?.projects.find((p) => p.code === code);
    if (!c) return;
    setA({ ...a, code: c.code, name: c.name, investor: c.investor, region: c.region, type: c.type });
    setHm(DEFAULT_HM[isHighType(c.type) ? "high" : "low"]);
    toast(`Đã điền từ Danh mục Dự án lõi: ${c.code}`);
  };

  if (!can("project.create")) return <Card className="mx-auto max-w-xl p-8 text-center"><h1 className="text-[18px] font-bold">Không đủ quyền</h1><p className="mt-1 text-ink-mute">Vai trò hiện tại không được tạo MTL mới. Dùng nút đổi vai trò ở góc phải trên để thử Admin hoặc Quản trị vùng.</p></Card>;

  const numInput = (label: string, v: number, set: (n: number) => void, f: string, props: { min?: number; max?: number; step?: number; hint?: string; unit?: string }) => (
    <Field label={label} error={err(f)} hint={props.hint} required>
      <div className="relative">
        <input className={cn("input", err(f) && "border-red-400")} type="number" min={props.min} max={props.max} step={props.step ?? 1} value={Number.isFinite(v) ? v : ""} onChange={(e) => set(e.target.value === "" ? NaN : Number(e.target.value))} />
        {props.unit && <span className="pointer-events-none absolute right-3 top-2 text-ink-mute">{props.unit}</span>}
      </div>
    </Field>
  );
  const date = (label: string, f: keyof AnchorParams, hint: string) => (
    <Field label={label} error={err(f)} hint={hint} required>
      <input className={cn("input", err(f) && "border-red-400")} type="date" value={a[f]} onChange={(e) => setA({ ...a, [f]: e.target.value })} />
    </Field>
  );

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageTitle title="Khởi tạo MTL mới" />
      <ol className="mb-5 flex items-center gap-3" aria-label="Các bước">
        {[{ n: 1, t: "Thông tin dự án" }, { n: 2, t: "Tham số kỹ thuật & hạng mục" }].map((s, i) => (
          <li key={s.n} className="flex flex-1 items-center gap-3">
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-full font-bold", step === s.n ? "bg-brand text-white" : step > s.n ? "bg-brand-soft text-brand" : "bg-surface-head text-ink-mute")}>{step > s.n ? <CheckCircle2 className="h-5 w-5" /> : s.n}</div>
            <span className={cn("font-semibold", step === s.n ? "text-ink" : "text-ink-mute")}>{s.t}</span>
            {i === 0 && <div className="h-px flex-1 bg-surface-line" />}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded bg-blue-50 px-3 py-2">
            <div className="flex items-center gap-2 text-blue-700"><Database className="h-4 w-4" /> Tích hợp mô phỏng: điền sẵn từ <b>Danh mục Dự án lõi</b> của Tập đoàn</div>
            <select className="input w-72 bg-white" defaultValue="" onChange={(e) => prefill(e.target.value)} disabled={loadingCore || !core} aria-label="Chọn dự án lõi">
              <option value="">{loadingCore ? "Đang gọi API…" : "— Chọn dự án lõi —"}</option>
              {core?.projects.filter((p) => !codes.includes(p.code)).map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><Field label="1. Tên dự án mới" error={err("name")} hint={`${a.name.length}/150 ký tự`} required><input className={cn("input", err("name") && "border-red-400")} maxLength={150} value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder="Tên thương mại chính thức của dự án" /></Field></div>
            <Field label="2. Mã dự án (Project Code)" error={err("code")} hint="Tối đa 10 ký tự, ví dụ AQC, NWP, GMH" required><input className={cn("input uppercase", err("code") && "border-red-400")} maxLength={10} value={a.code} onChange={(e) => setA({ ...a, code: e.target.value.toUpperCase() })} /></Field>
            <Field label="3. Chủ đầu tư / Pháp nhân" error={err("investor")} hint="Quyết định thẩm quyền người ký duyệt" required>
              <input className={cn("input", err("investor") && "border-red-400")} list="investors" value={a.investor} onChange={(e) => setA({ ...a, investor: e.target.value })} />
              <datalist id="investors">{core?.investors.map((i) => <option key={i} value={i} />)}</datalist>
            </Field>
            <Field label="4. Loại hình dự án" error={err("type")} hint="Quyết định bộ khung WBS mẹ được áp dụng" required>
              <select className="input" value={a.type} onChange={(e) => setType(e.target.value as ProjectType)}>{TYPES.map((t) => <option key={t} value={t}>{PROJECT_TYPE_LABEL[t]}</option>)}</select>
            </Field>
            <Field label="5. Vùng dự án / Địa bàn" error={err("region")} hint="Gắn bộ thủ tục pháp lý và cơ quan thẩm duyệt địa phương" required>
              <select className={cn("input", err("region") && "border-red-400")} value={a.region} onChange={(e) => setA({ ...a, region: e.target.value })}><option value="">— Chọn vùng —</option>{(core?.regions ?? ["TP.HCM", "Đồng Nai", "Bình Thuận", "Bà Rịa - Vũng Tàu"]).map((r) => <option key={r}>{r}</option>)}</select>
            </Field>
            {date("6. Ngày bắt đầu dự án (T₀)", "t0", "Chuẩn bị đầu tư, pháp lý ban đầu tính tịnh tiến (forward) từ mốc này")}
            {date("7. Ngày mục tiêu Khởi công", "startConstruction", "Hệ thống tính lùi các gói GPXD, thiết kế BVTC, đấu thầu móng")}
            {date("8. Ngày mục tiêu Mở bán", "openSale", "Liên kết cứng với hoàn thành phần móng (điều kiện mở bán)")}
            {date("9. Ngày mục tiêu Bàn giao", "handover", "Tính lùi nghiệm thu PCCC, thử liên động, nghiệm thu đưa vào sử dụng")}
            {date("10. Ngày kết thúc hoàn toàn", "closeOut", "Quyết toán, hoàn trả bảo lãnh bảo hành, cấp sổ hồng")}
          </div>
          <div className="mt-5 flex justify-end"><button className="btn-primary" onClick={next}>Tiếp theo: Tham số kỹ thuật <ArrowRight className="h-4 w-4" /></button></div>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2"><h2 className="text-[16px] font-semibold">Tham số kỹ thuật</h2><Badge tone="blue">{PROJECT_TYPE_LABEL[a.type]}</Badge></div>
            {high ? (
              <div className="grid gap-4 md:grid-cols-3">
                {numInput("Số lượng Tháp / Block", hi.towers, (n) => setHi({ ...hi, towers: n }), "towers", { min: 1, max: 10, hint: "1–10. N tháp → nhân bản N nhánh, so le SS + 15 ngày" })}
                <Field label="Số tầng hầm" error={err("basements")} hint="= 0 sẽ ẩn nhánh tường vây, shoring, đào hầm" required>
                  <select className="input" value={hi.basements} onChange={(e) => setHi({ ...hi, basements: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} tầng hầm</option>)}</select>
                </Field>
                {numInput("Số tầng nổi", hi.floors, (n) => setHi({ ...hi, floors: n }), "floors", { min: 5, max: 50, hint: "5–50. Thời lượng thân = số tầng × ngày/sàn" })}
                {numInput("Tổng diện tích sàn GFA", hi.gfa, (n) => setHi({ ...hi, gfa: n }), "gfa", { min: 1000, step: 100, unit: "m²", hint: "Điều chỉnh thời lượng TKCS, thẩm duyệt PCCC, bóc tách" })}
                {numInput("Diện tích lô đất", hi.landHa, (n) => setHi({ ...hi, landHa: n }), "landHa", { min: 0.01, step: 0.1, unit: "ha", hint: "Hệ số ≤1 ha / >1 ha theo template" })}
                <Field label="Hồ bơi nội khu / trên cao"><label className="flex h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#2DB34B]" checked={hi.pool} onChange={(e) => setHi({ ...hi, pool: e.target.checked })} /> Có hồ bơi (kích hoạt nhánh chống thấm, lọc nước, ốp lát)</label></Field>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {numInput("Số lượng căn thấp tầng", lo.units, (n) => setLo({ ...lo, units: n }), "units", { min: 10, max: 2000, hint: "10–2.000 căn" })}
                {numInput("Số phân kỳ / Đợt bàn giao", lo.phases, (n) => setLo({ ...lo, phases: n }), "phases", { min: 1, max: 5, hint: `1–5. Nhân bản ${Number.isFinite(lo.phases) ? lo.phases : "K"} nhánh bàn giao độc lập` })}
                {numInput("Diện tích đất dự án", lo.landHa, (n) => setLo({ ...lo, landHa: n }), "landHa", { min: 0.1, step: 0.1, unit: "ha", hint: "Quyết định thời lượng san lấp, xử lý nền, hạ tầng" })}
                {numInput("Công viên cảnh quan trung tâm", lo.parkM2, (n) => setLo({ ...lo, parkM2: n }), "parkM2", { min: 0, step: 100, unit: "m²", hint: "= 0 sẽ ẩn nhánh cảnh quan" })}
                <Field label="Tuyến cảnh quan / Clubhouse"><label className="flex h-9 items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#2DB34B]" checked={lo.clubhouse} onChange={(e) => setLo({ ...lo, clubhouse: e.target.checked })} /> Có Clubhouse (công trình tiện ích)</label></Field>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-[16px] font-semibold">Hạng mục triển khai</h2>
            <p className="mb-3 text-ink-mute">Các hạng mục lấy từ cột Q–AA của template. Bỏ chọn hạng mục nào thì toàn bộ công việc gắn với hạng mục đó sẽ không được sinh.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {ALL_HM.map((h) => (
                <label key={h} className={cn("flex items-center gap-2 rounded border px-3 py-2", hm.includes(h) ? "border-brand bg-brand-soft" : "border-surface-line")}>
                  <input type="checkbox" className="h-4 w-4 accent-[#2DB34B]" checked={hm.includes(h)} onChange={(e) => setHm(e.target.checked ? [...hm, h] : hm.filter((x) => x !== h))} /> {HANG_MUC_LABEL[h]}
                </label>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-[16px] font-semibold">Gợi ý mốc khả thi</h2><p className="text-ink-mute">Chạy tính xuôi để biết khung thời gian tối thiểu mà tham số này đòi hỏi, tránh xung đột mốc.</p></div>
              <button className="btn-ghost" onClick={suggest} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Tính mốc khả thi</button>
            </div>
            {sug && (
              <div className="mt-3 rounded border border-surface-line p-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  {([["Khởi công", "startConstruction"], ["Mở bán", "openSale"], ["Bàn giao", "handover"], ["Kết thúc", "closeOut"]] as const).map(([l, k]) => (
                    <div key={k}><div className="text-[12px] text-ink-mute">{l} — bạn nhập</div><div className="text-ink-mute line-through">{fmtDate(a[k]) === "—" ? "chưa nhập" : fmtDate(a[k])}</div><div className="font-bold text-brand">{fmtDate(sug[k])}</div></div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-ink-mute">{sug.note}</p>
                <button className="btn-primary mt-2" onClick={() => { setA({ ...a, startConstruction: sug.startConstruction, openSale: sug.openSale, handover: sug.handover, closeOut: sug.closeOut }); setSug(null); toast("Đã áp dụng mốc gợi ý vào Bước 1"); }}>Áp dụng 4 mốc này</button>
              </div>
            )}
          </Card>

          {errs.length > 0 && <Card className="border-red-300 bg-red-50 p-3 text-red-700"><b>Cần sửa:</b> {errs.map((e) => e.message).join(" · ")}</Card>}
          <div className="flex justify-between">
            <button className="btn-ghost" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" /> Quay lại Bước 1</button>
            <button className="btn-primary" onClick={create} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Khởi tạo & tự sinh tiến độ</button>
          </div>
        </div>
      )}
    </div>
  );
}
