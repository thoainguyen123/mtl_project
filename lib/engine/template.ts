import raw from "@/data/wbs-template.json";
import type { TemplateTask, DepRel } from "@/lib/types";

// ============================================================================
// WBS TEMPLATE CHUẨN (nguồn: Excel "2. TIEN DO & CAU TRUC DATA", sheet 1.Duration & He so)
// + một số tác vụ MINH HỌA do demo bổ sung để chứng minh quy tắc "hầm = 0" (BRD 3.2.1).
//   Các tác vụ bổ sung được đánh dấu demoSupplement = true và hiển thị rõ trên UI.
// ============================================================================

const base = (raw as unknown as { tasks: TemplateTask[] }).tasks;

/** Tác vụ minh họa (KHÔNG có trong Excel) — nhánh tường vây / shoring / đào hầm, chỉ cao tầng */
const SUP_APPLIES = { low: false, high: true, hotel: false };
const sup = (
  n: number, name: string, base_: number, pred: { code: string; rel: DepRel } | undefined,
  hangmuc: string[] = ["coc"],
): TemplateTask => ({
  code: `13.6.1.${100 + n}`,
  wbs: `4.3.6.1.${100 + n}`,
  name,
  level: 5,
  parent: "13.6.1",
  ban: "PCD",
  kind: "task",
  pred,
  applies: SUP_APPLIES,
  base: { high: base_ },
  hangmuc,
  demoSupplement: true,
});

export const DEMO_SUPPLEMENT: TemplateTask[] = [
  // Chạy song song với thi công cọc (cùng chờ xử lý nền 13.3.1.1)
  sup(1, "Thi công tường vây Barrette tầng hầm", 60, { code: "13.3.1.1", rel: "FS" }),
  sup(2, "Thi công cột Kingpost", 30, { code: "13.6.1.101", rel: "SS" }),
  sup(3, "Đào đất hầm (top-down)", 60, { code: "13.6.1.101", rel: "FS" }),
  sup(4, "Thi công hệ giằng Shoring", 40, { code: "13.6.1.103", rel: "SS" }),
  sup(5, "Chống thấm ngược tầng hầm", 30, { code: "13.6.1.103", rel: "FS" }),
  sup(6, "Quan trắc chuyển vị sâu (hầm ≥ 2)", 90, { code: "13.6.1.103", rel: "SS" }),
  sup(7, "Thí nghiệm bơm hạ mực nước ngầm (hầm ≥ 2)", 20, { code: "13.6.1.101", rel: "FS" }),
];

/** Quan hệ phụ (ngoài `pred` đơn trong Excel) — chỉ có hiệu lực khi tác vụ nguồn còn tồn tại */
export const EXTRA_PREDS: Record<string, { code: string; rel: DepRel }[]> = {
  "13.8.1.1": [{ code: "13.6.1.103", rel: "FS" }], // kết cấu phần ngầm sau khi đào hầm
};

export const TEMPLATE: TemplateTask[] = [...base, ...DEMO_SUPPLEMENT];

export const BY_CODE = new Map<string, TemplateTask>(TEMPLATE.map((t) => [t.code, t]));

// Chuẩn hóa mã WBS HIỂN THỊ: trong Excel chỉ một số dòng có tiền tố mã trong tên (vd "9.1 BAN NHÂN SỰ", "4.3.8.1 ...").
// Dòng không có tiền tố được suy ra từ mã hiển thị của cha + số thứ tự cuối => cây mã nhất quán (9.1 -> 9.1.1 -> 9.1.1.3).
for (const t of TEMPLATE) {
  if (t.wbs !== t.code || !t.parent) continue;
  const parent = BY_CODE.get(t.parent);
  if (parent) t.wbs = `${parent.wbs}.${t.code.split(".").pop()}`;
}
export const ORDER = new Map<string, number>(TEMPLATE.map((t, i) => [t.code, i]));

export const CHILDREN = new Map<string, TemplateTask[]>();
for (const t of TEMPLATE) {
  const k = t.parent ?? "__root__";
  if (!CHILDREN.has(k)) CHILDREN.set(k, []);
  CHILDREN.get(k)!.push(t);
}
// Tác vụ bổ sung xếp sau 13.6.1.4 để giữ thứ tự hiển thị hợp lý
for (const arr of CHILDREN.values()) arr.sort((a, b) => (ORDER.get(a.code)! - ORDER.get(b.code)!));

const DESC_CACHE = new Map<string, TemplateTask[]>();
export function descendants(code: string): TemplateTask[] {
  const hit = DESC_CACHE.get(code);
  if (hit) return hit;
  const out: TemplateTask[] = [];
  const walk = (c: string) => {
    for (const k of CHILDREN.get(c) ?? []) {
      out.push(k);
      walk(k.code);
    }
  };
  walk(code);
  DESC_CACHE.set(code, out);
  return out;
}

// ----------------------------------------------------------------------------
// GẮN THẺ (tag) theo quy tắc nghiệp vụ — dùng để lọc theo tham số
// ----------------------------------------------------------------------------
const RE = {
  basement: /tầng hầm|đào đất hầm|tường vây|barrette|kingpost|shoring|chống thấm ngược|phần ngầm/i,
  basementDeep: /quan trắc chuyển vị sâu|hạ mực nước/i,
  pool: /hồ bơi|bể bơi/i,
  gpxd: /cấp giấy phép xây dựng/i,
  bvtc: /thiết kế bản vẽ thi công/i,
  openSale: /công tác mở bán|đề xuất mở bán/i,
  closeout: /quyết toán|sổ hồng|cấp giấy chứng nhận|hoàn trả bảo lãnh|bảo hành/i,
};

export function tagsOf(t: TemplateTask): string[] {
  const tags: string[] = [];
  const text = `${t.name}`;
  if (t.code.startsWith("13.8")) tags.push("highrise_branch");
  if (t.code.startsWith("13.7")) tags.push("lowrise_branch");
  if (RE.basement.test(text) && (t.code.startsWith("13.6") || t.code.startsWith("13.8"))) tags.push("basement");
  if (RE.basementDeep.test(text)) tags.push("basement_deep");
  if (RE.pool.test(text)) tags.push("pool");
  if (t.kind === "task" && RE.gpxd.test(text) && !/điều chỉnh/i.test(text)) tags.push("gate_kc");
  if (t.kind === "task" && RE.bvtc.test(text) && (t.ban === "DMD")) tags.push("gate_kc");
  if (t.kind === "task" && RE.openSale.test(text)) tags.push("open_sale");
  if (t.code.startsWith("13.12.")) tags.push("handover_chain");
  if (t.kind === "task" && RE.closeout.test(text) && !/^1[34]\./.test(t.code)) tags.push("closeout");
  if (["13.6.1.2", "13.6.1.4", "13.8.1.1"].includes(t.code)) tags.push("foundation");
  if (/^13\.1\./.test(t.code) && t.kind === "task") tags.push("site_prep");
  if (/^14(\.|$)/.test(t.code)) tags.push("post_project"); // vận hành (OM): diễn ra sau Bàn giao
  if (/thiết kế cơ sở|TKCS|thẩm duyệt PCCC|bóc tách|tiên lượng/i.test(text)) tags.push("gfa_scaled");
  return tags;
}

export const TAGS = new Map<string, string[]>(TEMPLATE.map((t) => [t.code, tagsOf(t)]));
