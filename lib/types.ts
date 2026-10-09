// ============================================================================
// SCHEMA DEMO — bám sát BRD mục 2 (Projects, ProjectParameters, WBS_Templates,
// Task_Nodes, MTL_Versions, Task_Tracking, Users & RoleMatrix).
// Đây là prototype: lưu bằng JSON, KHÔNG phải thiết kế database chuẩn.
// ============================================================================

export type ProjectType = "high_rise" | "low_rise" | "resort_urban" | "mixed_use";
export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  high_rise: "Chung cư cao tầng",
  low_rise: "Nhà ở thấp tầng",
  resort_urban: "Đô thị nghỉ dưỡng",
  mixed_use: "Phức hợp thương mại",
};
/** Cột hệ số trong template Excel dùng cho từng loại hình */
export type DurationColumn = "low" | "high" | "hotel";

/** 10 trường mỏ neo (BRD 3.1 Bước 1). Ngày dạng ISO yyyy-mm-dd. */
export interface AnchorParams {
  name: string; // 1. Tên dự án mới (<=150)
  code: string; // 2. Mã dự án (<=10)
  investor: string; // 3. Chủ đầu tư / pháp nhân
  type: ProjectType; // 4. Loại hình
  region: string; // 5. Vùng / địa bàn
  t0: string; // 6. Ngày bắt đầu dự án
  startConstruction: string; // 7. Ngày mục tiêu Khởi công
  openSale: string; // 8. Ngày mục tiêu Mở bán
  handover: string; // 9. Ngày mục tiêu Bàn giao
  closeOut: string; // 10. Ngày kết thúc hoàn toàn
}

/** Tham số kỹ thuật Bước 2 (form động theo loại hình) */
export interface HighRiseParams {
  towers: number; // 1-10
  basements: number; // 0-4
  floors: number; // 5-50
  gfa: number; // m2
  pool: boolean; // hồ bơi
  landHa: number; // diện tích lô đất (ha) — dùng cho hệ số template
}
export interface LowRiseParams {
  units: number; // 10-2000
  phases: number; // 1-5
  landHa: number; // ha
  parkM2: number; // công viên cảnh quan trung tâm (m2)
  clubhouse: boolean;
}
/** Hạng mục triển khai (cột Q..AA trong template) bật/tắt khi sinh MTL */
export type HangMuc =
  | "san_lap" | "xu_ly_nen" | "htkt" | "ke" | "coc"
  | "tien_ich" | "canh_quan" | "tram_dien" | "tram_xlnt";
export const HANG_MUC_LABEL: Record<HangMuc, string> = {
  san_lap: "San lấp mặt bằng",
  xu_ly_nen: "Xử lý nền",
  htkt: "Hạ tầng kỹ thuật",
  ke: "Kè",
  coc: "Thi công cọc",
  tien_ich: "Công trình tiện ích",
  canh_quan: "Cảnh quan",
  tram_dien: "Trạm điện",
  tram_xlnt: "Trạm XLNT",
};

export interface ProjectParameters {
  anchors: AnchorParams;
  high?: HighRiseParams;
  low?: LowRiseParams;
  hangMuc: HangMuc[];
}

export type MtlStatus = "draft" | "approval_pending" | "approved" | "cancelled";
export const MTL_STATUS_LABEL: Record<MtlStatus, string> = {
  draft: "Đang soạn thảo",
  approval_pending: "Đang trình E-Approval",
  approved: "Đã duyệt",
  cancelled: "Hủy",
};

/** Thông tin bổ sung của dự án (chức năng "Thông tin dự án") */
export interface ProjectInfo {
  address?: string;
  pm?: string; // người phụ trách (PMD)
  gmd?: string; // Giám đốc điều hành dự án
  link?: string; // trang thông tin chung / hồ sơ dự án
  note?: string;
}

export interface Project {
  id: string;
  params: ProjectParameters;
  info?: ProjectInfo;
  createdAt: string;
  createdBy: string;
  currentVersionId: string;
}

// ----- WBS template (nguồn: Excel, sheet "1.Duration & He so") -----
export type Coef = (number | null)[];
export interface TemplateTask {
  code: string;
  wbs: string;
  name: string;
  level: number;
  parent?: string;
  ban?: string;
  kind: "task" | "periodic" | "summary";
  pred?: { code: string; rel: DepRel };
  buffer?: number;
  maxDays?: number;
  applies: { low: boolean; high: boolean; hotel: boolean };
  base?: { low?: number; high?: number; hotel?: number };
  coef?: {
    low?: { land?: Coef; qty?: Coef; std?: Coef };
    high?: { land?: Coef; floors?: Coef; std?: Coef };
    hotel?: { land?: Coef; rooms?: Coef; std?: Coef };
  };
  hangmuc?: string[];
  /** true nếu task do hệ thống demo bổ sung (KHÔNG có trong Excel) */
  demoSupplement?: boolean;
  /** Tác vụ mới theo mpp 7.10.2026: thời lượng/liên kết là giả định demo (mpp chỉ có cấu trúc) */
  assumed?: boolean;
}

// ----- Task node trong 1 version MTL -----
export type TaskStatus = "closed" | "in_progress" | "done";
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  closed: "Đóng",
  in_progress: "Đang thực hiện",
  done: "Hoàn thành",
};
export type DepRel = "FS" | "SS" | "FF" | "SF";
/** lag > 0 là trễ (lag), lag < 0 là gối đầu (lead). Đơn vị: ngày làm việc */
export interface Dependency {
  predId: string;
  rel: DepRel;
  lag: number;
}

export interface TaskNode {
  id: string; // duy nhất trong version, vd "13.8.1.2@T2"
  templateCode: string;
  wbs: string;
  name: string;
  level: number;
  parentId?: string;
  order: number;
  ban?: string; // phòng ban chịu trách nhiệm (OC 9-4)
  kind: "task" | "periodic" | "summary" | "milestone";
  deps: Dependency[];
  durationDays: number; // ngày làm việc
  baseDays?: number;
  durationNote?: string; // giải thích công thức đã áp dụng
  // kết quả tính lịch
  start?: string;
  finish?: string;
  earlyStart?: string; // lịch sớm nhất (trước khi đặt lại sát hạn)
  earlyFinish?: string;
  lateStart?: string;
  lateFinish?: string;
  floatDays?: number;
  critical?: boolean;
  conflict?: string; // cảnh báo ràng buộc mốc
  copyLabel?: string; // vd "Tháp A", "Phân kỳ 2"
  status: TaskStatus; // Đóng / Đang thực hiện / Hoàn thành
  assigneeTitle?: string; // chức danh chịu trách nhiệm
  tags?: string[];
  anchor?: "T0" | "KC" | "MB" | "BG" | "KT"; // mốc neo
}

export type VersionKind = "draft" | "baseline" | "rev";
export interface MtlVersion {
  id: string;
  projectId: string;
  label: string; // "Bản thảo", "Baseline v1.0", "REV 01"
  kind: VersionKind;
  rev: number;
  status: MtlStatus;
  createdAt: string;
  createdBy: string;
  note?: string;
  tasks: TaskNode[];
  generation?: GenerationReport;
  approval?: { submittedAt: string; ticket: string; approvedAt?: string; approver?: string };
  /** Thẩm định nội bộ trước khi trình duyệt (GIẢ ĐỊNH demo) */
  review?: { result: "passed" | "changes"; by: string; at: string; note?: string };
}

export interface GenerationReport {
  generatedAt: string;
  templateTasks: number;
  included: number;
  removed: number;
  duplicated: number;
  removedByRule: { rule: string; count: number }[];
  duplications: { rule: string; copies: number; addedTasks: number }[];
  warnings: string[];
  projectStart: string;
  projectFinish: string;
  criticalCount: number;
}

// ----- Tracking -----
export interface Evidence {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  at: string;
  by: string;
}
export interface TaskComment {
  id: string;
  at: string;
  by: string;
  role: Role;
  text: string;
}
export interface TaskTracking {
  taskId: string; // `${versionId}:${TaskNode.id}`
  percent: number; // 0..100
  updatedAt?: string;
  updatedBy?: string;
  evidence: Evidence[];
  comments: TaskComment[];
  issue?: string; // nguyên nhân / vướng mắc
  doneAt?: string; // ngày hoàn thành thực tế (yyyy-mm-dd) — dùng đo tính đúng hạn
  quality?: number; // đánh giá chất lượng kết quả 1..5 (BRD 3.4)
}

// ----- Users & RoleMatrix -----
export type Role = "admin" | "region_admin" | "project_admin" | "viewer";
export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  region_admin: "Quản trị vùng",
  project_admin: "Quản trị dự án",
  viewer: "View",
};
export type Permission =
  | "project.create" | "project.edit" | "mtl.generate" | "mtl.edit_task"
  | "mtl.submit_approval" | "mtl.approve" | "mtl.export"
  | "tracking.update" | "tracking.comment"
  | "design.edit" | "fs.edit" | "fs.approve"
  | "template.manage" | "settings.manage" | "users.manage";
export const ALL_PERMISSIONS: { key: Permission; label: string }[] = [
  { key: "project.create", label: "Tạo dự án / MTL mới" },
  { key: "project.edit", label: "Sửa thông tin dự án" },
  { key: "mtl.generate", label: "Sinh lại tiến độ (động cơ)" },
  { key: "mtl.edit_task", label: "Sửa công việc / gán chức danh" },
  { key: "mtl.submit_approval", label: "Trình E-Approval" },
  { key: "mtl.approve", label: "Phê duyệt / hủy MTL" },
  { key: "mtl.export", label: "Xuất MS Project / Excel" },
  { key: "tracking.update", label: "Cập nhật % tiến độ" },
  { key: "tracking.comment", label: "Bình luận & minh chứng" },
  { key: "design.edit", label: "Lập & ban hành nhiệm vụ thiết kế" },
  { key: "fs.edit", label: "Lập FS thực thi (nhập suất đầu tư)" },
  { key: "fs.approve", label: "Chốt FS thực thi & chuyển FPA" },
  { key: "template.manage", label: "Quản trị template & định mức" },
  { key: "settings.manage", label: "Cài đặt hệ thống" },
  { key: "users.manage", label: "Quản lý người dùng & phân quyền" },
];
export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string;
  region?: string;
  projectIds?: string[];
}
export type RoleMatrix = Record<Role, Permission[]>;

// ----- Cấu hình định mức (BRD 3.5) -----
export interface DurationConfig {
  daysPerFloor: number; // mặc định 6 ngày/sàn
  basementBaseCount: number; // template hiệu chỉnh cho N hầm (GIẢ ĐỊNH demo = 2)
  towerStaggerDays: number; // SS + 15 ngày
  phaseStaggerDays: number; // so le giữa các phân kỳ (GIẢ ĐỊNH demo = 60 ngày)
  gfaReference: number; // 60.000 m2
  gfaMin: number;
  gfaMax: number;
  workWeek: 5 | 6;
  includeBuffer: boolean; // cộng "ngày dự phòng" vào thời lượng
  holidays: string[];
}

// ----- Lập nhiệm vụ thiết kế -----
export type BriefStatus = "draft" | "issued" | "confirmed";
export const BRIEF_STATUS_LABEL: Record<BriefStatus, string> = {
  draft: "Đang soạn", issued: "Đã ban hành cho DMD", confirmed: "DMD đã xác nhận",
};
export interface DesignBrief {
  id: string;
  projectId: string;
  branch: string; // mã nhánh DMD trong template, vd "12.3"
  scope: string; // phạm vi công việc thiết kế
  spec: string; // tiêu chuẩn bàn giao, thông số kỹ thuật
  requirements: string; // yêu cầu đặc thù
  consultant: string; // đơn vị tư vấn thiết kế dự kiến
  inputs: string[]; // hồ sơ đầu vào đã có
  status: BriefStatus;
  issuedAt?: string;
  confirmedAt?: string;
  updatedAt: string;
  updatedBy: string;
  history: { at: string; by: string; action: string }[];
}

// ----- Lập FS-ver2 (FS thực thi) -----
export type FsStatus = "draft" | "approved";
export interface FsVersion {
  id: string;
  projectId: string;
  ver: number; // 1, 2, 3…
  label: string; // "FS-Ver2.1"
  status: FsStatus;
  mtlVersionId: string; // MTL làm căn cứ phân bổ thời gian
  rates: Record<string, number>; // suất đầu tư theo nhóm chi phí (GIẢ ĐỊNH demo)
  createdAt: string;
  createdBy: string;
  approvedAt?: string;
  approvedBy?: string;
  sentFpaAt?: string; // thời điểm chuyển FPA (Capex)
  note?: string;
}

export interface Db {
  projects: Project[];
  designBriefs: DesignBrief[];
  fsVersions: FsVersion[];
  versions: MtlVersion[];
  tracking: TaskTracking[];
  users: User[];
  roleMatrix: RoleMatrix;
  config: DurationConfig;
  templateOverrides: Record<string, { baseHigh?: number; baseLow?: number }>;
  auditLog: { at: string; by: string; action: string; detail?: string }[];
}
