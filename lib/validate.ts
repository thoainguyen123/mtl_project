// Kiểm tra dữ liệu Form 2 bước (BRD 3.1). Trả về danh sách lỗi theo trường.
import type { ProjectParameters } from "@/lib/types";

export interface FieldError { field: string; message: string }

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const inRange = (v: unknown, a: number, b: number) => typeof v === "number" && Number.isFinite(v) && v >= a && v <= b;

export function validateAnchors(a: ProjectParameters["anchors"], existingCodes: string[] = []): FieldError[] {
  const e: FieldError[] = [];
  const req = (f: keyof typeof a, label: string) => { if (!String(a[f] ?? "").trim()) e.push({ field: String(f), message: `${label} là bắt buộc` }); };
  req("name", "Tên dự án"); req("code", "Mã dự án"); req("investor", "Chủ đầu tư / Pháp nhân");
  req("type", "Loại hình dự án"); req("region", "Vùng dự án");
  if (a.name && a.name.length > 150) e.push({ field: "name", message: "Tên dự án tối đa 150 ký tự" });
  if (a.code && !/^[A-Za-z0-9]{1,10}$/.test(a.code)) e.push({ field: "code", message: "Mã dự án tối đa 10 ký tự chữ/số, không dấu" });
  if (a.code && existingCodes.map((c) => c.toUpperCase()).includes(a.code.toUpperCase())) e.push({ field: "code", message: "Mã dự án đã tồn tại" });
  const dates: [keyof typeof a, string][] = [["t0", "Ngày bắt đầu dự án (T0)"], ["startConstruction", "Ngày mục tiêu Khởi công"], ["openSale", "Ngày mục tiêu Mở bán"], ["handover", "Ngày mục tiêu Bàn giao"], ["closeOut", "Ngày kết thúc hoàn toàn"]];
  for (const [f, l] of dates) {
    if (!String(a[f] ?? "")) e.push({ field: String(f), message: `${l} là bắt buộc` });
    else if (!isIso(String(a[f]))) e.push({ field: String(f), message: `${l} không đúng định dạng ngày` });
  }
  if (!e.some((x) => dates.some(([f]) => f === x.field))) {
    if (a.startConstruction <= a.t0) e.push({ field: "startConstruction", message: "Khởi công phải sau T0" });
    if (a.openSale < a.startConstruction) e.push({ field: "openSale", message: "Mở bán phải từ ngày Khởi công trở đi" });
    if (a.handover <= a.openSale) e.push({ field: "handover", message: "Bàn giao phải sau Mở bán" });
    if (a.closeOut <= a.handover) e.push({ field: "closeOut", message: "Kết thúc hoàn toàn phải sau Bàn giao" });
  }
  return e;
}

export function validateTech(p: ProjectParameters): FieldError[] {
  const e: FieldError[] = [];
  const t = p.anchors.type;
  if (t === "high_rise" || t === "mixed_use") {
    const h = p.high;
    if (!h) return [{ field: "high", message: "Thiếu tham số kỹ thuật cao tầng" }];
    if (!inRange(h.towers, 1, 10) || !Number.isInteger(h.towers)) e.push({ field: "towers", message: "Số tháp từ 1 đến 10" });
    if (!inRange(h.basements, 0, 4) || !Number.isInteger(h.basements)) e.push({ field: "basements", message: "Số tầng hầm từ 0 đến 4" });
    if (!inRange(h.floors, 5, 50) || !Number.isInteger(h.floors)) e.push({ field: "floors", message: "Số tầng nổi từ 5 đến 50" });
    if (!inRange(h.gfa, 1000, 5_000_000)) e.push({ field: "gfa", message: "GFA phải lớn hơn 1.000 m²" });
    if (!inRange(h.landHa, 0.01, 1000)) e.push({ field: "landHa", message: "Diện tích lô đất (ha) không hợp lệ" });
  } else {
    const l = p.low;
    if (!l) return [{ field: "low", message: "Thiếu tham số kỹ thuật thấp tầng" }];
    if (!inRange(l.units, 10, 2000) || !Number.isInteger(l.units)) e.push({ field: "units", message: "Số căn từ 10 đến 2.000" });
    if (!inRange(l.phases, 1, 5) || !Number.isInteger(l.phases)) e.push({ field: "phases", message: "Số phân kỳ từ 1 đến 5" });
    if (!inRange(l.landHa, 0.1, 5000)) e.push({ field: "landHa", message: "Diện tích đất (ha) không hợp lệ" });
    if (!inRange(l.parkM2, 0, 1_000_000)) e.push({ field: "parkM2", message: "Diện tích công viên không hợp lệ" });
    if (l.units < l.phases) e.push({ field: "phases", message: "Số phân kỳ không được vượt số căn" });
  }
  return e;
}

export function validateParams(p: ProjectParameters, existingCodes: string[] = []): FieldError[] {
  return [...validateAnchors(p.anchors, existingCodes), ...validateTech(p)];
}
