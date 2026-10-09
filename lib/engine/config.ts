import type { DurationConfig } from "@/lib/types";
import { DEFAULT_HOLIDAYS } from "./calendar";

/** Cấu hình định mức mặc định (BRD 3.5). Các giá trị đánh dấu GIẢ ĐỊNH cần PMO xác nhận. */
export const DEFAULT_CONFIG: DurationConfig = {
  daysPerFloor: 6, // BRD 3.5: mặc định 6 ngày / sàn
  basementBaseCount: 2, // GIẢ ĐỊNH: định mức template hiệu chỉnh cho 2 tầng hầm (BRD ghi mặc định 2 hầm)
  towerStaggerDays: 15, // BRD 3.1: SS + 15 ngày giữa các tháp
  phaseStaggerDays: 60, // GIẢ ĐỊNH demo: BRD chưa quy định độ lệch giữa các phân kỳ
  gfaReference: 60000, // BRD 3.1: GFA mặc định 60.000 m2
  gfaMin: 0.8,
  gfaMax: 1.5,
  workWeek: 6,
  includeBuffer: false,
  holidays: DEFAULT_HOLIDAYS,
};

/** Chức danh mặc định theo Ban/Phòng (OC 9-4). Danh sách chỉ phục vụ demo. */
export const TITLES: string[] = [
  "GĐ/PGĐ Phòng Quản lý Xây dựng, An toàn và Môi trường",
  "Trưởng phòng Quản lý Xây dựng, An toàn và Môi trường",
  "Trưởng bộ phận Quản lý Xây dựng",
  "Trưởng bộ phận Quản lý Cơ điện",
  "Trưởng bộ phận Quản lý Hạ tầng kỹ thuật",
  "Kỹ sư cao cấp Giám sát Xây dựng",
  "Kỹ sư cao cấp Giám sát Cơ điện",
  "Kỹ sư cao cấp Giám sát Hạ tầng kỹ thuật",
  "Kỹ sư cao cấp Kiểm soát Chất lượng và tiến độ",
  "Kiến trúc sư cao cấp Công trường",
  "Chuyên viên PMD (Quản lý dự án)",
  "Chuyên viên PLP (Pháp lý)",
  "Chuyên viên DMD (Quản lý thiết kế)",
  "Chuyên viên PTC (Cung ứng - Đấu thầu)",
  "Chuyên viên QSB (Khối lượng - Ngân sách)",
  "Chuyên viên SAC (Kinh doanh)",
  "Chuyên viên MAR (Marketing)",
  "Chuyên viên FAC (Tài chính - Kế toán)",
  "Chuyên viên OM (Vận hành)",
  "Chuyên viên CSC (Bồi thường - GPMB)",
];

const BY_BAN: Record<string, string> = {
  PCD: "Trưởng bộ phận Quản lý Xây dựng",
  PLP: "Chuyên viên PLP (Pháp lý)",
  DMD: "Chuyên viên DMD (Quản lý thiết kế)",
  PMD: "Chuyên viên PMD (Quản lý dự án)",
  PTC: "Chuyên viên PTC (Cung ứng - Đấu thầu)",
  QSB: "Chuyên viên QSB (Khối lượng - Ngân sách)",
  SAC: "Chuyên viên SAC (Kinh doanh)",
  MAR: "Chuyên viên MAR (Marketing)",
  FAC: "Chuyên viên FAC (Tài chính - Kế toán)",
  OM: "Chuyên viên OM (Vận hành)",
  CSC: "Chuyên viên CSC (Bồi thường - GPMB)",
};
export function defaultTitle(ban?: string): string | undefined {
  return ban ? BY_BAN[ban] : undefined;
}
