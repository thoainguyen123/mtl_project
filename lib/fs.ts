// Lập FS-ver2 (FS thực thi) — GIẢ ĐỊNH DEMO (chưa có đặc tả trong BRD).
// Căn cứ: node 4.0.2.1 "Lập/Cập nhật FS thực thi - [Số phiên bản]". Giả định: FS-ver2 = dự toán chi phí đầu tư
// theo nhóm (suất đầu tư × quy mô), phân bổ theo tháng dựa trên mốc của MTL, sau khi chốt thì chuyển FPA (Capex).
// Suất đầu tư dưới đây là SỐ MINH HỌA, không phải định mức thật.
import type { AnchorParams, Project } from "@/lib/types";

export interface CostGroup { key: string; label: string; unit: string; from: keyof AnchorParams; to: keyof AnchorParams; defaultRate: number }

/** Đơn vị: triệu đồng / m² quy mô (GFA, hoặc diện tích sàn quy đổi cho thấp tầng) */
export const COST_GROUPS: CostGroup[] = [
  { key: "land", label: "Chi phí đất & GPMB", unit: "tr.đ/m²", from: "t0", to: "startConstruction", defaultRate: 6.0 },
  { key: "design", label: "Thiết kế & tư vấn", unit: "tr.đ/m²", from: "t0", to: "startConstruction", defaultRate: 0.6 },
  { key: "infra", label: "Hạ tầng kỹ thuật", unit: "tr.đ/m²", from: "startConstruction", to: "openSale", defaultRate: 1.2 },
  { key: "build", label: "Xây lắp", unit: "tr.đ/m²", from: "startConstruction", to: "handover", defaultRate: 9.0 },
  { key: "sales", label: "Bán hàng & marketing", unit: "tr.đ/m²", from: "openSale", to: "handover", defaultRate: 1.0 },
  { key: "pm", label: "Quản lý dự án", unit: "tr.đ/m²", from: "t0", to: "closeOut", defaultRate: 0.5 },
  { key: "contingency", label: "Dự phòng", unit: "tr.đ/m²", from: "startConstruction", to: "handover", defaultRate: 0.8 },
];

export const defaultRates = (): Record<string, number> => Object.fromEntries(COST_GROUPS.map((g) => [g.key, g.defaultRate]));

/** Quy mô để nhân suất đầu tư: GFA (cao tầng) hoặc số căn × 250 m² sàn bình quân (thấp tầng — giả định) */
export function scaleOf(p: Project): { value: number; note: string } {
  if (p.params.high) return { value: p.params.high.gfa, note: "GFA" };
  if (p.params.low) return { value: p.params.low.units * 250, note: `${p.params.low.units.toLocaleString("vi-VN")} căn × 250 m² sàn bình quân (giả định)` };
  return { value: 0, note: "" };
}

const monthKey = (iso: string) => iso.slice(0, 7);
function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let y = +a.slice(0, 4), m = +a.slice(5, 7);
  const ey = +b.slice(0, 4), em = +b.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  return out;
}

export interface FsComputed {
  scale: number;
  lines: { key: string; label: string; unit: string; rate: number; total: number; from: string; to: string }[];
  total: number;
  months: string[];
  /** monthly[groupKey][i] = chi phí tháng i (triệu đồng) */
  monthly: Record<string, number[]>;
  monthTotals: number[];
  cumulative: number[];
}

/** `anchors` lấy từ MTL (mốc đã duyệt/hiện hành) — phân bổ đều theo tháng trong cửa sổ của từng nhóm */
export function computeFs(scale: number, rates: Record<string, number>, anchors: AnchorParams): FsComputed {
  const months = monthsBetween(monthKey(anchors.t0), monthKey(anchors.closeOut));
  const monthly: Record<string, number[]> = {};
  const lines = COST_GROUPS.map((g) => {
    const rate = rates[g.key] ?? g.defaultRate;
    const total = Math.round(rate * scale);
    const from = String(anchors[g.from]), to = String(anchors[g.to]);
    const win = monthsBetween(monthKey(from), monthKey(to));
    const arr = months.map(() => 0);
    win.forEach((mk) => { const i = months.indexOf(mk); if (i >= 0) arr[i] = total / win.length; });
    monthly[g.key] = arr.map((x) => Math.round(x));
    return { key: g.key, label: g.label, unit: g.unit, rate, total, from, to };
  });
  const monthTotals = months.map((_, i) => lines.reduce((s, l) => s + monthly[l.key][i], 0));
  let acc = 0;
  const cumulative = monthTotals.map((x) => (acc += x));
  return { scale, lines, total: lines.reduce((s, l) => s + l.total, 0), months, monthly, monthTotals, cumulative };
}
