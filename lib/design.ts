// Lập nhiệm vụ thiết kế — GIẢ ĐỊNH DEMO (chưa có đặc tả trong BRD).
// Căn cứ: node 4.0.3.1 "Lập nhiệm vụ thiết kế - [Tên hạng mục]" và nhánh DMD 12.x trong template MTL.
// Mỗi dự án có 1 nhiệm vụ thiết kế cho mỗi bộ môn áp dụng; nội dung gợi ý tự điền từ tham số dự án.
import type { DesignBrief, Project } from "@/lib/types";

export const DISCIPLINES: { branch: string; name: string; high: boolean; low: boolean; inputs: string[] }[] = [
  { branch: "12.1", name: "Thiết kế Quy hoạch", high: false, low: true, inputs: ["Quy hoạch 1/500 được duyệt", "Hồ sơ khảo sát địa hình"] },
  { branch: "12.2", name: "Thiết kế hạ tầng kỹ thuật", high: false, low: true, inputs: ["Quy hoạch 1/500 được duyệt", "Thỏa thuận đấu nối điện, nước, thoát nước"] },
  { branch: "12.3", name: "Thiết kế Kiến trúc", high: true, low: true, inputs: ["Quy hoạch tổng mặt bằng", "Định hướng sản phẩm (PKD/Marketing)"] },
  { branch: "12.4", name: "Thiết kế Cơ điện", high: true, low: true, inputs: ["Hồ sơ thiết kế cơ sở kiến trúc", "Thỏa thuận cấp điện, PCCC"] },
  { branch: "12.5", name: "Thiết kế Kết cấu", high: true, low: true, inputs: ["Hồ sơ khảo sát địa chất", "Hồ sơ kiến trúc"] },
  { branch: "12.6", name: "Thiết kế Cảnh quan", high: true, low: true, inputs: ["Tổng mặt bằng", "Chủ đề cảnh quan (Marketing)"] },
  { branch: "12.7", name: "Thiết kế Nội thất", high: true, low: false, inputs: ["Hồ sơ kiến trúc", "Concept căn hộ mẫu"] },
  { branch: "12.8", name: "Thiết kế công viên Chủ đề", high: false, low: true, inputs: ["Chủ đề công viên", "Quy hoạch phân khu"] },
  { branch: "12.9", name: "Thiết kế khác", high: true, low: true, inputs: [] },
];

const n = (v: number | undefined) => (v ?? 0).toLocaleString("vi-VN");

/** Nội dung gợi ý điền sẵn cho từng bộ môn, dựa trên tham số dự án */
function suggest(p: Project, branch: string): { scope: string; spec: string; requirements: string } {
  const a = p.params.anchors;
  const h = p.params.high;
  const l = p.params.low;
  const size = h ? `${h.towers} tháp, ${h.floors} tầng nổi, ${h.basements} tầng hầm, GFA ${n(h.gfa)} m²` : l ? `${n(l.units)} căn, ${l.phases} phân kỳ, ${l.landHa} ha` : "";
  const base = `Dự án ${a.code} — ${a.name} (${size}).`;
  const map: Record<string, { scope: string; spec: string; requirements: string }> = {
    "12.1": { scope: `${base} Lập quy hoạch chi tiết 1/500 toàn dự án, phân khu chức năng, giao thông nội khu.`, spec: "Hồ sơ trình thẩm định theo quy định quy hoạch; bản vẽ CAD + thuyết minh.", requirements: "Chỉ tiêu mật độ xây dựng, hệ số sử dụng đất theo quy hoạch phân khu." },
    "12.2": { scope: `${base} Thiết kế hạ tầng kỹ thuật: giao thông, cấp thoát nước, cấp điện, chiếu sáng, thông tin.`, spec: "Thiết kế cơ sở và thiết kế kỹ thuật theo phân kỳ đầu tư.", requirements: "Phối hợp đấu nối hạ tầng khu vực; ưu tiên phân kỳ đầu tư hạ tầng theo kế hoạch mở bán." },
    "12.3": { scope: `${base} Thiết kế kiến trúc từ thiết kế cơ sở đến thiết kế bản vẽ thi công.`, spec: "Hồ sơ thiết kế cơ sở, kỹ thuật, bản vẽ thi công; mô hình BIM mức LOD 300.", requirements: h ? `Căn hộ điển hình, mặt đứng nhận diện thương hiệu; phối hợp ${h.basements} tầng hầm.` : "Mẫu nhà điển hình theo định hướng sản phẩm; tối đa số mẫu theo yêu cầu kinh doanh." },
    "12.4": { scope: `${base} Thiết kế điện, nước, thông gió, điều hòa, PCCC, điện nhẹ.`, spec: "Hồ sơ thiết kế kỹ thuật + bản vẽ thi công; thẩm duyệt PCCC.", requirements: "Tối ưu chi phí vận hành; thống nhất hệ thống với đơn vị vận hành (OM)." },
    "12.5": { scope: `${base} Thiết kế móng, kết cấu thân, kết cấu hầm.`, spec: "Hồ sơ thiết kế kỹ thuật + bản vẽ thi công; thẩm tra kết cấu.", requirements: h ? `Giải pháp móng phù hợp địa chất, ${h.basements} tầng hầm.` : "Giải pháp móng phù hợp địa chất nền, tối ưu theo mẫu nhà lặp lại." },
    "12.6": { scope: `${base} Thiết kế cảnh quan nội khu, tiện ích và không gian công cộng.`, spec: "Hồ sơ thiết kế kỹ thuật + bản vẽ thi công; danh mục cây xanh, vật liệu.", requirements: "Thống nhất chủ đề cảnh quan với Marketing; chi phí đầu tư theo ngân sách FS." },
    "12.7": { scope: `${base} Thiết kế nội thất căn hộ mẫu, sảnh, tiện ích chung.`, spec: "Hồ sơ concept, thiết kế chi tiết, danh mục vật liệu thiết bị.", requirements: "Hoàn thành trước thời điểm mở bán để thi công căn hộ mẫu." },
    "12.8": { scope: `${base} Thiết kế công viên chủ đề, các hạng mục vui chơi và vận hành.`, spec: "Hồ sơ concept, thiết kế cơ sở, thiết kế thi công.", requirements: l ? `Diện tích công viên ${n(l.parkM2)} m²; định hướng vận hành sau bàn giao.` : "Theo định hướng sản phẩm." },
    "12.9": { scope: `${base} Các hạng mục thiết kế khác phát sinh (biển báo, mô hình, quầy bán hàng...).`, spec: "Theo từng hạng mục cụ thể.", requirements: "Ban hành bổ sung khi có yêu cầu." },
  };
  return map[branch];
}

export function defaultBriefs(p: Project, by: string): DesignBrief[] {
  const isHigh = p.params.anchors.type === "high_rise" || p.params.anchors.type === "mixed_use";
  const now = new Date().toISOString();
  return DISCIPLINES.filter((d) => (isHigh ? d.high : d.low)).map((d) => ({
    id: `db-${p.id}-${d.branch}`, projectId: p.id, branch: d.branch, ...suggest(p, d.branch),
    consultant: "", inputs: d.inputs, status: "draft" as const, updatedAt: now, updatedBy: by,
    history: [{ at: now, by, action: "Khởi tạo từ tham số dự án" }],
  }));
}
