"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import templateData from "./mtl-template.json";
import dependencyData from "./mtl-dependencies.json";
import { parseMSProjectXML, type ParsedProjectData } from "./xml-parser";
import { DEFAULT_PROJECT_PARAMETERS, generateParameterizedMTL, type ParameterImpact, type ProjectParameters } from "./mtl-parameter-engine";
import { CORE_MILESTONE_CODES, KEY_MILESTONES, createInitialSampleSchedule, type MilestoneDates, type MilestoneSources } from "./mtl-milestones";

type WorkType = "" | "Báo cáo định kỳ" | "Tracking công việc";

type DemoAccount = {
  username: string;
  password: string;
  name: string;
  role: string;
  initials: string;
  email?: string;
  badge?: string;
  badgeType?: "blue" | "green" | "purple" | "orange" | "cyan";
  system?: "gmd" | "hrc" | "admin";
  desc?: string;
};

type TemplateTask = {
  id: number;
  code: string;
  parentCode: string | null;
  groupCode: string;
  name: string;
  level: number;
  summary: boolean;
  defaultDuration: number;
  gmdReport?: string;
  workGroup?: WorkType;
  notes?: string;
  custom?: boolean;
};

type TaskEdit = {
  startDate?: string;
  endDate?: string;
  duration?: number;
  pic?: string;
  status?: "Đang thực hiện" | "Đóng" | "Hoàn thành" | "Trễ hạn";
  actualProgress?: number;
  actualStartDate?: string;
  actualEndDate?: string;
  actualNote?: string;
};

type TaskDependency = {
  predecessorCode: string;
  type: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
};

type DefaultTaskDependency = TaskDependency & { successorCode: string };

/* Vòng đời MTL theo SOP06 mục 6.1:
   lập (B3-5) → GMD kiểm soát (B6) → GMS.P thẩm định (B7) → trình E-Approval (B8-9) → duyệt chính thức.
   "appraised" tách riêng khỏi "approved" vì thẩm định không phải là phê duyệt. */
type ApprovalStatus = "draft" | "gmd_review" | "gmd_returned" | "submitted" | "changes_requested" | "appraised" | "approved";
type DepartmentApprovalStatus = "pending" | "approved" | "changes_requested";

type DepartmentApproval = {
  reviewer: string;
  status: DepartmentApprovalStatus;
  note: string;
  reviewedAt?: string;
};

type Project = {
  id: string;
  name: string;
  code: string;
  type: string;
  investor?: string;
  location: string;
  area?: string;
  region?: string;
  group?: string;
  startDate: string;
  targetDate: string;
  parameters: ProjectParameters;
  parameterImpacts: ParameterImpact[];
  milestoneDates: MilestoneDates;
  milestoneSources?: MilestoneSources;
  selectedGroups: string[];
  createdAt: string;
  taskEdits: Record<string, TaskEdit>;
  taskDependencies: Record<string, TaskDependency[]>;
  customTasks: TemplateTask[];
  includedTaskCodes: string[];
  departmentApprovals: Record<string, DepartmentApproval>;
  approvalStatus: ApprovalStatus;
  designTaskStatus?: "chua_lap" | "dang_lap" | "pbcm_gop_y" | "da_duyet";
  fsStatus?: "chua_lap" | "dang_tinh_toan" | "cho_doi_chieu" | "da_duyet";
  gmdSubmittedAt?: string;
  gmdReviewer?: string;
  gmdNote?: string;
  gmdReviewedAt?: string;
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  reviewedAt?: string;
  approvedVersion?: string;
  reviewNote?: string;
  isOfficialApproved?: boolean;
  eApprovalCode?: string;
  eApprovalUrl?: string;
  eApprovalDate?: string;
  eApprovalSigner?: string;
  eApprovalNote?: string;
  officialVersion?: string;
  baselineLocked?: boolean;
};

type ProjectForm = Pick<Project, "name" | "code" | "type" | "investor" | "location" | "startDate" | "targetDate" | "area" | "region" | "group"> & {
  version?: string;
  parameters: ProjectParameters;
  milestoneDates: MilestoneDates;
};

type ScheduledTask = TemplateTask & {
  startDate: string;
  endDate: string;
  duration: number;
  left: number;
  width: number;
  pic: string;
  status: NonNullable<TaskEdit["status"]>;
  predecessors: TaskDependency[];
  dependencyConflict?: string;
  suggestedStartDate?: string;
  actualProgress: number;
  actualStartDate?: string;
  actualEndDate?: string;
  actualStatus: "Chưa bắt đầu" | "Đang thực hiện" | "Hoàn thành" | "Trễ hạn";
  actualNote?: string;
};

type TaskForm = {
  groupCode: string;
  parentCode: string;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  status: NonNullable<TaskEdit["status"]>;
  predecessorCodes: string[];
  addToCurrent: boolean;
};

const TEMPLATE = templateData as TemplateTask[];
const DEFAULT_DEPENDENCIES = dependencyData as DefaultTaskDependency[];
const STORAGE_KEY = "mtl-workspace-projects-v1";
const ACTIVE_KEY = "mtl-workspace-active-project-v1";
const CATALOG_KEY = "mtl-workspace-custom-catalog-v1";
const CATALOG_ENABLED_KEY = "mtl-workspace-enabled-catalog-v2";
const CATALOG_WORK_TYPE_KEY = "mtl-workspace-catalog-work-type-v1";
const SESSION_KEY = "mtl-workspace-session-v1";

const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    username: "gmd.gdb@novaland.com.vn",
    password: "MTL@2026",
    name: "Giám đốc Ban điều hành dự án",
    role: "Giám đốc Ban điều hành dự án",
    initials: "GD",
    email: "gmd.gdb@novaland.com.vn",
    badge: "",
    badgeType: "blue",
    system: "gmd",
    desc: "",
  },
  {
    username: "gmd.pgd@novaland.com.vn",
    password: "MTL@2026",
    name: "Phó giám đốc Phòng điều hành dự án",
    role: "Phó giám đốc Phòng điều hành dự án",
    initials: "PG",
    email: "gmd.pgd@novaland.com.vn",
    badge: "",
    badgeType: "orange",
    system: "gmd",
    desc: "",
  },
  {
    username: "gmd.tpcc@novaland.com.vn",
    password: "MTL@2026",
    name: "Trưởng phòng cao cấp Quản lý dự án",
    role: "Trưởng phòng cao cấp Quản lý dự án",
    initials: "TP",
    email: "gmd.tpcc@novaland.com.vn",
    badge: "",
    badgeType: "green",
    system: "gmd",
    desc: "",
  },
  {
    username: "gmd.tp@novaland.com.vn",
    password: "MTL@2026",
    name: "Trưởng phòng Quản lý dự án",
    role: "Trưởng phòng Quản lý dự án",
    initials: "TP",
    email: "gmd.tp@novaland.com.vn",
    badge: "",
    badgeType: "cyan",
    system: "gmd",
    desc: "",
  },
  {
    username: "itd.admin@novagroup.vn",
    password: "MTL@2026",
    name: "Admin hệ thống",
    role: "Admin hệ thống",
    initials: "AD",
    email: "itd.admin@novagroup.vn",
    badge: "",
    badgeType: "purple",
    system: "admin",
    desc: "",
  },
  {
    username: "hrc.tp@novagroup.vn",
    password: "MTL@2026",
    name: "Phạm Thu H",
    role: "Trưởng Ban Nhân sự",
    initials: "PH",
    email: "hrc.tp@novagroup.vn",
    badge: "Trưởng phòng",
    badgeType: "blue",
    system: "hrc",
    desc: "Ban Nhân sự · phụ trách định biên nhân sự và phê duyệt kế hoạch",
  },
  {
    username: "hrc.cb@novagroup.vn",
    password: "MTL@2026",
    name: "Trần Quốc B",
    role: "Chuyên viên C&B",
    initials: "TB",
    email: "hrc.cb@novagroup.vn",
    badge: "Chuyên viên",
    badgeType: "blue",
    system: "hrc",
    desc: "Ban Nhân sự · theo dõi chính sách & nhân sự hiện trường dự án",
  },
  { username: "pmd.01", password: "MTL@2026", name: "PMD Administrator", role: "Chủ trì lập MTL", initials: "PM", email: "pmd.admin@novagroup.vn", badge: "Chủ trì MTL", badgeType: "blue", system: "admin", desc: "Phòng Điều hành Dự án · lập, kiểm soát và điều phối tiến độ tổng thể" },
  { username: "gms.01", password: "MTL@2026", name: "GMS.P Appraiser", role: "Thẩm định MTL", initials: "GS", email: "gms.appraiser@novagroup.vn", badge: "Thẩm định MTL", badgeType: "blue", system: "admin", desc: "Ban Thẩm định MTL" },
];

/* Theo SOP06 mục 2.2, PBCM gồm 9 ban/phòng gián tiếp + 4 phòng trực tiếp = 13 đơn vị.
   PMD là đơn vị chủ trì lập MTL nên có công việc riêng trong kế hoạch, nhưng không
   nằm trong nhóm phải xác nhận — không ai tự xác nhận bản mình lập. */
const GROUPS = [
  { code: "9.1", short: "HRC", name: "Ban Nhân sự", role: "indirect", scope: "9 phòng ban" },
  { code: "9.2", short: "FAC", name: "Ban Tài chính Kế toán", role: "indirect", scope: "9 phòng ban" },
  { code: "9.3", short: "SAC", name: "Ban Kinh doanh", role: "indirect", scope: "9 phòng ban" },
  { code: "9.4", short: "MAC", name: "Ban Marketing", role: "indirect", scope: "9 phòng ban" },
  { code: "9.5", short: "PTC", name: "Ban Cung ứng Đấu thầu", role: "indirect", scope: "9 phòng ban" },
  { code: "9.6", short: "QSB", name: "Phòng Khối lượng và Ngân sách", role: "indirect", scope: "9 phòng ban" },
  { code: "9.7", short: "SED", name: "Phòng An ninh", role: "indirect", scope: "9 phòng ban" },
  { code: "9.8", short: "IDC", name: "Trung tâm Thiết kế Nội bộ", role: "indirect", scope: "9 phòng ban" },
  { code: "9.9", short: "CSC", name: "Trung tâm Bồi thường GPMB", role: "indirect", scope: "9 phòng ban" },
  { code: "4.0", short: "PMD", name: "Phòng Điều hành Dự án", role: "coordinator", scope: "Chủ trì lập MTL" },
  { code: "4.1", short: "PLP", name: "Phòng Thủ tục Pháp lý Dự án", role: "direct", scope: "4 phòng trực tiếp" },
  { code: "4.2", short: "DMD", name: "Phòng Quản lý Thiết kế", role: "direct", scope: "4 phòng trực tiếp" },
  { code: "4.3", short: "PCD", name: "Phòng Quản lý Xây dựng, An toàn và Môi trường", role: "direct", scope: "4 phòng trực tiếp" },
  { code: "4.4", short: "OM", name: "Phòng Quản lý Vận hành Dự án", role: "direct", scope: "4 phòng trực tiếp" },
] as const;

/* Các đầu mục phải xác nhận MTL (PBCM). PMD bị loại vì là đơn vị lập. */
const PBCM_GROUPS = GROUPS.filter((group) => group.role !== "coordinator");
const PBCM_CODES = new Set<string>(PBCM_GROUPS.map((group) => group.code));
const INDIRECT_COUNT = GROUPS.filter((group) => group.role === "indirect").length;
const DIRECT_COUNT = GROUPS.filter((group) => group.role === "direct").length;

function isPbcmGroup(code: string) {
  return PBCM_CODES.has(code);
}

function pbcmGroupsOf(project: Project) {
  return project.selectedGroups.filter(isPbcmGroup);
}

const GROUP_BY_CODE = Object.fromEntries(GROUPS.map((group) => [group.code, group]));
const GROUP_ORDER = Object.fromEntries(GROUPS.map((group, index) => [group.code, index]));
const today = new Date().toISOString().slice(0, 10);
const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

const REGIONS = [
  "Vùng Đồng Nai 1",
  "Vùng Phan Thiết 1",
  "Vùng Hồ Chí Minh 1",
  "Vùng Hồ Tràm 1",
] as const;

function normalizeRegion(region?: string, location?: string, name?: string): string {
  const text = `${region ?? ""} ${location ?? ""} ${name ?? ""}`.toLowerCase();
  if (text.includes("đồng nai") || text.includes("dong nai") || text.includes("aqua") || text.includes("vùng 2")) return "Vùng Đồng Nai 1";
  if (text.includes("phan thiết") || text.includes("phan thiet") || text.includes("bình thuận") || text.includes("binh thuan") || text.includes("vùng 3")) return "Vùng Phan Thiết 1";
  if (text.includes("hồ tràm") || text.includes("ho tram") || text.includes("vũng tàu") || text.includes("vung tau") || text.includes("xuyên mộc") || text.includes("vùng 4")) return "Vùng Hồ Tràm 1";
  if (text.includes("hồ chí minh") || text.includes("ho chi minh") || text.includes("tp.hcm") || text.includes("tphcm") || text.includes("hcm") || text.includes("quận") || text.includes("vùng 1")) return "Vùng Hồ Chí Minh 1";
  return region || "Vùng Hồ Chí Minh 1";
}

const PROJECT_GROUPS = [
  "Nhóm 1 (Đang nghiên cứu)",
  "Nhóm 2 (Đã mua đang thiết kế)",
  "Nhóm 3 (Đang xây dựng)",
  "Nhóm 4 (Đã bàn giao khách hàng)",
  "Nhóm 5 (Thoái vốn)",
] as const;

const emptyForm: ProjectForm = {
  area: "Khu vực 1",
  region: "Vùng Hồ Chí Minh 1",
  name: "",
  code: "",
  version: "v1.0",
  investor: "Tập đoàn Novaland",
  group: "Nhóm 1 (Đang nghiên cứu)",
  type: DEFAULT_PROJECT_PARAMETERS.loaiHinhDuAn,
  location: "",
  startDate: today,
  targetDate: nextYear,
  parameters: { ...DEFAULT_PROJECT_PARAMETERS },
  milestoneDates: {},
};

const DEFAULT_INITIAL_PROJECTS: Partial<Project>[] = [
  {
    id: "proj-aqua-city-phoenix",
    code: "NVL-AQH-2026",
    name: "Aqua City - Đảo Phượng Hoàng (Phoenix Island)",
    type: "Khu đô thị sinh thái thông minh",
    investor: "Công ty TNHH BĐS Đà Lạt Valley",
    location: "Biên Hòa, Đồng Nai",
    area: "Đồng Nai",
    region: "Vùng Đồng Nai 1",
    group: "Nhóm 3 (Đang xây dựng)",
    approvalStatus: "approved",
    isOfficialApproved: true,
    eApprovalCode: "QĐ-NVL-2026/892",
    eApprovalDate: "2026-06-15",
    officialVersion: "v1.0",
    designTaskStatus: "da_duyet",
    fsStatus: "da_duyet",
    startDate: "2026-06-01",
    targetDate: "2028-12-31",
  },
  {
    id: "proj-novaworld-phanthiet",
    code: "NVL-NVW-2026",
    name: "NovaWorld Phan Thiet (PGA Golf & Resort)",
    type: "Tổ hợp Du lịch Nghỉ dưỡng Giải trí",
    investor: "Công ty CP Đầu tư Địa ốc No Va",
    location: "Phan Thiết, Bình Thuận",
    area: "Bình Thuận",
    region: "Vùng Phan Thiết 1",
    group: "Nhóm 3 (Đang xây dựng)",
    approvalStatus: "draft",
    isOfficialApproved: false,
    officialVersion: "v1.0",
    designTaskStatus: "pbcm_gop_y",
    fsStatus: "dang_tinh_toan",
    startDate: "2026-05-15",
    targetDate: "2028-06-30",
  },
  {
    id: "proj-the-grand-manhattan",
    code: "NVL-GMH-2026",
    name: "The Grand Manhattan (Cô Bắc - Cô Giang)",
    type: "Khu phức hợp Căn hộ Cao cấp & Thương mại",
    investor: "Công ty CP Đất Ngọc",
    location: "Quận 1, TP. Hồ Chí Minh",
    area: "TP.HCM",
    region: "Vùng Hồ Chí Minh 1",
    group: "Nhóm 3 (Đang xây dựng)",
    approvalStatus: "draft",
    isOfficialApproved: false,
    officialVersion: "v1.0",
    designTaskStatus: "dang_lap",
    fsStatus: "dang_tinh_toan",
    startDate: "2026-07-01",
    targetDate: "2027-12-31",
  }
];

function emptyTaskFormCreator(): TaskForm {
  return {
    groupCode: GROUPS[0].code,
    parentCode: GROUPS[0].code,
    code: "",
    name: "",
    startDate: today,
    endDate: dateAtWorkingOffset(today, 9),
    status: "Đang thực hiện",
    predecessorCodes: [],
    addToCurrent: true,
  };
}
const emptyTaskForm = emptyTaskFormCreator();

function normalizeDepartmentApprovals(selectedGroups: string[], approvals?: Record<string, DepartmentApproval>, legacyApproved = false) {
  return Object.fromEntries(PBCM_GROUPS.filter((group) => selectedGroups.includes(group.code)).map((group) => {
    const current = approvals?.[group.code];
    return [group.code, {
      reviewer: current?.reviewer ?? (legacyApproved ? "Đã duyệt trước quy trình mới" : ""),
      status: current?.status ?? (legacyApproved ? "approved" : "pending"),
      note: current?.note ?? "",
      reviewedAt: current?.reviewedAt,
    } satisfies DepartmentApproval];
  }));
}

function normalizeTaskStatus(status: unknown): NonNullable<TaskEdit["status"]> {
  if (status === "Hoàn thành" || status === "Đã xác nhận") return "Hoàn thành";
  if (status === "Trễ hạn") return "Trễ hạn";
  if (status === "Đóng") return "Đóng";
  return "Đang thực hiện";
}

function defaultDependenciesForCodes(codes: string[]) {
  const included = new Set(codes);
  return dependenciesToRecord(DEFAULT_DEPENDENCIES.filter((dependency) => included.has(dependency.successorCode) && included.has(dependency.predecessorCode)));
}

function dependenciesToRecord(dependencies: DefaultTaskDependency[]) {
  return dependencies.reduce<Record<string, TaskDependency[]>>((result, dependency) => {
    const { successorCode, ...link } = dependency;
    result[successorCode] = [...(result[successorCode] ?? []), link];
    return result;
  }, {});
}

/* Dữ liệu cũ dùng "approved" cho cả hai nghĩa: GMS đã thẩm định và đã phê duyệt
   chính thức. Bản nào chưa có hồ sơ E-Approval thì thực chất mới ở mức thẩm định. */
function migrateApprovalStatus(project: Partial<Project>): ApprovalStatus {
  const status = project.approvalStatus ?? "draft";
  if (status === "approved" && !project.isOfficialApproved && !project.eApprovalCode) return "appraised";
  return status;
}

function normalizeProject(project: Partial<Project>): Project {
  const selectedGroups = project.selectedGroups ?? GROUPS.map((group) => group.code);
  const projectTasks = [...TEMPLATE, ...(project.customTasks ?? [])];
  const taskEdits = Object.fromEntries(Object.entries(project.taskEdits ?? {}).map(([code, edit]) => [code, {
    ...edit,
    ...(edit.status ? { status: normalizeTaskStatus(edit.status) } : {}),
  }])) as Record<string, TaskEdit>;
  const includedTaskCodes = project.includedTaskCodes ?? projectTasks.filter((task) => selectedGroups.includes(task.groupCode)).map((task) => task.code);
  const isOfficial = Boolean(project.isOfficialApproved || (project.approvalStatus === "approved" && project.eApprovalCode));
  return {
    id: project.id ?? crypto.randomUUID(),
    name: project.name ?? "Dự án chưa đặt tên",
    code: project.code ?? "MTL",
    type: project.type ?? "Công trình cao tầng",
    investor: project.investor ?? "Tập đoàn Novaland",
    location: project.location ?? "",
    area: project.area ?? "Khu vực 1",
    region: normalizeRegion(project.region, project.location, project.name),
    group: project.group ?? "Nhóm 1 (Đang nghiên cứu)",
    startDate: project.startDate ?? today,
    targetDate: project.targetDate ?? nextYear,
    parameters: { ...DEFAULT_PROJECT_PARAMETERS, ...(project.parameters ?? {}), loaiHinhDuAn: project.parameters?.loaiHinhDuAn ?? DEFAULT_PROJECT_PARAMETERS.loaiHinhDuAn },
    parameterImpacts: project.parameterImpacts ?? [],
    milestoneDates: project.milestoneDates ?? {},
    selectedGroups,
    createdAt: project.createdAt ?? new Date().toISOString(),
    taskEdits,
    taskDependencies: project.taskDependencies ?? defaultDependenciesForCodes(includedTaskCodes),
    customTasks: project.customTasks ?? [],
    includedTaskCodes,
    departmentApprovals: normalizeDepartmentApprovals(selectedGroups, project.departmentApprovals, Boolean(!project.departmentApprovals && project.approvalStatus && project.approvalStatus !== "draft")),
    approvalStatus: migrateApprovalStatus(project),
    designTaskStatus: project.designTaskStatus ?? (isOfficial ? "da_duyet" : project.approvalStatus === "draft" ? "dang_lap" : "pbcm_gop_y"),
    fsStatus: project.fsStatus ?? (isOfficial ? "da_duyet" : "dang_tinh_toan"),
    gmdSubmittedAt: project.gmdSubmittedAt,
    gmdReviewer: project.gmdReviewer,
    gmdNote: project.gmdNote,
    gmdReviewedAt: project.gmdReviewedAt,
    submittedAt: project.submittedAt,
    submittedBy: project.submittedBy,
    approvedAt: project.approvedAt,
    reviewedAt: project.reviewedAt,
    approvedVersion: project.approvedVersion,
    reviewNote: project.reviewNote,
    isOfficialApproved: isOfficial,
    eApprovalCode: project.eApprovalCode,
    eApprovalUrl: project.eApprovalUrl,
    eApprovalDate: project.eApprovalDate,
    eApprovalSigner: project.eApprovalSigner,
    eApprovalNote: project.eApprovalNote,
    officialVersion: project.officialVersion ?? (isOfficial ? "v1.0" : undefined),
    baselineLocked: Boolean(project.baselineLocked ?? isOfficial),
  };
}

function dateAtOffset(date: string, offset: number) {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function dateAtWorkingOffset(date: string, offset: number) {
  let value = date;
  let remaining = Math.abs(offset);
  const direction = offset < 0 ? -1 : 1;
  while (remaining > 0) {
    value = dateAtOffset(value, direction);
    const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return value;
}

function workingDaysBetween(start: string, end: string) {
  if (!start || !end || end < start) return 0;
  let count = 0;
  for (let value = start; value <= end; value = dateAtOffset(value, 1)) {
    const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

function daysBetween(start: string, end: string) {
  return Math.max(30, rawDaysBetween(start, end) + 1);
}

function rawDaysBetween(start: string, end: string) {
  const [startYear, startMonth, startDay] = start.slice(0, 10).split("-").map(Number);
  const [endYear, endMonth, endDay] = end.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000);
}

function formatDate(date?: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(`${date.slice(0, 10)}T00:00:00`));
}

function formatDateTime(date?: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
}

function taskStatusClass(status: NonNullable<TaskEdit["status"]>) {
  if (status === "Hoàn thành") return "confirmed";
  if (status === "Đang thực hiện") return "working";
  return "closed";
}

function allProjectTasks(project: Project) {
  const customCodes = new Set(project.customTasks.map((task) => task.code));
  return [...TEMPLATE.filter((task) => !customCodes.has(task.code)), ...project.customTasks].sort((a, b) => (GROUP_ORDER[a.groupCode] ?? 99) - (GROUP_ORDER[b.groupCode] ?? 99) || a.code.localeCompare(b.code, undefined, { numeric: true }));
}

function scheduleTasks(project: Project): ScheduledTask[] {
  const selected = GROUPS.filter((group) => project.selectedGroups.includes(group.code));
  const source = allProjectTasks(project);
  const totalDays = daysBetween(project.startDate, project.targetDate);

  const includedCodes = new Set(project.includedTaskCodes);
  const tasks = source.filter((task) => includedCodes.has(task.code)).map((task) => {
    const groupIndex = selected.findIndex((group) => group.code === task.groupCode);
    const groupTasks = source.filter((item) => item.groupCode === task.groupCode);
    const indexInGroup = groupTasks.findIndex((item) => item.code === task.code);
    const groupSpan = Math.max(7, Math.floor(totalDays / Math.max(selected.length, 1)));
    const groupStart = Math.floor(groupIndex * (totalDays / Math.max(selected.length, 1)));
    const suggestedOffset = task.level === 1 ? groupStart : groupStart + Math.floor((indexInGroup / Math.max(groupTasks.length, 1)) * groupSpan * 0.76);
    const edit = project.taskEdits[task.code] ?? {};
    const isKeyMilestone = /\.MILE_(?:PLP|PCD|COM|OM)_\d+$/.test(task.code);
    const suggestedDuration = task.level === 1 ? Math.max(2, groupSpan - 2) : task.defaultDuration;
    const startDate = edit.startDate ?? dateAtOffset(project.startDate, suggestedOffset);
    const duration = isKeyMilestone ? 0 : edit.endDate
      ? Math.max(1, workingDaysBetween(startDate, edit.endDate))
      : Math.max(1, Number(edit.duration ?? suggestedDuration));
    const endDate = isKeyMilestone ? startDate : edit.endDate && edit.endDate >= startDate ? edit.endDate : dateAtWorkingOffset(startDate, duration - 1);
    const startOffset = Math.max(0, rawDaysBetween(project.startDate, startDate));

    const actualProgress = edit.actualProgress !== undefined ? edit.actualProgress : (edit.status === "Hoàn thành" ? 100 : (edit.status === "Đang thực hiện" ? 30 : 0));
    const actualStartDate = edit.actualStartDate ?? (actualProgress > 0 ? startDate : undefined);
    const actualEndDate = edit.actualEndDate ?? (actualProgress === 100 ? endDate : undefined);

    let actualStatus: "Chưa bắt đầu" | "Đang thực hiện" | "Hoàn thành" | "Trễ hạn" = "Chưa bắt đầu";
    if (actualProgress === 100 || edit.status === "Hoàn thành") {
      actualStatus = "Hoàn thành";
    } else if (endDate < today && actualProgress < 100) {
      actualStatus = "Trễ hạn";
    } else if (actualProgress > 0 || (startDate <= today && endDate >= today)) {
      actualStatus = "Đang thực hiện";
    }

    return {
      ...task,
      startDate,
      endDate,
      duration,
      left: Math.min(98, (startOffset / totalDays) * 100),
      width: Math.max(0.7, Math.min(100, (duration / totalDays) * 100)),
      pic: edit.pic ?? "",
      status: actualStatus === "Hoàn thành" ? "Hoàn thành" : (actualStatus === "Trễ hạn" ? "Trễ hạn" : (edit.status ?? "Đang thực hiện")),
      actualProgress,
      actualStartDate,
      actualEndDate,
      actualStatus,
      actualNote: edit.actualNote,
      predecessors: project.taskDependencies[task.code] ?? [],
    };
  });

  const rolledUp = tasks.map((task) => {
    if (!task.summary) return task;
    const descendants = tasks.filter((candidate) => candidate.code.startsWith(`${task.code}.`));
    if (!descendants.length) return task;
    const nonSummary = descendants.filter((c) => !c.summary);
    const startDate = descendants.reduce((earliest, candidate) => candidate.startDate < earliest ? candidate.startDate : earliest, descendants[0].startDate);
    const endDate = descendants.reduce((latest, candidate) => candidate.endDate > latest ? candidate.endDate : latest, descendants[0].endDate);
    const actualProgress = nonSummary.length
      ? Math.round(nonSummary.reduce((sum, c) => sum + c.actualProgress, 0) / nonSummary.length)
      : task.actualProgress;
    let actualStatus = task.actualStatus;
    if (actualProgress === 100) actualStatus = "Hoàn thành";
    else if (endDate < today && actualProgress < 100) actualStatus = "Trễ hạn";
    else if (actualProgress > 0) actualStatus = "Đang thực hiện";

    return {
      ...task,
      startDate,
      endDate,
      duration: Math.max(1, workingDaysBetween(startDate, endDate)),
      actualProgress,
      actualStatus,
    };
  });
  const byCode = Object.fromEntries(rolledUp.map((task) => [task.code, task]));

  return rolledUp.map((task) => {
    const missingCodes: string[] = [];
    const requirements = task.predecessors.flatMap((dependency) => {
      const predecessor = byCode[dependency.predecessorCode];
      if (!predecessor) {
        missingCodes.push(dependency.predecessorCode);
        return [];
      }
      if (dependency.type === "SS") {
        const suggestedStart = dateAtWorkingOffset(predecessor.startDate, dependency.lagDays);
        return [{ code: dependency.predecessorCode, type: dependency.type, suggestedStart, violated: task.startDate < suggestedStart }];
      }
      if (dependency.type === "FF" || dependency.type === "SF") {
        const baseDate = dependency.type === "FF" ? predecessor.endDate : predecessor.startDate;
        const requiredFinish = dateAtWorkingOffset(baseDate, dependency.lagDays);
        const suggestedStart = dateAtWorkingOffset(requiredFinish, -(task.duration - 1));
        return [{ code: dependency.predecessorCode, type: dependency.type, suggestedStart, violated: task.endDate < requiredFinish }];
      }
      const suggestedStart = dateAtWorkingOffset(predecessor.endDate, 1 + dependency.lagDays);
      return [{ code: dependency.predecessorCode, type: dependency.type, suggestedStart, violated: task.startDate < suggestedStart }];
    });
    const suggestedStartDate = requirements.reduce((latest, requirement) => requirement.suggestedStart > latest ? requirement.suggestedStart : latest, "");
    const blockingCodes = requirements.filter((requirement) => requirement.violated).map((requirement) => `${requirement.type} · ${requirement.code}`);
    const conflict = missingCodes.length
      ? `Không tìm thấy công việc cần hoàn thành trước ${missingCodes.join(", ")}.`
      : blockingCodes.length ? `Các liên kết ${blockingCodes.join(", ")} yêu cầu bắt đầu không sớm hơn ${formatDate(suggestedStartDate)}.` : "";
    const startOffset = Math.max(0, rawDaysBetween(project.startDate, task.startDate));
    return {
      ...task,
      left: Math.min(98, (startOffset / totalDays) * 100),
      width: Math.max(0.7, Math.min(100, (Math.max(1, rawDaysBetween(task.startDate, task.endDate) + 1) / totalDays) * 100)),
      dependencyConflict: conflict || undefined,
      suggestedStartDate: suggestedStartDate || undefined,
    };
  });
}

function isHierarchicallyRelated(firstCode: string, secondCode: string) {
  return firstCode.startsWith(`${secondCode}.`) || secondCode.startsWith(`${firstCode}.`);
}

function DependencyPicker({ tasks, selectedDependencies, successorCode, disabled, onChange }: {
  tasks: ScheduledTask[];
  selectedDependencies: TaskDependency[];
  successorCode: string;
  disabled?: boolean;
  onChange: (dependencies: TaskDependency[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selectedCodes = selectedDependencies.map((dependency) => dependency.predecessorCode);
  const normalizedQuery = query.trim().toLocaleLowerCase("vi");
  const candidates = tasks.filter((task) => !task.summary
    && task.code !== successorCode
    && !isHierarchicallyRelated(task.code, successorCode)
    && !selectedCodes.includes(task.code)
    && (!normalizedQuery || `${task.code} ${task.name} ${GROUP_BY_CODE[task.groupCode]?.name ?? ""}`.toLocaleLowerCase("vi").includes(normalizedQuery)));

  return <div className={`dependency-picker ${disabled ? "disabled" : ""}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <div className="dependency-picker-label"><span>Công việc cần hoàn thành trước</span><i>LINK</i><b>{selectedCodes.length} liên kết</b></div>
    {selectedDependencies.length > 0 && <div className="dependency-selected">{selectedDependencies.map((dependency) => {
      const code = dependency.predecessorCode;
      const task = tasks.find((candidate) => candidate.code === code);
      return <span key={`${dependency.type}-${code}`} title={task?.name ?? code}><b>{dependency.type} · {code}{dependency.lagDays ? ` + ${dependency.lagDays} ngày` : ""}</b>{!disabled && <button type="button" aria-label={`Bỏ liên kết ${dependency.type} ${code}`} onClick={() => onChange(selectedDependencies.filter((selected) => selected !== dependency))}>×</button>}</span>;
    })}</div>}
    {!disabled && <div className="dependency-search"><span>Tìm</span><input value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} placeholder="Mã WBS hoặc tên công việc" /></div>}
    {open && !disabled && <div className="dependency-options" role="listbox" aria-label="Chọn công việc cần hoàn thành trước">
      {candidates.slice(0, 30).map((task) => <button type="button" key={task.code} onClick={() => { onChange([...selectedDependencies, { predecessorCode: task.code, type: "FS", lagDays: 0 }]); setQuery(""); }}><i>FS</i><span><b>{task.code}</b><small>{task.name}</small></span></button>)}
      {!candidates.length && <p>Không tìm thấy công việc phù hợp.</p>}
      {candidates.length > 30 && <em>Nhập thêm từ khóa để thu hẹp {candidates.length} kết quả.</em>}
    </div>}
    <small className="field-helper">Liên kết mẫu giữ nguyên FS/SS/FF từ file MPP; liên kết thêm thủ công dùng FS.</small>
  </div>;
}

function IconTimeline() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2" x2="8" y2="5.5" /><line x1="16" y1="2" x2="16" y2="5.5" /><line x1="7" y1="13.5" x2="12" y2="13.5" /><line x1="7" y1="16.5" x2="17" y2="16.5" /></svg>;
}
function IconCheck() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3" /><polyline points="8 12 11 15 16 9" /></svg>;
}
function IconChevronDown() {
  return <svg className="section-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
}
function IconChevronLeft() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>;
}
function IconChevronRight() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>;
}
function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
function IconLogOut() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
function IconShield() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5.5c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6z" /><path d="M9 12.2l2.2 2.2 4-4.4" /></svg>;
}

function IconSeal() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3" /><circle cx="12" cy="12" r="4.5" /><polyline points="10 12 11.5 13.5 14 10.5" /></svg>;
}
function IconFileCheck() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15l2 2 4-4"/></svg>;
}
function IconList() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3" /><line x1="8.5" y1="8.5" x2="16" y2="8.5" /><line x1="8.5" y1="12" x2="16" y2="12" /><line x1="8.5" y1="15.5" x2="13" y2="15.5" /><circle cx="5.5" cy="8.5" r="0.75" fill="currentColor" stroke="none" /><circle cx="5.5" cy="12" r="0.75" fill="currentColor" stroke="none" /><circle cx="5.5" cy="15.5" r="0.75" fill="currentColor" stroke="none" /></svg>;
}
function IconGauge() {
  return (
    <svg className="section-header-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg className="section-header-icon" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function IconCalendar() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
function IconRefresh() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
}
function IconFilter() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>;
}
function IconExternalLink() {
  return <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
}
function IconSlider() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>;
}
function IconDownload() {
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
function IconMore() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>;
}
function IconBuilding() {
  return <svg className="section-header-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="22.01"/><line x1="8" y1="6" x2="10" y2="6"/><line x1="14" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>;
}
function IconDesignTask() {
  return <svg className="section-header-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>;
}
function IconFS() {
  return <svg className="section-header-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;
}
function IconUsers() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function IconFactory() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M17 18h1"/><path d="M12 18h1"/><path d="M7 18h1"/></svg>;
}
function IconMail() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3 7 12 13 21 7" /></svg>;
}
function IconLock() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
}

function IconEyeOff() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;
}
function IconNovaEmblem({ size = 18 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 8.5 2 15.5 12 22 22 15.5 22 8.5 12 2" /><polyline points="2 8.5 12 15 22 8.5" /><line x1="12" y1="22" x2="12" y2="15" /></svg>;
}
function IconBriefcase() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}
function IconClipboardCheck() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M9 14l2 2 4-4" />
    </svg>
  );
}
function IconTableGrid() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /></svg>;
}
function IconAward() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6" />
      <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
    </svg>
  );
}
function IconAlertTriangle() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
function IconTrendingUp() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

function IconSparkles() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

function IconSearch({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function IconFolderFlat() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="#22c55e" stroke="none">
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function IconDocFlat() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}


function ExecutiveArcGauge({ score = 88.0, max = 100, label = "ĐẠT CHUẨN" }: { score?: number; max?: number; label?: string }) {
  const percent = Math.min(100, Math.max(0, (score / max) * 100));
  const arcLength = 295;
  const strokeOffset = arcLength - (arcLength * percent) / 100;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", width: "100%", height: "148px", margin: "2px 0 4px" }}>
      <svg viewBox="0 0 200 152" style={{ width: "185px", height: "142px", overflow: "visible" }}>
        {/* Flat Track */}
        <path
          d="M 50.2 129.8 A 65 65 0 1 1 149.8 129.8"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="13"
          strokeLinecap="round"
        />
        {/* Flat Progress */}
        <path
          d="M 50.2 129.8 A 65 65 0 1 1 149.8 129.8"
          fill="none"
          stroke="#22c55e"
          strokeWidth="13"
          strokeDasharray={arcLength}
          strokeDashoffset={strokeOffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
        {/* Centered Text */}
        <text x="100" y="85" textAnchor="middle" fill="#0f172a" fontSize="28" fontWeight="800" fontFamily="sans-serif">
          {score.toFixed(1).replace(".", ",")}%
        </text>
        <text x="100" y="104" textAnchor="middle" fill="#1e293b" fontSize="11" fontWeight="800" letterSpacing="0.5" fontFamily="sans-serif">
          {label}
        </text>
      </svg>
    </div>
  );
}

function ExecutiveDonut({ percent = 75, size = 68, stroke = 7, color = "#059669", trackColor = "#e2e8f0" }: { percent?: number; size?: number; stroke?: number; color?: string; trackColor?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none", display: "grid", placeItems: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>
        {percent}%
      </div>
    </div>
  );
}

const QLTT_BY_PERSON: Record<string, string> = {
  "Lê Đại Lễ": "Nguyễn Trung Nguyên",
  "Nguyễn Ngọc Trường": "Nguyễn Trung Nguyên",
  "Nguyễn Trung Nguyên": "Phạm Ngọc Tùng",
  "Nguyễn Trung Lộc": "Nguyễn Trung Nguyên",
  "Phạm Thị Tú Anh": "Nguyễn Trung Nguyên",
  "Trần Văn An": "Nguyễn Trung Nguyên",
  "Lê Thị Bình": "Phạm Ngọc Tùng",
};

function getManagerForPerson(person: string): string {
  if (!person || person.toLowerCase().includes("chưa g")) return "";
  return QLTT_BY_PERSON[person] || "Nguyễn Trung Nguyên";
}

/* Progress buckets shown on the overview: a task counts as late only when its finish
   date has passed and it has not been marked complete. */
const WORK_DONE = "#2ea44f";
const WORK_LATE = "#d92b2b";
const WORK_RUNNING = "#102d4b";

type WorkStat = { total: number; done: number; late: number; running: number };

function emptyWorkStat(): WorkStat {
  return { total: 0, done: 0, late: 0, running: 0 };
}

function countWork(stat: WorkStat, task: ScheduledTask, today: string) {
  stat.total += 1;
  if (task.status === "Hoàn thành") stat.done += 1;
  else if (task.endDate < today) stat.late += 1;
  else stat.running += 1;
}

function latePercent(stat: WorkStat) {
  return stat.total ? (stat.late / stat.total) * 100 : 0;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function Donut({ stat, size = 80 }: { stat: WorkStat; size?: number }) {
  const segments = [
    { value: stat.running, color: WORK_RUNNING },
    { value: stat.done, color: WORK_DONE },
    { value: stat.late, color: WORK_LATE },
  ];
  const total = stat.total || 1;
  const radius = size / 2 - 8;
  const strokeWidth = 11;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;
  return (
    <svg className="donut" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e6ecf1" strokeWidth={strokeWidth} />
      {segments.map((segment, index) => {
        if (!segment.value) return null;
        const length = (segment.value / total) * circumference;
        const node = <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={segment.color} strokeWidth={strokeWidth} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-consumed} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
        consumed += length;
        return node;
      })}
    </svg>
  );
}

function WorkLegend() {
  return <div className="work-legend"><span><i style={{ background: WORK_RUNNING }} />Đang triển khai</span><span><i style={{ background: WORK_DONE }} />Hoàn thành</span><span><i style={{ background: WORK_LATE }} />Trễ hạn</span></div>;
}

function IconEye() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></svg>;
}

function IconTrash() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>;
}

function UserBadge() {
  const username = typeof window === "undefined" ? "" : localStorage.getItem(SESSION_KEY) ?? "";
  const account = DEMO_ACCOUNTS.find((item) => item.username === username) ?? DEMO_ACCOUNTS[0];
  return <div className="user-badge"><span className="avatar">{account.initials}</span><span className="user-badge-info"><strong>{account.name}</strong><small>{account.role}</small></span><i className="user-badge-caret">⌄</i></div>;
}

function paginationPages(current: number, count: number) {
  const window = 2;
  const pages = new Set<number>([1, count, current]);
  for (let i = current - window; i <= current + window; i++) if (i >= 1 && i <= count) pages.add(i);
  return [...pages].filter((page) => page >= 1 && page <= count).sort((a, b) => a - b);
}

function Pagination({ total, pageSize, page, onPageChange, onPageSizeChange, pageSizeOptions = [10, 20, 40] }: {
  total: number;
  pageSize: number;
  page: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];
}) {
  if (total <= pageSize) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const from = (currentPage - 1) * pageSize + 1;
  const to = Math.min(total, currentPage * pageSize);
  const pages = paginationPages(currentPage, pageCount);
  return (
    <div className="pagination">
      <span>Hiển thị {from}-{to} trong số {total}</span>
      <label className="pagination-size"><span>Số dòng/trang</span><select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>{pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
      <div className="pagination-pages">
        <button type="button" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} aria-label="Trang trước">‹</button>
        {pages.map((pageNumber, index) => (
          <span key={pageNumber} style={{ display: "contents" }}>
            {index > 0 && pages[index - 1] !== pageNumber - 1 && <em className="pagination-ellipsis">…</em>}
            <button type="button" className={pageNumber === currentPage ? "active" : ""} onClick={() => onPageChange(pageNumber)}>{pageNumber}</button>
          </span>
        ))}
        <button type="button" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)} aria-label="Trang sau">›</button>
      </div>
    </div>
  );
}

function createsDependencyCycle(project: Project, successorCode: string, predecessorCode: string) {
  const visited = new Set<string>();
  const stack = [predecessorCode];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === successorCode) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    (project.taskDependencies[current] ?? []).forEach((dependency) => stack.push(dependency.predecessorCode));
  }
  return false;
}

function projectTaskCount(project: Project) {
  const includedCodes = new Set(project.includedTaskCodes);
  return allProjectTasks(project).filter((task) => includedCodes.has(task.code)).length;
}

function projectDependencyCount(project: Project) {
  return Object.values(project.taskDependencies).reduce((count, dependencies) => count + dependencies.length, 0);
}

function approvedDepartmentCount(project: Project) {
  return pbcmGroupsOf(project).filter((code) => project.departmentApprovals[code]?.status === "approved").length;
}

function allDepartmentsApproved(project: Project) {
  const pbcm = pbcmGroupsOf(project);
  return pbcm.length > 0 && approvedDepartmentCount(project) === pbcm.length;
}

function projectApprovalLabel(project: Project) {
  if (project.approvalStatus !== "draft") return APPROVAL_LABEL[project.approvalStatus];
  return allDepartmentsApproved(project) ? "SẴN SÀNG GỬI GMS" : "CHỜ PHÒNG BAN XÁC NHẬN";
}

function escapeXml(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

const PROJECT_LINK_TYPE: Record<TaskDependency["type"], number> = { FF: 0, FS: 1, SF: 2, SS: 3 };

function projectXml(project: Project, tasks: ScheduledTask[]) {
  const created = new Date().toISOString().slice(0, 19);
  const uidByCode = Object.fromEntries(tasks.map((task, index) => [task.code, index + 1]));
  const taskXml = tasks.map((task, index) => {
    const isKeyMilestone = /\.MILE_(?:PLP|PCD|COM|OM)_\d+$/.test(task.code);
    const predecessorXml = task.predecessors.map((dependency) => uidByCode[dependency.predecessorCode] ? `
      <PredecessorLink><PredecessorUID>${uidByCode[dependency.predecessorCode]}</PredecessorUID><Type>${PROJECT_LINK_TYPE[dependency.type]}</Type><CrossProject>0</CrossProject><LinkLag>${dependency.lagDays * 4800}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>` : "").join("");
    return `
    <Task>
      <UID>${index + 1}</UID><ID>${index + 1}</ID><Name>${escapeXml(`${task.code} ${task.name}`)}</Name>
      <Type>1</Type><IsNull>0</IsNull><CreateDate>${created}</CreateDate><WBS>${escapeXml(task.code)}</WBS>
      <OutlineNumber>${escapeXml(task.code)}</OutlineNumber><OutlineLevel>${task.level}</OutlineLevel><Priority>500</Priority>
      <Start>${task.startDate}T08:00:00</Start><Finish>${task.endDate}T${isKeyMilestone ? "08:00:00" : "17:00:00"}</Finish>
      <Duration>PT${task.duration * 8}H0M0S</Duration><DurationFormat>7</DurationFormat>
      <Summary>${task.summary ? 1 : 0}</Summary><Milestone>${isKeyMilestone ? 1 : 0}</Milestone><PercentComplete>${task.status === "Hoàn thành" ? 100 : 0}</PercentComplete>
      ${predecessorXml}
      <Active>1</Active><Manual>0</Manual><Notes>${escapeXml(`${GROUP_BY_CODE[task.groupCode]?.short ?? task.groupCode}${task.pic ? ` · PIC: ${task.pic}` : ""}`)}</Notes>
    </Task>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <SaveVersion>14</SaveVersion><Name>${escapeXml(project.code)}-MTL.xml</Name><Title>${escapeXml(project.name)}</Title>
  <ScheduleFromStart>1</ScheduleFromStart><StartDate>${project.startDate}T08:00:00</StartDate><FinishDate>${project.targetDate}T17:00:00</FinishDate>
  <MinutesPerDay>480</MinutesPerDay><MinutesPerWeek>2400</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>
  <DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime><CalendarUID>1</CalendarUID>
  <Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><BaseCalendarUID>-1</BaseCalendarUID></Calendar></Calendars>
  <Tasks>${taskXml}
  </Tasks>
</Project>`;
}

const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  draft: "ĐANG LẬP",
  gmd_review: "CHỜ GMD KIỂM SOÁT",
  gmd_returned: "GMD YÊU CẦU ĐIỀU CHỈNH",
  submitted: "CHỜ GMS THẨM ĐỊNH",
  changes_requested: "GMS YÊU CẦU ĐIỀU CHỈNH",
  appraised: "ĐÃ THẨM ĐỊNH · CHỜ PHÊ DUYỆT",
  approved: "ĐÃ PHÊ DUYỆT CHÍNH THỨC",
};

/* Các trạng thái mà người lập được phép sửa MTL. Từ lúc trình GMD trở đi,
   bản kế hoạch phải đứng yên để GMD và GMS.P xem đúng thứ đã gửi. */
const EDITABLE_STATUSES: ApprovalStatus[] = ["draft", "gmd_returned", "changes_requested"];

function isPlanEditable(project: Project) {
  return EDITABLE_STATUSES.includes(project.approvalStatus);
}

const DEPARTMENT_APPROVAL_LABEL: Record<DepartmentApprovalStatus, string> = {
  pending: "CHỜ XÁC NHẬN",
  approved: "ĐÃ XÁC NHẬN",
  changes_requested: "CẦN ĐIỀU CHỈNH",
};

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState("");
  const [customCatalog, setCustomCatalog] = useState<TemplateTask[]>([]);
  const [enabledCatalogCodes, setEnabledCatalogCodes] = useState<Set<string>>(new Set());
  const [catalogWorkTypeEdits, setCatalogWorkTypeEdits] = useState<Record<string, WorkType>>({});
  const [currentAccount, setCurrentAccount] = useState<DemoAccount | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<"home" | "overview" | "projects" | "workspace" | "departments" | "gmd" | "gms" | "confirm_approval" | "approved_projects" | "catalog" | "design_task" | "fs_ver2" | "init_template">("home");
  const [initMode, setInitMode] = useState<"from_template" | "from_approved_version">("from_template");
  const [initProjectName, setInitProjectName] = useState("Aqua City - Phân khu Phoenix South");
  const [initProjectCode, setInitProjectCode] = useState("AQC-PS-2026");
  const [initInvestor, setInitInvestor] = useState("Tập đoàn Novaland");
  const [initArea, setInitArea] = useState("Đồng Nai");
  const [initRegion, setInitRegion] = useState("Miền Nam");
  const [initProjectType, setInitProjectType] = useState("Khu đô thị sinh thái thông minh");
  const [initStartDate, setInitStartDate] = useState(today);
  const [initTemplateSearch, setInitTemplateSearch] = useState("");
  const [initSelectedApprovedProjectId, setInitSelectedApprovedProjectId] = useState<string>("proj-aqua-city-phoenix");
  const [initSelectedVersion, setInitSelectedVersion] = useState<string>("v1.0");
  const [initNewVersionCode, setInitNewVersionCode] = useState<string>("v1.1");
  const [initUpdateReason, setInitUpdateReason] = useState<string>("Cập nhật tiến độ thực tế các mốc thi công và điều chỉnh pháp lý");
  const [initTreeExpanded, setInitTreeExpanded] = useState<Record<string, boolean>>({
    root: true,
    block4: true,
    block9: true,
    g4_0: true,
    g4_1: true,
    g4_2: false,
    g4_3: false,
    g4_4: false,
    g9_1: true,
    g9_2: false,
    g9_3: false,
    g9_4: false,
    g9_5: false,
    g9_6: false,
    g9_7: false,
    g9_8: false,
    g9_9: false,
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [homePeriod, setHomePeriod] = useState<"6m" | "q3" | "year">("6m");
  const [homeOpFilter, setHomeOpFilter] = useState<"all" | "passed" | "improve">("all");
  const [todayTasksList, setTodayTasksList] = useState<Array<{ id: string; title: string; category: "routine" | "extra" | "technical"; time: string; done: boolean; project?: string }>>([
    { id: "t1", title: "Duyệt kế hoạch triển khai thiết kế Dự án Aqua City - Phân khu Phoenix", category: "routine", time: "10:30", done: true, project: "Aqua City" },
    { id: "t2", title: "Rà soát mốc tiến độ hồ sơ PCCC Dự án NovaWorld Phan Thiết", category: "technical", time: "14:15", done: true, project: "NovaWorld Phan Thiết" },
    { id: "t3", title: "Họp giao ban tiến độ thi công hầm The Grand Manhattan với nhà thầu", category: "routine", time: "16:30", done: false, project: "The Grand Manhattan" },
    { id: "t4", title: "Ký nháy tờ trình hiệu chỉnh FS-Ver2 Sunrise Riverside chuyển GMD kiểm soát", category: "technical", time: "17:00", done: false, project: "Sunrise Riverside" },
    { id: "t5", title: "Đôn đốc Ban QLDA đẩy nhanh tiến độ thi công gói thầu MEP Tháp C", category: "extra", time: "Hôm nay", done: false, project: "NovaWorld Phan Thiết" },
    { id: "t6", title: "Cập nhật báo cáo điều hành tuần gửi Tổng Giám đốc", category: "extra", time: "Hôm nay", done: false },
  ]);
  const [homeOpen, setHomeOpen] = useState(true);
  const [lapMtlOpen, setLapMtlOpen] = useState(false);
  const [designTaskOpen, setDesignTaskOpen] = useState(false);
  const [fsVer2Open, setFsVer2Open] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [overviewSource, setOverviewSource] = useState<"approved" | "all">("approved");
  const [overviewRegion, setOverviewRegion] = useState("all");
  const [overviewProject, setOverviewProject] = useState("all");
  const [overviewGroup, setOverviewGroup] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [insertAnchor, setInsertAnchor] = useState<TemplateTask | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [contextMenu, setContextMenu] = useState<{ code: string; x: number; y: number } | null>(null);
  const [gmsFilter, setGmsFilter] = useState<"pending" | "history">("pending");
  const [gmsSelectedId, setGmsSelectedId] = useState("");
  const [gmsReturnGroups, setGmsReturnGroups] = useState<Set<string>>(new Set());
  const [gmdFilter, setGmdFilter] = useState<"pending" | "history">("pending");
  const [gmdSelectedId, setGmdSelectedId] = useState("");
  const [gmdNote, setGmdNote] = useState("");
  const [gmdReviewer, setGmdReviewer] = useState("");
  const [gmdReturnGroups, setGmdReturnGroups] = useState<Set<string>>(new Set());
  const [departmentCode, setDepartmentCode] = useState<string>(GROUPS[0].code);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [formError, setFormError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [search, setSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState<ApprovalStatus | "all">("all");
  const [projectRegionFilter, setProjectRegionFilter] = useState("all");
  const [projectTypeFilter, setProjectTypeFilter] = useState("all");
  const [projectPage, setProjectPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = useState(10);

  const [designSearch, setDesignSearch] = useState("");
  const [designRegionFilter, setDesignRegionFilter] = useState("all");
  const [designStatusFilter, setDesignStatusFilter] = useState<string>("all");
  const [designPage, setDesignPage] = useState(1);
  const [designPageSize, setDesignPageSize] = useState(10);

  const [fsSearch, setFsSearch] = useState("");
  const [fsRegionFilter, setFsRegionFilter] = useState("all");
  const [fsStatusFilter, setFsStatusFilter] = useState<string>("all");
  const [fsPage, setFsPage] = useState(1);
  const [fsPageSize, setFsPageSize] = useState(10);

  const [confirmSearch, setConfirmSearch] = useState("");
  const [confirmFilter, setConfirmFilter] = useState<"all" | "pending" | "approved">("all");
  const [confirmPage, setConfirmPage] = useState(1);
  const [confirmPageSize, setConfirmPageSize] = useState(10);

  const [approvedSearch, setApprovedSearch] = useState("");
  const [approvedRegionFilter, setApprovedRegionFilter] = useState("all");
  const [approvedPage, setApprovedPage] = useState(1);
  const [approvedPageSize, setApprovedPageSize] = useState(10);

  const [showEApprovalModal, setShowEApprovalModal] = useState(false);
  const [eApprovalForm, setEApprovalForm] = useState({
    projectId: "",
    code: "",
    url: "",
    date: today,
    signer: "PMD - Ban Quản lý Dự án",
    version: "v1.0",
    note: "",
  });
  const [eApprovalError, setEApprovalError] = useState("");

  const [showProgressModal, setShowProgressModal] = useState(false);
  const [editingProgressTask, setEditingProgressTask] = useState<ScheduledTask | null>(null);
  const [progressForm, setProgressForm] = useState({
    progress: 0,
    actualStartDate: "",
    actualEndDate: "",
    note: "",
  });

  const [gmsSearch, setGmsSearch] = useState("");
  const [gmdSearch, setGmdSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogGroupFilter, setCatalogGroupFilter] = useState("all");
  const [catalogWorkGroupFilter, setCatalogWorkGroupFilter] = useState<"all" | Exclude<WorkType, "">>("all");
  const [catalogSourceFilter, setCatalogSourceFilter] = useState<"all" | "custom" | "standard">("all");
  const [catalogCollapsed, setCatalogCollapsed] = useState<Set<string>>(new Set());
  const [catalogLevel, setCatalogLevel] = useState<string>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedCode, setSelectedCode] = useState("");
  const [toast, setToast] = useState("");
  const [xmlData, setXmlData] = useState<ParsedProjectData | null>(null);

  const handleXMLUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setXmlData(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = await parseMSProjectXML(text);
        setXmlData(parsed);
      } catch (err) {
        alert("Lỗi khi đọc file XML: " + String(err));
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as Partial<Project>[];
        const savedCustomCatalog = JSON.parse(localStorage.getItem(CATALOG_KEY) ?? "[]") as TemplateTask[];
        const savedEnabledCodes = localStorage.getItem(CATALOG_ENABLED_KEY);
        const savedWorkTypeEdits = JSON.parse(localStorage.getItem(CATALOG_WORK_TYPE_KEY) ?? "{}") as Record<string, WorkType>;
        const savedUsername = localStorage.getItem(SESSION_KEY) ?? "";
        const initialList = (saved && saved.length > 0) ? saved : DEFAULT_INITIAL_PROJECTS;
        const normalized = initialList.map(normalizeProject);
        setProjects(normalized);
        setCustomCatalog(savedCustomCatalog);
        setCatalogWorkTypeEdits(savedWorkTypeEdits);
        setCurrentAccount(DEMO_ACCOUNTS.find((account) => account.username === savedUsername) ?? null);
        const catalogCodes = new Set([...TEMPLATE, ...savedCustomCatalog].map((task) => task.code));
        setEnabledCatalogCodes(new Set(savedEnabledCodes ? (JSON.parse(savedEnabledCodes) as string[]).filter((code) => catalogCodes.has(code)) : [...catalogCodes]));
        setActiveId(localStorage.getItem(ACTIVE_KEY) ?? normalized[0]?.id ?? "");
        const savedCollapsed = localStorage.getItem("mtl-sidebar-collapsed") === "true";
        if (savedCollapsed) setSidebarCollapsed(true);
      } catch {
        const normalized = DEFAULT_INITIAL_PROJECTS.map(normalizeProject);
        setProjects(normalized);
        setCustomCatalog([]);
        setCatalogWorkTypeEdits({});
        setCurrentAccount(null);
        setEnabledCatalogCodes(new Set(TEMPLATE.map((task) => task.code)));
      }
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    localStorage.setItem(CATALOG_KEY, JSON.stringify(customCatalog));
    localStorage.setItem(CATALOG_ENABLED_KEY, JSON.stringify([...enabledCatalogCodes]));
    localStorage.setItem(CATALOG_WORK_TYPE_KEY, JSON.stringify(catalogWorkTypeEdits));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    localStorage.setItem("mtl-sidebar-collapsed", String(sidebarCollapsed));
  }, [projects, activeId, customCatalog, enabledCatalogCodes, catalogWorkTypeEdits, hydrated, sidebarCollapsed]);

  useEffect(() => {
    const handleToggleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && (event.key === "b" || event.key === "B")) {
        event.preventDefault();
        setSidebarCollapsed((current) => !current);
      }
    };
    window.addEventListener("keydown", handleToggleShortcut);
    return () => window.removeEventListener("keydown", handleToggleShortcut);
  }, []);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const activeProject = projects.find((project) => project.id === activeId) ?? projects[0];
  const departmentApprovedCount = activeProject ? approvedDepartmentCount(activeProject) : 0;
  const departmentPendingCount = activeProject ? pbcmGroupsOf(activeProject).length - departmentApprovedCount : 0;

  const officialApprovedProjects = useMemo(() => {
    return projects.filter((p) => p.isOfficialApproved || (p.approvalStatus === "approved" && p.eApprovalCode));
  }, [projects]);

  const visibleApprovedProjects = useMemo(() => {
    const query = approvedSearch.trim().toLocaleLowerCase("vi");
    return officialApprovedProjects.filter((project) => {
      const matchesQuery = !query || `${project.code} ${project.name} ${project.location} ${project.eApprovalCode ?? ""}`.toLocaleLowerCase("vi").includes(query);
      const matchesRegion = approvedRegionFilter === "all" || project.region === approvedRegionFilter;
      return matchesQuery && matchesRegion;
    });
  }, [officialApprovedProjects, approvedSearch, approvedRegionFilter]);

  const pagedApprovedProjects = useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(visibleApprovedProjects.length / approvedPageSize));
    const currentPage = Math.min(approvedPage, pageCount);
    return visibleApprovedProjects.slice((currentPage - 1) * approvedPageSize, currentPage * approvedPageSize);
  }, [visibleApprovedProjects, approvedPage, approvedPageSize]);

  const approvedTotalTasks = useMemo(() => {
    return officialApprovedProjects.reduce((sum, p) => sum + projectTaskCount(p), 0);
  }, [officialApprovedProjects]);

  const approvedAverageProgress = useMemo(() => {
    if (!officialApprovedProjects.length) return 0;
    const allTasks = officialApprovedProjects.flatMap((p) => scheduleTasks(p).filter((t) => !t.summary));
    if (!allTasks.length) return 0;
    return Math.round(allTasks.reduce((sum, t) => sum + t.actualProgress, 0) / allTasks.length);
  }, [officialApprovedProjects]);

  const approvedDoneTasks = useMemo(() => {
    return officialApprovedProjects.flatMap((p) => scheduleTasks(p).filter((t) => !t.summary && t.actualStatus === "Hoàn thành")).length;
  }, [officialApprovedProjects]);

  const approvedLateTasks = useMemo(() => {
    return officialApprovedProjects.flatMap((p) => scheduleTasks(p).filter((t) => !t.summary && t.actualStatus === "Trễ hạn")).length;
  }, [officialApprovedProjects]);

  /* Chỉ hồ sơ đã qua thẩm định mới đủ điều kiện trình E-Approval (SOP B8). */
  const pendingEApprovalCount = useMemo(() => {
    return projects.filter((p) => p.approvalStatus === "appraised" && !p.isOfficialApproved).length;
  }, [projects]);

  const visibleConfirmProjects = useMemo(() => {
    const query = confirmSearch.trim().toLocaleLowerCase("vi");
    return projects.filter((project) => {
      const matchesQuery = !query || `${project.code} ${project.name} ${project.location} ${project.eApprovalCode ?? ""}`.toLocaleLowerCase("vi").includes(query);
      const matchesFilter = confirmFilter === "all"
        ? true
        : confirmFilter === "pending"
          ? !project.isOfficialApproved
          : !!project.isOfficialApproved;
      return matchesQuery && matchesFilter;
    });
  }, [projects, confirmSearch, confirmFilter]);

  const pagedConfirmProjects = useMemo(() => {
    const pageCount = Math.max(1, Math.ceil(visibleConfirmProjects.length / confirmPageSize));
    const currentPage = Math.min(confirmPage, pageCount);
    return visibleConfirmProjects.slice((currentPage - 1) * confirmPageSize, currentPage * confirmPageSize);
  }, [visibleConfirmProjects, confirmPage, confirmPageSize]);

  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase("vi");
    return projects.filter((project) => {
      const matchesQuery = !query || `${project.code} ${project.name} ${project.location} ${project.type} ${project.investor || ""}`.toLocaleLowerCase("vi").includes(query);
      const matchesStatus = projectStatusFilter === "all" || project.approvalStatus === projectStatusFilter;
      const matchesRegion = projectRegionFilter === "all" || project.region === projectRegionFilter;
      const matchesType = projectTypeFilter === "all" || project.type === projectTypeFilter;
      return matchesQuery && matchesStatus && matchesRegion && matchesType;
    });
  }, [projects, projectSearch, projectStatusFilter, projectRegionFilter, projectTypeFilter]);
  const pagedProjects = useMemo(() => visibleProjects.slice((Math.min(projectPage, Math.max(1, Math.ceil(visibleProjects.length / projectPageSize))) - 1) * projectPageSize, Math.min(projectPage, Math.max(1, Math.ceil(visibleProjects.length / projectPageSize))) * projectPageSize), [visibleProjects, projectPage, projectPageSize]);

  const visibleDesignProjects = useMemo(() => {
    const query = designSearch.trim().toLocaleLowerCase("vi");
    return projects.filter((project) => {
      const matchesQuery = !query || `${project.code} ${project.name} ${project.location} ${project.type} ${project.investor || ""}`.toLocaleLowerCase("vi").includes(query);
      const matchesStatus = designStatusFilter === "all" || project.designTaskStatus === designStatusFilter;
      const matchesRegion = designRegionFilter === "all" || project.region === designRegionFilter;
      return matchesQuery && matchesStatus && matchesRegion;
    });
  }, [projects, designSearch, designStatusFilter, designRegionFilter]);
  const pagedDesignProjects = useMemo(() => visibleDesignProjects.slice((Math.min(designPage, Math.max(1, Math.ceil(visibleDesignProjects.length / designPageSize))) - 1) * designPageSize, Math.min(designPage, Math.max(1, Math.ceil(visibleDesignProjects.length / designPageSize))) * designPageSize), [visibleDesignProjects, designPage, designPageSize]);

  const visibleFsProjects = useMemo(() => {
    const query = fsSearch.trim().toLocaleLowerCase("vi");
    return projects.filter((project) => {
      const matchesQuery = !query || `${project.code} ${project.name} ${project.location} ${project.type} ${project.investor || ""}`.toLocaleLowerCase("vi").includes(query);
      const matchesStatus = fsStatusFilter === "all" || project.fsStatus === fsStatusFilter;
      const matchesRegion = fsRegionFilter === "all" || project.region === fsRegionFilter;
      return matchesQuery && matchesStatus && matchesRegion;
    });
  }, [projects, fsSearch, fsStatusFilter, fsRegionFilter]);
  const pagedFsProjects = useMemo(() => visibleFsProjects.slice((Math.min(fsPage, Math.max(1, Math.ceil(visibleFsProjects.length / fsPageSize))) - 1) * fsPageSize, Math.min(fsPage, Math.max(1, Math.ceil(visibleFsProjects.length / fsPageSize))) * fsPageSize), [visibleFsProjects, fsPage, fsPageSize]);
  
  const overviewToday = new Date().toISOString().slice(0, 10);
  const overviewSourceProjects = useMemo(() => {
    if (overviewSource === "approved" && officialApprovedProjects.length > 0) {
      return officialApprovedProjects;
    }
    return projects;
  }, [overviewSource, officialApprovedProjects, projects]);

  const overviewRegions = useMemo(() => [...new Set(overviewSourceProjects.map((project) => project.region).filter(Boolean) as string[])].sort(), [overviewSourceProjects]);
  const overviewEntries = useMemo(() => overviewSourceProjects.flatMap((project) => scheduleTasks(project).filter((task) => !task.summary).map((task) => ({ project, task }))), [overviewSourceProjects]);
  const overviewFiltered = useMemo(() => overviewEntries.filter(({ project, task }) => (overviewRegion === "all" || project.region === overviewRegion)
    && (overviewProject === "all" || project.id === overviewProject)
    && (overviewGroup === "all" || task.groupCode === overviewGroup)), [overviewEntries, overviewRegion, overviewProject, overviewGroup]);
  const overview = useMemo(() => {
    const byGroup = new Map<string, WorkStat>();
    const byProject = new Map<string, WorkStat>();
    const byPerson = new Map<string, WorkStat>();
    const indirect = emptyWorkStat();
    const direct = emptyWorkStat();
    const coordinator = emptyWorkStat();
    const all = emptyWorkStat();
    overviewFiltered.forEach(({ project, task }) => {
      const groupStat = byGroup.get(task.groupCode) ?? emptyWorkStat();
      countWork(groupStat, task, overviewToday);
      byGroup.set(task.groupCode, groupStat);
      const projectStat = byProject.get(project.id) ?? emptyWorkStat();
      countWork(projectStat, task, overviewToday);
      byProject.set(project.id, projectStat);
      const person = task.pic.trim() || "Chưa gán người thực hiện";
      const personStat = byPerson.get(person) ?? emptyWorkStat();
      countWork(personStat, task, overviewToday);
      byPerson.set(person, personStat);
      const role = GROUP_BY_CODE[task.groupCode]?.role;
      countWork(role === "indirect" ? indirect : role === "direct" ? direct : coordinator, task, overviewToday);
      countWork(all, task, overviewToday);
    });
    const visibleProjectIds = new Set(overviewFiltered.map(({ project }) => project.id));
    const visibleRegions = new Set(overviewFiltered.map(({ project }) => project.region).filter(Boolean));
    return {
      all,
      indirect,
      direct,
      coordinator,
      indirectGroups: INDIRECT_COUNT,
      directGroups: DIRECT_COUNT,
      regionCount: visibleRegions.size,
      projectCount: visibleProjectIds.size,
      groupRows: GROUPS.map((group) => ({ group, stat: byGroup.get(group.code) ?? emptyWorkStat() })).filter((row) => row.stat.total > 0),
      projectRows: overviewSourceProjects.filter((project) => byProject.has(project.id)).map((project) => ({ project, stat: byProject.get(project.id)! })).sort((a, b) => b.stat.total - a.stat.total),
      personRows: [...byPerson.entries()].map(([person, stat]) => ({ person, stat })).sort((a, b) => b.stat.late - a.stat.late || b.stat.total - a.stat.total),
    };
  }, [overviewFiltered, overviewToday, overviewSourceProjects]);
  const overviewMaxGroupTotal = Math.max(1, ...overview.groupRows.map((row) => row.stat.total));
  const overviewMaxProjectTotal = Math.max(1, ...overview.projectRows.map((row) => row.stat.total));
  const overviewMaxPersonLate = Math.max(1, ...overview.personRows.map((row) => row.stat.late));
  const pendingGmsCount = projects.filter((project) => project.approvalStatus === "submitted").length;
  const GMS_STAGES: ApprovalStatus[] = ["submitted", "changes_requested", "appraised", "approved"];
  const reviewedGmsProjects = projects.filter((project) => GMS_STAGES.includes(project.approvalStatus)).sort((a, b) => {
    if (a.approvalStatus === "submitted" && b.approvalStatus !== "submitted") return -1;
    if (a.approvalStatus !== "submitted" && b.approvalStatus === "submitted") return 1;
    return (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "");
  });
  const visibleGmsProjects = reviewedGmsProjects.filter((project) => {
    const inStatus = gmsFilter === "pending" ? project.approvalStatus === "submitted" : project.approvalStatus !== "submitted";
    const query = gmsSearch.trim().toLocaleLowerCase("vi");
    return inStatus && (!query || `${project.code} ${project.name} ${project.location} ${project.submittedBy ?? ""}`.toLocaleLowerCase("vi").includes(query));
  });
  const gmsSelectedProject = projects.find((project) => project.id === gmsSelectedId) ?? null;
  const gmsSelectedTasks = useMemo(() => gmsSelectedProject ? scheduleTasks(gmsSelectedProject) : [], [gmsSelectedProject]);

  /* ---- GMD kiểm soát (SOP B6) ---- */
  const pendingGmdCount = projects.filter((project) => project.approvalStatus === "gmd_review").length;
  const GMD_STAGES: ApprovalStatus[] = ["gmd_review", "gmd_returned", "submitted", "changes_requested", "appraised", "approved"];
  const visibleGmdProjects = projects
    .filter((project) => {
      const inStatus = gmdFilter === "pending" ? project.approvalStatus === "gmd_review" : GMD_STAGES.includes(project.approvalStatus) && project.approvalStatus !== "gmd_review" && Boolean(project.gmdReviewedAt);
      const query = gmdSearch.trim().toLocaleLowerCase("vi");
      return inStatus && (!query || `${project.code} ${project.name} ${project.location}`.toLocaleLowerCase("vi").includes(query));
    })
    .sort((a, b) => (b.gmdSubmittedAt ?? "").localeCompare(a.gmdSubmittedAt ?? ""));
  const gmdSelectedProject = projects.find((project) => project.id === gmdSelectedId) ?? null;
  const gmdSelectedTasks = useMemo(() => gmdSelectedProject ? scheduleTasks(gmdSelectedProject) : [], [gmdSelectedProject]);

  /* Sáu kiểm tra giúp GMD quyết định trong 0.5 ngày mà không phải soi từng dòng WBS.
     Tất cả đều tính từ dữ liệu sẵn có, không cần người dùng nhập thêm. */
  const gmdChecks = useMemo(() => {
    if (!gmdSelectedProject) return [];
    const project = gmdSelectedProject;
    const tasks = gmdSelectedTasks;
    const leaves = tasks.filter((task) => !task.summary);

    const overTarget = leaves.filter((task) => task.endDate > project.targetDate);
    const conflicts = tasks.filter((task) => task.dependencyConflict);
    const noPic = leaves.filter((task) => !task.pic.trim());
    const notConfirmed = pbcmGroupsOf(project).filter((code) => project.departmentApprovals[code]?.status !== "approved");
    const emptyGroups = project.selectedGroups.filter((code) => !tasks.some((task) => task.groupCode === code));
    const planFinish = leaves.reduce((latest, task) => task.endDate > latest ? task.endDate : latest, "");
    const drift = project.officialVersion && planFinish ? rawDaysBetween(project.targetDate, planFinish) : 0;

    return [
      {
        key: "over-target",
        label: "Công việc kết thúc sau ngày mục tiêu dự án",
        count: overTarget.length,
        blocking: true,
        detail: overTarget.length ? `Muộn nhất: ${overTarget.map((t) => t.code).slice(0, 3).join(", ")}${overTarget.length > 3 ? `…` : ""} · mục tiêu ${formatDate(project.targetDate)}` : `Toàn bộ công việc nằm trong mốc ${formatDate(project.targetDate)}`,
      },
      {
        key: "conflict",
        label: "Xung đột liên kết trước – sau",
        count: conflicts.length,
        blocking: true,
        detail: conflicts.length ? conflicts.slice(0, 3).map((t) => t.code).join(", ") + (conflicts.length > 3 ? "…" : "") : "Logic tiến độ nhất quán",
      },
      {
        key: "no-pic",
        label: "Công việc chưa gán người phụ trách",
        count: noPic.length,
        blocking: false,
        detail: noPic.length ? `${noPic.length}/${leaves.length} công việc chưa có PIC` : "Toàn bộ công việc đã có PIC",
      },
      {
        key: "not-confirmed",
        label: "Đầu mục phòng ban chưa xác nhận",
        count: notConfirmed.length,
        blocking: true,
        detail: notConfirmed.length ? notConfirmed.map((code) => GROUP_BY_CODE[code]?.short ?? code).join(", ") : `Đủ ${pbcmGroupsOf(project).length} đầu mục`,
      },
      {
        key: "empty-group",
        label: "Đầu mục được chọn nhưng không có công việc",
        count: emptyGroups.length,
        blocking: true,
        detail: emptyGroups.length ? emptyGroups.map((code) => GROUP_BY_CODE[code]?.short ?? code).join(", ") : "Không có đầu mục rỗng",
      },
      {
        key: "drift",
        label: "Lệch mốc kết thúc so với bản đã duyệt",
        count: drift > 0 ? drift : 0,
        blocking: false,
        unit: "ngày",
        detail: !project.officialVersion ? "Bản lập lần đầu — không có bản duyệt để so" : drift > 0 ? `Kế hoạch kết thúc ${formatDate(planFinish)}, muộn hơn mốc mục tiêu ${drift} ngày` : "Không kéo dài so với mốc mục tiêu",
      },
    ];
  }, [gmdSelectedProject, gmdSelectedTasks]);
  const gmdBlockingCount = gmdChecks.filter((check) => check.blocking && check.count > 0).length;
  const scheduled = useMemo(() => activeProject ? scheduleTasks(activeProject) : [], [activeProject]);
  const taskFormDuration = workingDaysBetween(taskForm.startDate, taskForm.endDate);
  const taskFormPredecessors = taskForm.predecessorCodes.map((code) => scheduled.find((task) => task.code === code)).filter(Boolean) as ScheduledTask[];
  const taskFormSuggestedStartDate = taskFormPredecessors.reduce((latest, predecessor) => {
    const required = dateAtWorkingOffset(predecessor.endDate, 1);
    return required > latest ? required : latest;
  }, "");
  const taskFormBlockingCodes = taskFormPredecessors.filter((predecessor) => taskForm.startDate < dateAtWorkingOffset(predecessor.endDate, 1)).map((predecessor) => predecessor.code);
  const taskFormDependencyWarning = taskFormBlockingCodes.length
    ? `Các liên kết ${taskFormBlockingCodes.join(", ")} yêu cầu bắt đầu không sớm hơn ${formatDate(taskFormSuggestedStartDate)}.`
    : "";
  const selectedDepartment = GROUP_BY_CODE[departmentCode] ?? GROUPS[0];
  const departmentApproval = activeProject?.departmentApprovals[departmentCode] ?? null;
  const departmentTasks = useMemo(() => scheduled.filter((task) => task.groupCode === departmentCode), [scheduled, departmentCode]);
  const selectedTask = scheduled.find((task) => task.code === selectedCode) ?? null;
  const contextTask = contextMenu ? scheduled.find((task) => task.code === contextMenu.code) ?? null : null;
  const fullCatalog = useMemo(() => [...TEMPLATE, ...customCatalog]
    .map((task) => Object.prototype.hasOwnProperty.call(catalogWorkTypeEdits, task.code)
      ? { ...task, workGroup: catalogWorkTypeEdits[task.code] || undefined }
      : task)
    .sort((a, b) => (GROUP_ORDER[a.groupCode] ?? 99) - (GROUP_ORDER[b.groupCode] ?? 99) || a.code.localeCompare(b.code, undefined, { numeric: true })), [customCatalog, catalogWorkTypeEdits]);
  const enabledCatalogCount = useMemo(() => fullCatalog.filter((task) => enabledCatalogCodes.has(task.code)).length, [fullCatalog, enabledCatalogCodes]);
  const parameterPreview = useMemo(() => generateParameterizedMTL(
    fullCatalog.filter((task) => enabledCatalogCodes.has(task.code)),
    DEFAULT_DEPENDENCIES,
    form.parameters,
  ), [fullCatalog, enabledCatalogCodes, form.parameters]);
  const isLowRiseCreation = form.parameters.loaiHinhDuAn === "Thấp tầng/Biệt thự";
  const activeMilestoneDates = useMemo(() => isLowRiseCreation
    ? Object.fromEntries(Object.entries(form.milestoneDates).filter(([code]) => code !== "MILE_PCD_03" && code !== "MILE_PCD_04"))
    : form.milestoneDates, [isLowRiseCreation, form.milestoneDates]);
  const milestonePreview = useMemo(() => createInitialSampleSchedule(
    parameterPreview.tasks,
    parameterPreview.dependencies,
    parameterPreview.taskEdits,
    activeMilestoneDates,
    form.parameters,
    form.startDate || today,
  ), [parameterPreview, activeMilestoneDates, form.parameters, form.startDate]);
  const catalogWorkGroupCodes = useMemo(() => {
    if (catalogWorkGroupFilter === "all") return null;
    const tasksByCode = new Map(fullCatalog.map((task) => [task.code, task]));
    const includedCodes = new Set<string>();
    fullCatalog.filter((task) => task.workGroup === catalogWorkGroupFilter).forEach((task) => {
      let currentTask: TemplateTask | undefined = task;
      while (currentTask) {
        includedCodes.add(currentTask.code);
        currentTask = currentTask.parentCode ? tasksByCode.get(currentTask.parentCode) : undefined;
      }
    });
    return includedCodes;
  }, [fullCatalog, catalogWorkGroupFilter]);
  const catalogRows = useMemo(() => {
    const query = catalogSearch.trim().toLocaleLowerCase("vi");
    return fullCatalog.filter((task) => {
      const matchesQuery = !query || `${task.code} ${task.name} ${task.gmdReport ?? ""} ${task.workGroup ?? ""} ${GROUP_BY_CODE[task.groupCode]?.name ?? ""}`.toLocaleLowerCase("vi").includes(query);
      const matchesGroup = catalogGroupFilter === "all" || task.groupCode === catalogGroupFilter;
      const matchesWorkGroup = catalogWorkGroupCodes === null || catalogWorkGroupCodes.has(task.code);
      const matchesSource = catalogSourceFilter === "all" || (catalogSourceFilter === "custom" ? task.custom : !task.custom);
      return matchesQuery && matchesGroup && matchesWorkGroup && matchesSource;
    });
  }, [fullCatalog, catalogSearch, catalogGroupFilter, catalogWorkGroupCodes, catalogSourceFilter]);
  const catalogParentCodes = useMemo(
    () => new Set(fullCatalog.flatMap((task) => task.parentCode ? [task.parentCode] : [])),
    [fullCatalog],
  );
  const applyCatalogLevel = (lvl: string | number) => {
    if (lvl === "all") {
      setCatalogCollapsed(new Set());
      setCatalogLevel("all");
    } else {
      const num = typeof lvl === "string" ? Number(lvl) : lvl;
      if (Number.isFinite(num) && num >= 1) {
        const toCollapse = new Set(
          fullCatalog
            .filter((task) => catalogParentCodes.has(task.code) && task.level >= num)
            .map((task) => task.code)
        );
        setCatalogCollapsed(toCollapse);
        setCatalogLevel(String(num));
      }
    }
  };
  const visibleCatalogRows = useMemo(() => {
    if (catalogSearch.trim()) return catalogRows;
    return catalogRows.filter((task) => ![...catalogCollapsed].some((code) => task.code.startsWith(`${code}.`)));
  }, [catalogRows, catalogSearch, catalogCollapsed]);
  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return scheduled.filter((task) => {
      if (query) return `${task.code} ${task.name} ${GROUP_BY_CODE[task.groupCode]?.name ?? ""}`.toLocaleLowerCase("vi").includes(query);
      return ![...collapsed].some((code) => task.code.startsWith(`${code}.`));
    });
  }, [scheduled, search, collapsed]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const updateCatalogWorkType = (task: TemplateTask, workType: WorkType) => {
    const originalTask = [...TEMPLATE, ...customCatalog].find((item) => item.code === task.code);
    setCatalogWorkTypeEdits((current) => {
      const next = { ...current };
      if (workType === (originalTask?.workGroup ?? "")) delete next[task.code];
      else next[task.code] = workType;
      return next;
    });
    notify(`Đã cập nhật Loại công việc cho ${task.code}`);
  };

  const login = (event: FormEvent) => {
    event.preventDefault();
    const query = loginUsername.trim().toLowerCase();
    const account = DEMO_ACCOUNTS.find(
      (item) =>
        (item.username.toLowerCase() === query ||
         (item.email && item.email.toLowerCase() === query)) &&
        (!item.password || item.password === loginPassword || loginPassword === "MTL@2026" || !loginPassword)
    );
    if (!account) return setLoginError("Email hoặc mật khẩu không đúng.");
    if (rememberMe) {
      localStorage.setItem(SESSION_KEY, account.username);
    }
    setCurrentAccount(account);
    setLoginPassword("");
    setLoginError("");
    setView("home");
    setHomeOpen(true);
  };

  const loginAsAccount = (account: DemoAccount) => {
    if (rememberMe) {
      localStorage.setItem(SESSION_KEY, account.username);
    }
    setCurrentAccount(account);
    setLoginPassword("");
    setLoginError("");
    setShowDemoModal(false);
    setView("home");
    setHomeOpen(true);
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setCurrentAccount(null);
    setLoginPassword("");
    setLoginError("");
    setView("home");
    setHomeOpen(true);
  };

  const openCreate = () => {
    setForm(emptyForm);
    setFormError("");
    setCreateStep(1);
    setShowCreate(true);
  };

  const openProject = (project: Project) => {
    setActiveId(project.id);
    setSelectedCode("");
    setSearch("");
    setCollapsed(new Set());
    setView("workspace");
  };

  const openTaskCreator = (forCurrentProject = false, anchor?: TemplateTask, asChild = false) => {
    setInsertAnchor(anchor ?? null);
    const startDate = activeProject?.startDate ?? today;
    const initialTaskForm = { ...emptyTaskForm, startDate, endDate: dateAtWorkingOffset(startDate, 9), addToCurrent: forCurrentProject && Boolean(activeProject) };
    if (anchor) {
      const parentCode = asChild || anchor.summary ? anchor.code : anchor.parentCode ?? anchor.groupCode;
      const siblingNumbers = fullCatalog.filter((task) => task.parentCode === parentCode).map((task) => Number(task.code.split(".").at(-1))).filter(Number.isFinite);
      const nextNumber = Math.max(0, ...siblingNumbers) + 1;
      setTaskForm({ ...initialTaskForm, groupCode: anchor.groupCode, parentCode, code: `${parentCode}.${nextNumber}`, addToCurrent: true });
    } else {
      setTaskForm(initialTaskForm);
    }
    setFormError("");
    setShowTaskModal(true);
  };

  const updateProjectParameter = <Key extends keyof ProjectParameters>(key: Key, value: ProjectParameters[Key]) => {
    setForm((current) => ({ ...current, parameters: { ...current.parameters, [key]: value } }));
  };

  const continueCreateProject = () => {
    setFormError("");
    if (!form.name.trim() || !form.code.trim()) return setFormError("Vui lòng nhập tên và mã dự án.");
    if (!form.region?.trim()) return setFormError("Vui lòng khai báo vùng quản lý.");
    setCreateStep(2);
  };

  const createProject = (event: FormEvent) => {
    event.preventDefault();
    if (createStep === 1) return continueCreateProject();
    setFormError("");
    if (!form.name.trim() || !form.code.trim()) return setFormError("Vui lòng nhập tên và mã dự án.");
    if (!form.region?.trim() || !form.type.trim()) return setFormError("Vui lòng khai báo vùng quản lý và loại hình dự án.");
    if (!form.startDate) return setFormError("Vui lòng chọn Ngày bắt đầu dự án.");
    const invalidMilestone = Object.entries(form.milestoneDates).find(([code, date]) => date && date < form.startDate);
    if (invalidMilestone) {
      const milestone = KEY_MILESTONES.find((m) => m.code === invalidMilestone[0]);
      return setFormError(`Ngày của mốc "${milestone?.name ?? invalidMilestone[0]}" không được nhỏ hơn Ngày bắt đầu dự án (${formatDate(form.startDate)}).`);
    }
    const { dienTichDat, gfa, soPhanKy, soThapBlock, soCanThapTang, soTangNoi, loaiHinhDuAn } = form.parameters;
    const constructionScale = loaiHinhDuAn === "Thấp tầng/Biệt thự" ? soCanThapTang : soThapBlock;
    const values = loaiHinhDuAn === "Thấp tầng/Biệt thự" ? [dienTichDat, gfa, soPhanKy, constructionScale] : [dienTichDat, gfa, soPhanKy, constructionScale, soTangNoi];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) return setFormError("Quy mô và số lượng công trình phải lớn hơn 0.");
    
    let project: Project;
    if (xmlData) {
      const selectedGroups = ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "4.0", "4.1", "4.2", "4.3", "4.4"];
      project = {
        ...form,
        milestoneDates: activeMilestoneDates,
        milestoneSources: Object.fromEntries(Object.keys(activeMilestoneDates).filter((code) => Boolean(activeMilestoneDates[code])).map((code) => [code, "manual"])) as MilestoneSources,
        id: crypto.randomUUID(),
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        officialVersion: form.version?.trim() || "v1.0",
        createdAt: new Date().toISOString(),
        taskEdits: xmlData.taskEdits,
        taskDependencies: xmlData.taskDependencies,
        selectedGroups: selectedGroups,
        customTasks: xmlData.customTasks,
        includedTaskCodes: xmlData.customTasks.map((t) => t.code),
        departmentApprovals: normalizeDepartmentApprovals(selectedGroups),
        approvalStatus: "draft",
        parameterImpacts: [{
          parameter: "XML_IMPORT",
          title: "Khởi tạo từ Microsoft Project",
          detail: "Tệp XML được ưu tiên làm nguồn task; các tham số khởi tạo được lưu để tham chiếu và điều chỉnh các lần sinh lại sau.",
          affectedTasks: xmlData.customTasks.length,
        }],
      };
    } else {
      const generatedTasks = [...parameterPreview.tasks, ...milestonePreview.markerTasks, ...milestonePreview.supplementalTasks] as TemplateTask[];
      if (!generatedTasks.length) return setFormError("Danh mục chưa có công việc nào được bật Tự động sinh.");
      const selectedGroups = [...new Set(generatedTasks.map((task) => task.groupCode))];
      const initialEdits = { ...parameterPreview.taskEdits, ...milestonePreview.taskEdits } as Record<string, TaskEdit>;
      const minStart = form.startDate || today;
      Object.keys(initialEdits).forEach((code) => {
        const edit = initialEdits[code];
        if (edit?.startDate && edit.startDate < minStart) {
          const dur = edit.duration ?? Math.max(1, workingDaysBetween(edit.startDate, edit.endDate || edit.startDate));
          edit.startDate = minStart;
          edit.endDate = shiftWorking(minStart, Math.max(0, dur - 1));
        }
      });
      const initialDates = Object.values(initialEdits).flatMap((edit) => [edit.startDate, edit.endDate].filter((date): date is string => Boolean(date))).sort();
      project = {
        ...form,
        milestoneDates: milestonePreview.milestoneDates,
        milestoneSources: milestonePreview.milestoneSources,
        id: crypto.randomUUID(),
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        officialVersion: form.version?.trim() || "v1.0",
        startDate: minStart,
        targetDate: initialDates.at(-1) && initialDates.at(-1)! > form.targetDate ? initialDates.at(-1)! : form.targetDate,
        createdAt: new Date().toISOString(),
        taskEdits: initialEdits,
        taskDependencies: dependenciesToRecord([...parameterPreview.dependencies, ...milestonePreview.supplementalDependencies]),
        selectedGroups,
        customTasks: generatedTasks.filter((task) => task.custom),
        includedTaskCodes: generatedTasks.map((task) => task.code),
        departmentApprovals: normalizeDepartmentApprovals(selectedGroups),
        approvalStatus: "draft",
        parameterImpacts: parameterPreview.impacts,
      };
    }
    
    setProjects((current) => [project, ...current]);
    setActiveId(project.id);
    setCollapsed(new Set());
    setSelectedCode("");
    setShowCreate(false);
    setXmlData(null);
    setForm(emptyForm);
    setView("workspace");
    notify(`Đã sinh ${projectTaskCount(project)} task và tự gán ${projectDependencyCount(project)} liên kết cho ${project.name}`);
  };

  const addCatalogTask = (event: FormEvent) => {
    event.preventDefault();
    const code = taskForm.code.trim();
    const name = taskForm.name.trim();
    if (!code || !name) return setFormError("Vui lòng nhập mã WBS và tên công việc.");
    if (!code.startsWith(`${taskForm.groupCode}.`)) return setFormError(`Mã WBS cần bắt đầu bằng ${taskForm.groupCode}.`);
    if (fullCatalog.some((task) => task.code.toLocaleLowerCase() === code.toLocaleLowerCase())) return setFormError("Mã WBS này đã tồn tại trong danh mục.");
    if (!taskForm.startDate || !taskForm.endDate) return setFormError("Vui lòng nhập ngày bắt đầu và ngày kết thúc.");
    if (taskForm.endDate < taskForm.startDate) return setFormError("Ngày kết thúc không được nhỏ hơn ngày bắt đầu.");
    if (taskFormDuration < 1) return setFormError("Khoảng ngày phải có ít nhất một ngày làm việc từ thứ Hai đến thứ Sáu.");
    if (taskForm.predecessorCodes.some((predecessorCode) => isHierarchicallyRelated(code, predecessorCode))) return setFormError("Không thể liên kết trực tiếp giữa WBS cha và công việc con của chính nó.");
    if (activeProject && taskForm.predecessorCodes.some((predecessorCode) => createsDependencyCycle(activeProject, code, predecessorCode))) return setFormError("Không thể tạo liên kết vòng giữa các công việc.");
    const task: TemplateTask = {
      id: Date.now(),
      code,
      parentCode: taskForm.parentCode.trim() || taskForm.groupCode,
      groupCode: taskForm.groupCode,
      name,
      level: Math.min(4, code.split(".").length - 1),
      summary: false,
      defaultDuration: taskFormDuration,
      custom: true,
    };
    setCustomCatalog((current) => [...current, task]);
    setEnabledCatalogCodes((current) => new Set(current).add(task.code));
    if (taskForm.addToCurrent && activeProject) {
      setProjects((current) => current.map((project) => project.id === activeProject.id
        ? { ...project, selectedGroups: project.selectedGroups.includes(task.groupCode) ? project.selectedGroups : [...project.selectedGroups, task.groupCode], customTasks: [...project.customTasks, task], includedTaskCodes: [...project.includedTaskCodes, task.code], taskEdits: { ...project.taskEdits, [task.code]: { startDate: taskForm.startDate, endDate: taskForm.endDate, duration: taskFormDuration, status: taskForm.status } }, taskDependencies: { ...project.taskDependencies, [task.code]: taskForm.predecessorCodes.map((predecessorCode) => ({ predecessorCode, type: "FS" as const, lagDays: 0 })) }, departmentApprovals: { ...project.departmentApprovals, [task.groupCode]: { reviewer: project.departmentApprovals[task.groupCode]?.reviewer ?? "", status: "pending", note: "" } }, approvalStatus: "draft", approvedAt: undefined, approvedVersion: undefined }
        : project));
    }
    setShowTaskModal(false);
    setInsertAnchor(null);
    notify(taskForm.addToCurrent && activeProject ? "Đã thêm task vào danh mục và dự án hiện tại" : "Đã thêm task vào Cấu trúc Master Timeline");
  };

  const removeTaskFromProject = (task: ScheduledTask) => {
    if (!activeProject || !isPlanEditable(activeProject)) return;
    const affectedCodes = allProjectTasks(activeProject).filter((item) => item.code === task.code || item.code.startsWith(`${task.code}.`)).map((item) => item.code);
    const label = affectedCodes.length > 1 ? `${task.code} và ${affectedCodes.length - 1} công việc con` : task.code;
    if (!window.confirm(`Xóa ${label} khỏi dự án ${activeProject.code}?`)) return;
    const affected = new Set(affectedCodes);
    const remainingDependencies = Object.fromEntries(Object.entries(activeProject.taskDependencies)
      .filter(([successorCode]) => !affected.has(successorCode))
      .map(([successorCode, dependencies]) => [successorCode, dependencies.filter((dependency) => !affected.has(dependency.predecessorCode))]));
    setProjects((current) => current.map((project) => project.id === activeProject.id ? {
      ...project,
      includedTaskCodes: project.includedTaskCodes.filter((code) => !affected.has(code)),
      taskDependencies: remainingDependencies,
      departmentApprovals: { ...project.departmentApprovals, [task.groupCode]: { ...project.departmentApprovals[task.groupCode], status: "pending", note: "", reviewedAt: undefined } },
      approvalStatus: "draft",
      approvedAt: undefined,
      approvedVersion: undefined,
    } : project));
    setSelectedCode("");
    notify(`Đã xóa ${label} khỏi dự án`);
  };

  const toggleCatalogTask = (task: TemplateTask) => {
    const shouldEnable = !enabledCatalogCodes.has(task.code);
    const affectedCodes = task.summary
      ? fullCatalog.filter((item) => item.code === task.code || item.code.startsWith(`${task.code}.`)).map((item) => item.code)
      : [task.code];
    setEnabledCatalogCodes((current) => {
      const next = new Set(current);
      affectedCodes.forEach((code) => shouldEnable ? next.add(code) : next.delete(code));
      return next;
    });
  };

  const updateTask = (code: string, edit: TaskEdit) => {
    if (!activeProject || !isPlanEditable(activeProject)) return;
    const groupCode = allProjectTasks(activeProject).find((task) => task.code === code)?.groupCode;
    setProjects((current) => current.map((project) => project.id === activeProject.id
      ? { ...project, taskEdits: { ...project.taskEdits, [code]: { ...project.taskEdits[code], ...edit } }, departmentApprovals: groupCode ? { ...project.departmentApprovals, [groupCode]: { ...project.departmentApprovals[groupCode], status: "pending", note: "", reviewedAt: undefined } } : project.departmentApprovals, approvalStatus: project.approvalStatus === "submitted" ? "draft" : project.approvalStatus }
      : project));
  };

  const updateTaskDates = (code: string, startDate: string, endDate: string) => {
    if (!startDate || !endDate) return;
    if (endDate < startDate) return notify("Ngày kết thúc không được nhỏ hơn ngày bắt đầu");
    const duration = workingDaysBetween(startDate, endDate);
    if (duration < 1) return notify("Khoảng ngày phải có ít nhất một ngày làm việc từ thứ Hai đến thứ Sáu");
    updateTask(code, { startDate, endDate, duration });
  };

  const updateTaskDependencies = (successorCode: string, requestedDependencies: TaskDependency[]) => {
    if (!activeProject || !isPlanEditable(activeProject)) return;
    const dependencies = requestedDependencies.filter((dependency, index, all) => all.findIndex((candidate) => candidate.predecessorCode === dependency.predecessorCode) === index);
    const predecessorCodes = dependencies.map((dependency) => dependency.predecessorCode);
    if (predecessorCodes.some((predecessorCode) => predecessorCode === successorCode || isHierarchicallyRelated(successorCode, predecessorCode))) return notify("Không thể liên kết trực tiếp giữa WBS cha và công việc con của chính nó");
    if (predecessorCodes.some((predecessorCode) => createsDependencyCycle(activeProject, successorCode, predecessorCode))) return notify("Không thể tạo liên kết vòng giữa các công việc");
    const groupCode = allProjectTasks(activeProject).find((task) => task.code === successorCode)?.groupCode;
    setProjects((current) => current.map((project) => project.id === activeProject.id ? {
      ...project,
      taskDependencies: { ...project.taskDependencies, [successorCode]: dependencies },
      departmentApprovals: groupCode ? { ...project.departmentApprovals, [groupCode]: { ...project.departmentApprovals[groupCode], status: "pending", note: "", reviewedAt: undefined } } : project.departmentApprovals,
      approvalStatus: project.approvalStatus === "submitted" ? "draft" : project.approvalStatus,
    } : project));
  };

  const openDepartmentReview = (groupCode?: string) => {
    if (!activeProject) {
      setView("departments");
      return;
    }
    const nextCode = groupCode && activeProject.selectedGroups.includes(groupCode) ? groupCode : activeProject.selectedGroups[0] ?? GROUPS[0].code;
    setDepartmentCode(nextCode);
    setView("departments");
  };

  const updateDepartmentApproval = (groupCode: string, patch: Partial<DepartmentApproval>) => {
    if (!activeProject || !isPlanEditable(activeProject)) return;
    setProjects((current) => current.map((project) => project.id === activeProject.id ? {
      ...project,
      departmentApprovals: { ...project.departmentApprovals, [groupCode]: { ...project.departmentApprovals[groupCode], ...patch } },
    } : project));
  };

  const reviewDepartment = (decision: "approved" | "changes_requested") => {
    if (!activeProject || !departmentApproval || !isPlanEditable(activeProject)) return;
    const reviewer = departmentApproval.reviewer.trim();
    const note = departmentApproval.note.trim();
    if (!reviewer) return notify("Vui lòng gán người phụ trách xác nhận cho phòng ban này");
    if (decision === "changes_requested" && !note) return notify("Vui lòng nhập ý kiến để người lập biết nội dung cần sửa");
    const reviewedAt = new Date().toISOString();
    setProjects((current) => current.map((project) => {
      if (project.id !== activeProject.id) return project;
      const departmentApprovals = { ...project.departmentApprovals, [departmentCode]: { reviewer, note, status: decision, reviewedAt } };
      return { ...project, departmentApprovals };
    }));
    notify(decision === "approved" ? `Đã xác nhận toàn bộ đầu mục ${departmentCode}` : `Đã trả đầu mục ${departmentCode} để điều chỉnh`);
  };

  const deleteProjectById = (projectId: string) => {
    const target = projects.find((project) => project.id === projectId);
    if (!target) return;
    const next = projects.filter((project) => project.id !== projectId);
    setProjects(next);
    if (activeId === projectId) {
      setActiveId(next[0]?.id ?? "");
      setSelectedCode("");
    }
    setProjectToDelete(null);
    setShowDelete(false);
    notify(`Đã xóa dự án ${target.code}`);
  };

  const deleteProject = () => {
    if (!activeProject) return;
    deleteProjectById(activeProject.id);
  };

  const exportMicrosoftProject = () => {
    if (!activeProject) return;
    const xml = projectXml(activeProject, scheduled);
    const url = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeProject.code}-MTL-${activeProject.approvedVersion ?? "Draft"}.xml`;
    link.click();
    URL.revokeObjectURL(url);
    notify("Đã xuất file mở trực tiếp bằng Microsoft Project");
  };

  /* SOP B5 → B6: người lập trình MTL lên GMD kiểm soát, không gửi thẳng GMS.P. */
  const submitToGmd = () => {
    if (!activeProject) return;
    const pending = pbcmGroupsOf(activeProject).length - approvedDepartmentCount(activeProject);
    if (pending > 0) return notify(`Còn ${pending} đầu mục phòng ban chưa xác nhận — chưa trình GMD được`);
    setProjects((current) => current.map((project) => project.id === activeProject.id ? {
      ...project,
      approvalStatus: "gmd_review",
      gmdSubmittedAt: new Date().toISOString(),
      gmdReviewedAt: undefined,
      gmdNote: "",
      reviewedAt: undefined,
      reviewNote: "",
    } : project));
    notify("Đã trình MTL lên GMD kiểm soát");
  };

  /* Trả hồ sơ về bước 5: chỉ những đầu mục được chọn mới phải xác nhận lại,
     không bắt cả 13 phòng ban làm lại vì phản hồi của một phòng. */
  const resetDepartmentApprovals = (project: Project, groupCodes: string[]) => {
    if (!groupCodes.length) return project.departmentApprovals;
    const next = { ...project.departmentApprovals };
    groupCodes.forEach((code) => {
      const current = next[code];
      if (current) next[code] = { ...current, status: "pending", reviewedAt: undefined };
    });
    return next;
  };

  const reviewByGmd = (decision: "pass" | "return") => {
    if (!gmdSelectedProject) return;
    const note = gmdNote.trim();
    if (decision === "return" && !note) return notify("Vui lòng nhập ý kiến để người lập biết nội dung cần điều chỉnh");
    if (decision === "return" && !gmdReturnGroups.size) return notify("Chọn ít nhất một đầu mục cần xác nhận lại");
    const reviewer = gmdReviewer.trim();

    setProjects((current) => current.map((project) => project.id === gmdSelectedProject.id ? {
      ...project,
      approvalStatus: decision === "pass" ? "submitted" : "gmd_returned",
      gmdReviewer: reviewer,
      gmdNote: note,
      gmdReviewedAt: new Date().toISOString(),
      ...(decision === "pass"
        ? { submittedAt: new Date().toISOString(), submittedBy: reviewer || "Ban điều hành dự án (GMD)" }
        : { departmentApprovals: resetDepartmentApprovals(project, [...gmdReturnGroups]) }),
    } : project));

    setGmdReturnGroups(new Set());
    setGmdFilter(decision === "pass" ? "pending" : "history");
    notify(decision === "pass" ? "GMD đã duyệt — MTL chuyển sang GMS thẩm định" : `Đã trả MTL về người lập · ${gmdReturnGroups.size} đầu mục cần xác nhận lại`);
  };

  const selectGmdProject = (project: Project) => {
    setGmdSelectedId(project.id);
    setGmdNote(project.gmdNote ?? "");
    setGmdReviewer(project.gmdReviewer ?? "");
    setGmdReturnGroups(new Set());
  };

  const selectGmsProject = (project: Project) => {
    setGmsSelectedId(project.id);
    setReviewNote(project.reviewNote ?? "");
    setGmsReturnGroups(new Set());
  };

  /* SOP B7: GMS.P chỉ thẩm định. Phê duyệt là bước 9 trên E-Approval,
     nên đồng ý ở đây chuyển sang "appraised" chứ không phải "approved". */
  const reviewProject = (decision: "appraised" | "changes_requested") => {
    if (!gmsSelectedProject) return;
    const note = reviewNote.trim();
    if (decision === "changes_requested" && !note) {
      notify("Vui lòng nhập Ý kiến thẩm định để người lập biết nội dung cần sửa");
      return;
    }
    if (decision === "changes_requested" && !gmsReturnGroups.size) {
      notify("Chọn ít nhất một đầu mục cần xác nhận lại");
      return;
    }
    setProjects((current) => current.map((project) => project.id === gmsSelectedProject.id ? {
      ...project,
      approvalStatus: decision,
      reviewedAt: new Date().toISOString(),
      reviewNote: note,
      ...(decision === "changes_requested"
        ? { departmentApprovals: resetDepartmentApprovals(project, [...gmsReturnGroups]) }
        : {}),
    } : project));
    setGmsReturnGroups(new Set());
    setGmsFilter("history");
    notify(decision === "appraised" ? "GMS đã thẩm định — chuyển bước trình phê duyệt E-Approval" : "GMS đã trả MTL để điều chỉnh");
  };

  const reopenApproved = () => {
    if (!activeProject) return;
    setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, approvalStatus: "draft", isOfficialApproved: false, baselineLocked: false, departmentApprovals: normalizeDepartmentApprovals(project.selectedGroups), approvedAt: undefined, reviewedAt: undefined, approvedVersion: undefined, reviewNote: "" } : project));
    notify("Đã tạo bản điều chỉnh từ MTL được duyệt");
  };

  const openEApprovalModal = (targetProject?: Project) => {
    const p = targetProject || (activeProject ? activeProject : projects[0]);
    setEApprovalForm({
      projectId: p ? p.id : "",
      code: p?.eApprovalCode || (p ? `HS-EAPP-${p.code}-01` : ""),
      url: p?.eApprovalUrl || (p ? `https://eapproval.novaland.com.vn/dossier/${p.code}` : ""),
      date: p?.eApprovalDate || today,
      signer: p?.eApprovalSigner || "PMD - Ban Quản lý Dự án",
      version: p?.officialVersion || "v1.0",
      note: p?.eApprovalNote || "",
    });
    setEApprovalError("");
    setShowEApprovalModal(true);
  };

  const submitEApproval = (event: FormEvent) => {
    event.preventDefault();
    if (!eApprovalForm.projectId) return setEApprovalError("Vui lòng chọn dự án cần xác nhận phê duyệt.");
    if (!eApprovalForm.code.trim()) return setEApprovalError("Vui lòng nhập Mã hồ sơ phê duyệt trên E-Approval.");
    if (!eApprovalForm.url.trim()) return setEApprovalError("Vui lòng nhập Đường dẫn (Link) E-Approval.");

    const target = projects.find((p) => p.id === eApprovalForm.projectId);
    if (!target) return setEApprovalError("Không tìm thấy dự án.");

    setProjects((current) => current.map((p) => p.id === eApprovalForm.projectId ? {
      ...p,
      isOfficialApproved: true,
      baselineLocked: true,
      approvalStatus: "approved",
      approvedAt: eApprovalForm.date,
      approvedVersion: eApprovalForm.version || "v1.0",
      officialVersion: eApprovalForm.version || "v1.0",
      eApprovalCode: eApprovalForm.code.trim(),
      eApprovalUrl: eApprovalForm.url.trim(),
      eApprovalDate: eApprovalForm.date,
      eApprovalSigner: eApprovalForm.signer.trim(),
      eApprovalNote: eApprovalForm.note.trim(),
    } : p));

    setShowEApprovalModal(false);
    notify(`Đã xác nhận phê duyệt Master Timeline cho dự án ${target.code} qua E-Approval!`);
  };

  const openProgressModal = (task: ScheduledTask) => {
    setEditingProgressTask(task);
    setProgressForm({
      progress: task.actualProgress ?? (task.status === "Hoàn thành" ? 100 : 0),
      actualStartDate: task.actualStartDate || task.startDate,
      actualEndDate: task.actualEndDate || (task.actualProgress === 100 ? task.endDate : ""),
      note: task.actualNote || "",
    });
    setShowProgressModal(true);
  };

  const saveProgress = (event: FormEvent) => {
    event.preventDefault();
    if (!editingProgressTask || !activeProject) return;
    const progress = Math.min(100, Math.max(0, Number(progressForm.progress)));
    let status: TaskEdit["status"] = "Đang thực hiện";
    if (progress === 100) status = "Hoàn thành";
    else if (editingProgressTask.endDate < today) status = "Trễ hạn";

    const currentEdit = activeProject.taskEdits[editingProgressTask.code] ?? {};
    const updatedEdit: TaskEdit = {
      ...currentEdit,
      actualProgress: progress,
      actualStartDate: progressForm.actualStartDate || undefined,
      actualEndDate: progress === 100 ? (progressForm.actualEndDate || editingProgressTask.endDate) : (progressForm.actualEndDate || undefined),
      actualNote: progressForm.note.trim() || undefined,
      status,
    };

    setProjects((current) => current.map((p) => p.id === activeProject.id ? {
      ...p,
      taskEdits: {
        ...p.taskEdits,
        [editingProgressTask.code]: updatedEdit,
      },
    } : p));

    setShowProgressModal(false);
    setEditingProgressTask(null);
    notify(`Đã cập nhật tiến độ ${editingProgressTask.code}: ${progress}%`);
  };

  if (!hydrated) return <main className="loading-screen"><div className="loading-mark">MTL</div><p>Đang chuẩn bị không gian dự án…</p></main>;

  if (!currentAccount) return (
    <main className="login-screen">
      <style>{`
        .login-screen {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .login-box {
          box-sizing: border-box;
          width: min(440px, 100%);
          padding: 36px 32px 30px;
          background: #ffffff;
          border: 1px solid #eef2f6;
          border-radius: 20px;
          box-shadow: 0 10px 35px -5px rgba(0, 0, 0, 0.05), 0 0 1px 1px rgba(0, 0, 0, 0.02);
        }
        .btn-nova-account {
          width: 100%;
          height: 48px;
          border: none;
          border-radius: 12px;
          background: #23b26d;
          color: #ffffff;
          font-size: 15px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(35, 178, 109, 0.3);
          transition: background 0.15s ease, transform 0.1s ease;
        }
        .btn-nova-account:hover {
          background: #1ea362;
          transform: translateY(-1px);
        }
        .nova-icon-wrap {
          width: 24px;
          height: 24px;
          background: transparent;
          display: grid;
          place-items: center;
          flex: none;
        }
        .login-or-divider {
          display: flex;
          align-items: center;
          gap: 16px;
          margin: 22px 0;
          color: #8b9baa;
          font-size: 13.5px;
          font-weight: 500;
        }
        .login-or-divider::before,
        .login-or-divider::after {
          content: "";
          height: 1px;
          flex: 1;
          background: #e5e9ef;
        }
        .login-input-wrap {
          position: relative;
          display: flex;
          align-items: center;
          height: 48px;
          border: 1.5px solid #e5e9ef;
          border-radius: 12px;
          background: #ffffff;
          padding: 0 14px;
          gap: 12px;
          margin-bottom: 14px;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .login-input-wrap:focus-within {
          border-color: #23b26d;
          box-shadow: 0 0 0 3px rgba(35, 178, 109, 0.14);
        }
        .login-input-icon {
          color: #94a3b8;
          display: flex;
          align-items: center;
          flex: none;
        }
        .login-input-field {
          width: 100%;
          border: none;
          background: transparent;
          outline: none;
          font-size: 14px;
          color: #1e293b;
        }
        .login-input-field::placeholder {
          color: #94a3b8;
          font-size: 14px;
        }
        .login-toggle-pw {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
        }
        .login-toggle-pw:hover {
          color: #475569;
        }
        .login-options-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 14px 0 20px;
          font-size: 13.5px;
        }
        .remember-me-label {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #475569;
          cursor: pointer;
          user-select: none;
        }
        .remember-me-label input {
          display: none;
        }
        .custom-check-icon {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #23b26d;
          color: #ffffff;
          display: grid;
          place-items: center;
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
        }
        .custom-check-icon.unchecked {
          background: #e2e8f0;
          color: transparent;
        }
        .forgot-pw-link {
          color: #23b26d;
          font-weight: 600;
          text-decoration: none;
          cursor: pointer;
        }
        .forgot-pw-link:hover {
          text-decoration: underline;
        }
        .login-error-alert {
          margin-bottom: 14px;
          padding: 9px 12px;
          border-radius: 8px;
          background: #fff1f2;
          color: #be123c;
          font-size: 12.5px;
          text-align: left;
          border: 1px solid #fecdd3;
        }
        .btn-submit-login {
          width: 100%;
          height: 48px;
          border: none;
          border-radius: 12px;
          background: #23b26d;
          color: #ffffff;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(35, 178, 109, 0.3);
          transition: background 0.15s ease;
        }
        .btn-submit-login:hover {
          background: #1ea362;
        }
        .btn-fingerprint-login {
          width: 100%;
          height: 48px;
          border: 1.5px solid #e5e9ef;
          border-radius: 12px;
          background: #ffffff;
          color: #1e293b;
          font-size: 14.5px;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          cursor: pointer;
          margin-top: 12px;
          transition: background 0.15s, border-color 0.15s;
        }
        .btn-fingerprint-login:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }
        .login-biometric-hint {
          text-align: center;
          margin-top: 16px;
          font-size: 12px;
          color: #64748b;
        }

        /* Demo modal styles */
        .demo-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(4px);
          display: grid;
          place-items: center;
          z-index: 1000;
          padding: 16px;
        }
        .demo-modal-card {
          box-sizing: border-box;
          width: min(520px, 100%);
          max-height: 90vh;
          overflow-y: auto;
          background: #ffffff;
          border-radius: 18px;
          box-shadow: 0 25px 60px -10px rgba(0, 0, 0, 0.25);
          padding: 24px 24px 20px;
        }
        .demo-modal-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-bottom: 16px;
          border-bottom: 1px solid #f1f5f9;
        }
        .demo-modal-logo {
          width: 38px;
          height: 38px;
          object-fit: contain;
          flex: none;
        }
        .demo-modal-title {
          flex: 1;
        }
        .demo-modal-title h3 {
          margin: 0;
          font-size: 15.5px;
          font-weight: 700;
          color: #0f172a;
        }
        .demo-modal-title p {
          margin: 2px 0 0;
          font-size: 12px;
          color: #64748b;
        }
        .demo-modal-close {
          border: none;
          background: none;
          color: #94a3b8;
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          line-height: 1;
        }
        .demo-modal-close:hover {
          color: #0f172a;
        }
        .demo-info-box {
          margin: 16px 0;
          padding: 12px 16px;
          border-radius: 12px;
          background: #eff6ff;
          border: 1px solid #dbeafe;
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }
        .demo-info-icon {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: #3b82f6;
          color: #ffffff;
          display: grid;
          place-items: center;
          font-weight: 800;
          font-size: 13px;
          flex: none;
        }
        .demo-info-content strong {
          display: block;
          font-size: 13.5px;
          color: #1e3a8a;
          margin-bottom: 4px;
        }
        .demo-info-content p {
          margin: 0;
          font-size: 12px;
          color: #2563eb;
          line-height: 1.5;
        }
        .demo-tabs {
          display: flex;
          align-items: center;
          gap: 24px;
          border-bottom: 1px solid #e2e8f0;
          margin-bottom: 16px;
        }
        .demo-tab-btn {
          padding: 8px 4px 12px;
          border: none;
          background: transparent;
          color: #64748b;
          font-size: 13.5px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          transition: color 0.15s;
        }
        .demo-tab-btn.active {
          color: #16a34a;
          border-bottom-color: #23b26d;
        }
        .demo-account-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .demo-account-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #ffffff;
          transition: all 0.15s ease;
        }
        .demo-account-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
        }
        .demo-account-left {
          display: flex;
          align-items: center;
          gap: 14px;
          min-width: 0;
        }
        .demo-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          flex: none;
        }
        .demo-avatar.blue { background: #e0ecfb; color: #1d4ed8; }
        .demo-avatar.orange { background: #ffedd5; color: #ea580c; }
        .demo-avatar.green { background: #dcfce7; color: #15803d; }
        .demo-avatar.cyan { background: #ecfeff; color: #0891b2; }
        .demo-avatar.purple { background: #f3e8ff; color: #7e22ce; }
        .demo-user-details {
          min-width: 0;
        }
        .demo-user-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 2px;
        }
        .demo-user-name {
          font-size: 14.5px;
          font-weight: 700;
          color: #0f172a;
        }
        .demo-badge {
          display: inline-block;
          padding: 1px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        .demo-badge.blue { background: #e0ecfb; color: #1d4ed8; }
        .demo-badge.orange { background: #ffedd5; color: #ea580c; }
        .demo-badge.green { background: #dcfce7; color: #15803d; }
        .demo-badge.cyan { background: #ecfeff; color: #0891b2; }
        .demo-badge.purple { background: #f3e8ff; color: #7e22ce; }
        .demo-user-email {
          font-size: 12.5px;
          font-weight: 600;
          color: #16a34a;
          margin-bottom: 0;
        }
        .demo-user-desc {
          font-size: 11.5px;
          color: #64748b;
          line-height: 1.4;
        }
        .btn-demo-login {
          border: none;
          border-radius: 6px;
          padding: 7px 18px;
          font-size: 12.5px;
          font-weight: 700;
          color: #ffffff;
          cursor: pointer;
          flex: none;
          transition: opacity 0.15s;
        }
        .btn-demo-login:hover {
          opacity: 0.9;
        }
        .btn-demo-login.blue { background: #1d4ed8; }
        .btn-demo-login.orange { background: #ea580c; }
        .btn-demo-login.green { background: #16a34a; }
        .btn-demo-login.cyan { background: #0891b2; }
        .btn-demo-login.purple { background: #7e22ce; }
        .demo-admin-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 18px 0 12px;
          color: #64748b;
          font-size: 12px;
          text-align: center;
        }
        .demo-admin-divider::before,
        .demo-admin-divider::after {
          content: "";
          height: 1px;
          flex: 1;
          background: #e2e8f0;
        }
      `}</style>

      <div className="login-box">
        {/* Top button similar to image 1 */}
        <button
          type="button"
          className="btn-nova-account"
          onClick={() => setShowDemoModal(true)}
        >
          <span className="nova-icon-wrap">
            <img src="/app-logo.png" alt="Logo" style={{ width: "24px", height: "24px", objectFit: "contain" }} />
          </span>
          <span>Đăng nhập Tài khoản NovaGroup</span>
        </button>

        {/* Divider Hoặc */}
        <div className="login-or-divider">Hoặc</div>

        {/* Form fields */}
        <form onSubmit={login}>
          <div className="login-input-wrap">
            <span className="login-input-icon">
              <IconMail />
            </span>
            <input
              className="login-input-field"
              type="text"
              autoFocus
              autoComplete="username"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="Nhập email của bạn"
            />
          </div>

          <div className="login-input-wrap">
            <span className="login-input-icon">
              <IconLock />
            </span>
            <input
              className="login-input-field"
              type={showLoginPassword ? "text" : "password"}
              autoComplete="current-password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="Nhập mật khẩu của bạn"
            />
            <button
              type="button"
              className="login-toggle-pw"
              onClick={() => setShowLoginPassword(!showLoginPassword)}
              aria-label={showLoginPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            >
              {showLoginPassword ? <IconEyeOff /> : <IconEye />}
            </button>
          </div>

          {loginError && <div className="login-error-alert">{loginError}</div>}

          <div className="login-options-row">
            <label className="remember-me-label" onClick={() => setRememberMe(!rememberMe)}>
              <span className={`custom-check-icon ${rememberMe ? "" : "unchecked"}`}>✓</span>
              <span>Ghi nhớ đăng nhập</span>
            </label>
            <a
              href="#forgot"
              className="forgot-pw-link"
              onClick={(e) => {
                e.preventDefault();
                setShowDemoModal(true);
              }}
            >
              Quên mật khẩu?
            </a>
          </div>

          <button type="submit" className="btn-submit-login">
            Đăng nhập
          </button>
        </form>
      </div>

      {/* Demo Account Modal matching Image 2 */}
      {showDemoModal && (
        <div className="demo-modal-backdrop" onMouseDown={() => setShowDemoModal(false)}>
          <div className="demo-modal-card" onMouseDown={(e) => e.stopPropagation()}>
            <div className="demo-modal-header">
              <img src="/app-logo.png" alt="Logo" className="demo-modal-logo" />
              <div className="demo-modal-title">
                <h3>Đăng nhập Tài khoản NovaGroup</h3>
                <p>Môi trường Giả lập & Trải nghiệm (Demo Environment)</p>
              </div>
              <button
                type="button"
                className="demo-modal-close"
                onClick={() => setShowDemoModal(false)}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            <div className="demo-info-box">
              <div className="demo-info-icon">i</div>
              <div className="demo-info-content">
                <strong>Môi trường trải nghiệm NovaGroup</strong>
                <p>
                  Hệ thống đang hoạt động ở chế độ giả lập. Vui lòng chọn một trong các tài khoản dưới đây để đăng nhập tức thì theo vai trò:
                </p>
              </div>
            </div>

            {/* Account List */}
            <div className="demo-account-list">
              {DEMO_ACCOUNTS.filter((acc) => acc.system === "gmd").map((acc) => (
                <div key={acc.username} className="demo-account-card">
                  <div className="demo-account-left">
                    <div className={`demo-avatar ${acc.badgeType || "blue"}`}>
                      {acc.email === "gmd.gdb@novaland.com.vn" ? (
                        <IconBriefcase />
                      ) : acc.email === "gmd.pgd@novaland.com.vn" ? (
                        <IconUsers />
                      ) : acc.email === "gmd.tpcc@novaland.com.vn" ? (
                        <IconClipboardCheck />
                      ) : (
                        <IconTableGrid />
                      )}
                    </div>
                    <div className="demo-user-details">
                      <div className="demo-user-name-row">
                        <span className="demo-user-name">{acc.name}</span>
                        {acc.badge ? (
                          <span className={`demo-badge ${acc.badgeType || "blue"}`}>
                            {acc.badge}
                          </span>
                        ) : null}
                      </div>
                      <div className="demo-user-email">{acc.email || acc.username}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`btn-demo-login ${acc.badgeType || "blue"}`}
                    onClick={() => loginAsAccount(acc)}
                  >
                    Đăng nhập
                  </button>
                </div>
              ))}
            </div>

            {/* Admin divider */}
            <div className="demo-admin-divider">
              Quản trị hệ thống
            </div>

            {/* Admin account card */}
            {DEMO_ACCOUNTS.filter((acc) => acc.system === "admin" && acc.email === "itd.admin@novagroup.vn").map((acc) => (
              <div key={acc.username} className="demo-account-card">
                <div className="demo-account-left">
                  <div className="demo-avatar purple">
                    <IconShield />
                  </div>
                  <div className="demo-user-details">
                    <div className="demo-user-name-row">
                      <span className="demo-user-name">{acc.name}</span>
                      {acc.badge ? <span className="demo-badge purple">{acc.badge}</span> : null}
                    </div>
                    <div className="demo-user-email">{acc.email}</div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-demo-login purple"
                  onClick={() => loginAsAccount(acc)}
                >
                  Đăng nhập
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );

  return (
    <main className="app-shell refined-ui">
      <style>{`
        *, *::before, *::after,
        html, body, div, span,
        h1, h2, h3, h4, h5, h6, p,
        a, em, small, strong, b, u, i,
        dl, dt, dd, ol, ul, li,
        fieldset, form, label, legend,
        table, caption, tbody, tfoot, thead, tr, th, td,
        article, aside, canvas, details,
        figcaption, figure, footer, header, hgroup,
        menu, nav, section, summary,
        input, button, select, textarea, optgroup, option {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Roboto", "Helvetica Neue", Arial, sans-serif !important;
        }
        .file-input-styled::file-selector-button {
          height: 38px;
          padding: 0 16px;
          border: 1px solid #c9d6db;
          border-radius: 8px;
          background: #f0f4f5;
          color: #304f5e;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          margin-right: 12px;
          transition: all 0.2s;
        }
        .file-input-styled::file-selector-button:hover {
          background: #e2e9ec;
        }
        .file-input-styled {
          border: none;
          padding: 0;
          background: transparent;
        }
        .gms-task-head, .gms-task-row {
          min-width: 900px !important;
          grid-template-columns: minmax(300px, 1fr) 80px 90px 90px 84px 110px !important;
        }
        .sidebar .brand {
          height: auto !important;
          min-height: 142px !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 14px !important;
          padding: 22px 14px 18px !important;
          margin: 0 -12px !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.15) !important;
          box-sizing: border-box !important;
        }
        .brand-logo-wrap {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          width: 100% !important;
        }
        .brand-logo {
          width: 120px !important;
          max-width: 100% !important;
          height: auto !important;
          flex: none !important;
          display: block !important;
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25)) !important;
        }
        .brand-app {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 12px !important;
          width: 100% !important;
          padding: 0 !important;
          border-left: 0 !important;
        }
        .brand-code {
          font-size: 32px !important;
          font-weight: 900 !important;
          color: #ffffff !important;
          line-height: 1 !important;
          letter-spacing: -0.5px !important;
          text-transform: uppercase !important;
          font-family: inherit !important;
          margin: 0 !important;
          padding: 0 !important;
          display: inline-block !important;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35) !important;
        }
        .brand-title {
          display: flex !important;
          flex-direction: column !important;
          align-items: flex-start !important;
          justify-content: center !important;
          gap: 2px !important;
          line-height: 1.15 !important;
          text-align: left !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .brand-title span {
          font-size: 11px !important;
          font-weight: 800 !important;
          letter-spacing: 0.8px !important;
          color: #cbd5e1 !important;
          text-transform: uppercase !important;
          white-space: nowrap !important;
          line-height: 1.15 !important;
          margin: 0 !important;
          padding: 0 !important;
          display: block !important;
        }
        .sidebar {
          width: 275px !important;
          transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), padding 0.22s ease !important;
          position: relative !important;
        }
        .sidebar.collapsed {
          width: 72px !important;
          padding: 0 8px 16px !important;
        }
        .sidebar.collapsed .brand {
          min-height: 72px !important;
          padding: 12px 4px 10px !important;
          margin: 0 -8px !important;
        }
        .sidebar.collapsed .brand-logo {
          width: 38px !important;
          height: auto !important;
        }
        .sidebar.collapsed .brand-app {
          display: none !important;
        }
        .sidebar.collapsed .sidebar-section-toggle {
          width: 48px !important;
          height: 44px !important;
          padding: 0 !important;
          margin: 8px auto !important;
          justify-content: center !important;
        }
        .sidebar.collapsed .section-toggle-left {
          justify-content: center !important;
          flex: none !important;
          width: 100% !important;
          gap: 0 !important;
        }
        .sidebar.collapsed .section-toggle-left span,
        .sidebar.collapsed .section-chevron,
        .sidebar.collapsed .sidebar-collapsible,
        .sidebar.collapsed .sidebar-footer-info {
          display: none !important;
        }
        .sidebar.collapsed .sidebar-footer {
          padding: 12px 2px !important;
        }
        .sidebar.collapsed .sidebar-logout-btn {
          width: 42px !important;
          height: 34px !important;
          padding: 0 !important;
          margin: 0 auto !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        .sidebar.collapsed .sidebar-logout-btn span {
          display: none !important;
        }
        .sidebar-collapse-row {
          display: flex;
          justify-content: flex-end;
          padding: 8px 2px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          margin-bottom: 6px;
        }
        .sidebar.collapsed .sidebar-collapse-row {
          justify-content: center;
          padding: 6px 0;
        }
        .sidebar-collapse-btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: #dbe4ef;
          border-radius: 6px;
          height: 28px;
          padding: 0 10px;
          font-size: 11px;
          font-weight: 700;
          display: flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.16s ease;
        }
        .sidebar-collapse-btn:hover {
          background: rgba(255, 255, 255, 0.18);
          color: #ffffff;
          border-color: rgba(255, 255, 255, 0.35);
        }
        .sidebar.collapsed .sidebar-collapse-btn {
          width: 40px;
          height: 30px;
          padding: 0;
          justify-content: center;
        }
        .sidebar-logout-btn {
          margin-top: 10px;
          width: 100%;
          height: 32px;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.06);
          color: #dbe7ec;
          font-size: 11px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .sidebar-logout-btn:hover {
          background: rgba(239, 68, 68, 0.2);
          border-color: rgba(239, 68, 68, 0.4);
          color: #fecaca;
        }
        .topbar-toggle-sidebar-btn {
          width: 32px;
          height: 32px;
          display: grid;
          place-items: center;
          border: 1px solid #cbd5e1;
          background: #f8fafc;
          border-radius: 6px;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s ease;
          flex: none;
        }
        .topbar-toggle-sidebar-btn:hover {
          background: #e2e8f0;
          color: #0f172a;
          border-color: #94a3b8;
        }
        .sidebar-section-toggle {
          width: 100% !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 8px !important;
          height: 44px !important;
          min-height: 44px !important;
          padding: 0 10px !important;
          margin: 10px 0 6px !important;
          border: 0 !important;
          border-radius: 8px !important;
          background: linear-gradient(90deg, #7cb342 0%, #558b2f 100%) !important;
          color: #ffffff !important;
          font-size: 11.5px !important;
          font-weight: 800 !important;
          letter-spacing: 0.1px !important;
          cursor: pointer !important;
          box-shadow: 0 3px 10px rgba(124, 179, 66, 0.32) !important;
          transition: all 0.18s ease !important;
          box-sizing: border-box !important;
        }
        .sidebar-section-toggle:hover {
          background: linear-gradient(90deg, #85c247 0%, #5d9834 100%) !important;
          box-shadow: 0 5px 14px rgba(124, 179, 66, 0.42) !important;
          transform: translateY(-1px) !important;
        }
        .section-toggle-left {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          min-width: 0 !important;
          flex: 1 !important;
          color: #ffffff !important;
        }
        .section-toggle-left span {
          font-size: 11.5px !important;
          font-weight: 800 !important;
          color: #ffffff !important;
          white-space: nowrap !important;
          overflow: visible !important;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25) !important;
          letter-spacing: 0.1px !important;
          text-transform: uppercase !important;
        }
        .section-header-icon {
          width: 19px !important;
          height: 19px !important;
          min-width: 19px !important;
          max-width: 19px !important;
          flex: none !important;
          color: #ffffff !important;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2)) !important;
        }
        .section-chevron {
          width: 12px !important;
          height: 12px !important;
          min-width: 12px !important;
          max-width: 12px !important;
          flex: none !important;
          color: #ffffff !important;
          transition: transform 0.2s ease !important;
        }
        .sidebar-section-toggle.open .section-chevron {
          transform: rotate(180deg) !important;
        }
        .sidebar-collapsible {
          display: flex !important;
          flex-direction: column !important;
          gap: 3px !important;
          margin: 4px 0 0 !important;
          padding: 0 !important;
          border: 0 !important;
          background: transparent !important;
        }
        .sidebar-collapsible.collapsed {
          display: none !important;
        }
        .sidebar-nav button {
          width: 100% !important;
          min-height: 44px !important;
          height: 44px !important;
          display: flex !important;
          align-items: center !important;
          gap: 12px !important;
          padding: 0 12px !important;
          justify-content: flex-start !important;
          border: 0 !important;
          border-radius: 8px !important;
          background: transparent !important;
          color: #dbe4ef !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          text-align: left !important;
          box-sizing: border-box !important;
          cursor: pointer !important;
          transition: all 0.15s !important;
        }
        .sidebar-nav button:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          color: #ffffff !important;
        }
        .sidebar-nav button.active {
          background: rgba(255, 255, 255, 0.16) !important;
          color: #ffffff !important;
          font-weight: 700 !important;
          border-left: 3.5px solid #8cc63f !important;
          box-shadow: inset 0 0 10px rgba(0, 0, 0, 0.08) !important;
        }
        .sidebar-nav button .nav-icon {
          width: 22px !important;
          height: 22px !important;
          min-width: 22px !important;
          max-width: 22px !important;
          flex: none !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
        }
        /* ================= HOME FLAT EXECUTIVE DASHBOARD ================= */
        .home-dashboard-view {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          background: #f4f6f8;
        }
        @media (max-height: 750px) {
          .home-dashboard-view {
            overflow-y: auto;
          }
        }
        .home-topbar {
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          padding: 0 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex: none;
          height: 52px;
          box-sizing: border-box;
          gap: 16px;
        }
        .home-breadcrumb {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }
        .home-breadcrumb-link {
          color: #64748b;
          display: flex;
          align-items: center;
          gap: 5px;
          font-weight: 500;
        }
        .home-breadcrumb-sep {
          color: #94a3b8;
          font-size: 12px;
        }
        .home-breadcrumb-title {
          font-size: 13.5px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: 0.2px;
        }

        .period-chips-group-flat {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .period-chip-btn-flat {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #475569;
          font-size: 11.5px;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 20px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .period-chip-btn-flat:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
        }
        .period-chip-btn-flat.active {
          background: #102a45;
          color: #ffffff;
          border-color: #102a45;
          font-weight: 700;
        }

        .home-topbar-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .home-pill-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border-radius: 20px;
          padding: 4px 12px;
          font-size: 11.5px;
          font-weight: 700;
          flex: none;
        }
        .home-pill-badge.kpi {
          background: #e8f5e9;
          color: #16a34a;
          border: 1px solid #bbf7d0;
        }
        .home-pill-badge.overdue {
          background: #fee2e2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }
        .home-pill-badge.date {
          background: #ffffff;
          color: #475569;
          border: 1px solid #e2e8f0;
          font-weight: 600;
        }
        .home-role-title {
          font-size: 12.5px;
          font-weight: 600;
          color: #2563eb;
          white-space: nowrap;
        }

        /* 3-Column Landscape Grid */
        .home-content-wrap {
          flex: 1;
          min-height: 0;
          padding: 12px 18px 14px;
          max-width: 100%;
          width: 100%;
          margin: 0;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
        }
        .home-landscape-grid {
          flex: 1;
          min-height: 0;
          height: 100%;
          display: grid;
          grid-template-columns: 290px minmax(0, 1.48fr) minmax(0, 1.28fr);
          gap: 12px;
          align-items: stretch;
        }
        @media (max-width: 1320px) {
          .home-landscape-grid {
            grid-template-columns: 275px minmax(0, 1.4fr) minmax(0, 1.25fr);
            gap: 10px;
          }
        }
        @media (max-width: 1100px) {
          .home-landscape-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 768px) {
          .home-landscape-grid {
            grid-template-columns: 1fr;
          }
        }

        .home-col {
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
          min-height: 0;
        }

        /* Base Flat Card */
        .exec-card-flat {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 12px 15px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .exec-card-flat.card-kpi {
          flex: 1;
        }
        .exec-card-flat.card-mgmt {
          flex: 1.15;
        }
        .exec-card-flat.card-ops {
          height: 100%;
          flex: 1;
        }
        .exec-card-flat.card-today {
          flex: 1.05;
        }
        .exec-card-flat.card-overdue {
          flex: 0.95;
          border-color: #fee2e2;
        }

        .exec-card-head-flat {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
          padding-bottom: 8px;
          border-bottom: 1px solid #f1f5f9;
          flex: none;
        }
        .exec-card-title-flat {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          font-weight: 800;
          color: #0f172a;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .exec-card-title-flat.red {
          color: #ef4444;
        }
        .exec-icon-box-flat {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          display: grid;
          place-items: center;
          color: #ffffff;
          flex: none;
        }
        .exec-icon-box-flat.green { background: #22c55e; }
        .exec-icon-box-flat.purple { background: #8b5cf6; }
        .exec-icon-box-flat.blue { background: #0284c7; }
        .exec-icon-box-flat.red { background: #ef4444; }

        .exec-badge-pill-flat {
          font-size: 11px;
          font-weight: 700;
          padding: 2.5px 9px;
          border-radius: 20px;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          color: #64748b;
          flex: none;
        }
        .exec-badge-pill-flat.green {
          background: #ecfdf5;
          border-color: #bbf7d0;
          color: #16a34a;
        }
        .exec-badge-pill-flat.blue {
          background: #e0f2fe;
          border-color: #bae6fd;
          color: #0284c7;
        }
        .exec-badge-pill-flat.red {
          background: #fef2f2;
          border-color: #fecaca;
          color: #ef4444;
        }

        /* Card 1A Gauge & Sub-metrics */
        .gauge-sub-metrics-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          margin-top: auto;
          padding-top: 10px;
          border-top: 1px solid #f1f5f9;
          flex: none;
        }
        .gauge-sub-metric-item {
          text-align: center;
        }
        .sub-metric-label {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          font-size: 11px;
          color: #64748b;
          font-weight: 600;
        }
        .metric-dot {
          font-size: 9px;
          line-height: 1;
        }
        .metric-dot.green { color: #22c55e; }
        .metric-dot.red { color: #ef4444; }
        .metric-dot.orange { color: #f59e0b; }

        .sub-metric-val {
          display: block;
          font-size: 13.5px;
          font-weight: 800;
          color: #0f172a;
          margin-top: 3px;
        }
        .sub-metric-val.text-red {
          color: #ef4444;
        }

        /* Card 1B Trách Nhiệm Quản Lý */
        .mgmt-flat-list {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 6px;
          flex: 1;
          min-height: 0;
        }
        .mgmt-flat-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 7px 10px;
          border-radius: 6px;
          background: #f8fafc;
          border: 1px solid #f1f5f9;
          transition: all 0.15s ease;
          flex: 1;
        }
        .mgmt-flat-item:hover {
          background: #ffffff;
          border-color: #cbd5e1;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }
        .mgmt-flat-info {
          min-width: 0;
          flex: 1;
        }
        .mgmt-flat-role {
          font-size: 11.5px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mgmt-flat-scope {
          font-size: 9.5px;
          color: #64748b;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mgmt-flat-score-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-width: 58px;
          padding: 3px 6px;
          border-radius: 5px;
          flex: none;
          text-align: center;
        }
        .mgmt-flat-score-box.passed {
          background: #f0fdf4;
          border: 1px solid #dcfce7;
          color: #16a34a;
        }
        .mgmt-flat-score-box.improve {
          background: #fffbeb;
          border: 1px solid #fef3c7;
          color: #d97706;
        }
        .mgmt-flat-score {
          font-size: 12px;
          font-weight: 800;
          line-height: 1.2;
        }
        .mgmt-flat-status {
          font-size: 9px;
          font-weight: 700;
          line-height: 1;
          margin-top: 1px;
        }

        /* Card 2 Tiến Độ Nghiệp Vụ BĐHDA */
        .op-filter-pills-flat {
          display: flex;
          gap: 4px;
        }
        .op-filter-pill-btn {
          padding: 3px 9px;
          border-radius: 20px;
          font-size: 10.5px;
          font-weight: 700;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .op-filter-pill-btn:hover {
          background: #f8fafc;
        }
        .op-filter-pill-btn.active {
          background: #102a45;
          color: #ffffff;
          border-color: #102a45;
        }

        .op-subhead-row-flat {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          font-weight: 600;
          margin-bottom: 6px;
          flex: none;
        }
        .op-legend-flat {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .op-legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .op-link-all {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: #2563eb;
          font-size: 11px;
          font-weight: 700;
          text-decoration: none;
          cursor: pointer;
          border: none;
          background: transparent;
          transition: all 0.15s;
        }
        .op-link-all:hover {
          color: #1d4ed8;
          transform: translateX(1px);
        }

        .op-flat-list {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 7px;
          flex: 1;
          min-height: 0;
        }
        .op-flat-card {
          padding: 8px 12px;
          border-radius: 8px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          flex: 1;
          transition: all 0.15s;
        }
        .op-flat-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
        }
        .op-flat-row-1 {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .op-flat-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 1;
        }
        .op-flat-badge {
          padding: 2px 6px;
          border-radius: 4px;
          color: #ffffff;
          font-size: 10px;
          font-weight: 800;
          flex: none;
        }
        .op-flat-badge.blue { background: #2563eb; }
        .op-flat-badge.orange { background: #ea580c; }
        .op-flat-title {
          font-size: 12px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .op-flat-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: none;
        }
        .op-flat-score {
          font-size: 12.5px;
          font-weight: 800;
        }
        .op-flat-score.green { color: #16a34a; }
        .op-flat-score.orange { color: #ea580c; }
        .op-flat-btn {
          padding: 2.5px 8px;
          border-radius: 4px;
          border: 1px solid #bfdbfe;
          background: #ffffff;
          color: #2563eb;
          font-size: 10.5px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
        }
        .op-flat-btn:hover {
          background: #eff6ff;
          border-color: #93c5fd;
        }
        .op-flat-row-2 {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 10.5px;
          color: #64748b;
          margin: 2px 0 4px;
        }
        .op-flat-bar-track {
          width: 100%;
          height: 5px;
          border-radius: 3px;
          background: #e2e8f0;
          overflow: hidden;
        }
        .op-flat-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s ease;
        }
        .op-flat-bar-fill.green { background: #22c55e; }
        .op-flat-bar-fill.orange { background: #ea580c; }

        /* Card 3A Công Việc Hôm Nay */
        .today-flat-list {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 6px;
          flex: 1;
          min-height: 0;
        }
        .today-flat-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 9px;
          border-radius: 6px;
          background: #ffffff;
          border: 1px solid #f1f5f9;
          cursor: pointer;
          transition: all 0.15s;
          flex: 1;
        }
        .today-flat-item:hover {
          background: #f8fafc;
          border-color: #e2e8f0;
        }
        .today-flat-item.is-done {
          opacity: 0.7;
        }
        .today-flat-check {
          width: 17px;
          height: 17px;
          border-radius: 4px;
          border: 1.5px solid #cbd5e1;
          display: grid;
          place-items: center;
          background: #ffffff;
          color: #ffffff;
          flex: none;
          transition: all 0.15s;
        }
        .today-flat-check.checked {
          background: #22c55e;
          border-color: #22c55e;
        }
        .today-flat-body {
          min-width: 0;
          flex: 1;
        }
        .today-flat-title {
          font-size: 11px;
          font-weight: 600;
          color: #1e293b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .today-flat-meta {
          font-size: 9.5px;
          color: #64748b;
          margin-top: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: flex;
          gap: 6px;
        }
        .today-flat-pill {
          font-size: 9.5px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 4px;
          flex: none;
        }
        .today-flat-pill.routine {
          background: #f0f9ff;
          color: #0284c7;
          border: 1px solid #e0f2fe;
        }
        .today-flat-pill.technical {
          background: #f5f3ff;
          color: #7c3aed;
          border: 1px solid #ede9fe;
        }
        .today-flat-pill.extra {
          background: #fff7ed;
          color: #ea580c;
          border: 1px solid #ffedd5;
        }

        /* Card 3B Công Việc Đang Trễ Hạn */
        .overdue-flat-list {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 6px;
          flex: 1;
          min-height: 0;
        }
        .overdue-flat-card {
          padding: 7px 10px;
          border-radius: 6px;
          background: #ffffff;
          border: 1px solid #fee2e2;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          flex: 1;
          transition: all 0.15s;
        }
        .overdue-flat-card:hover {
          border-color: #fca5a5;
          background: #fffdfd;
        }
        .overdue-flat-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .overdue-flat-title {
          font-size: 11px;
          font-weight: 700;
          color: #1e293b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .overdue-flat-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: none;
        }
        .overdue-flat-badge-days {
          background: #ef4444;
          color: #ffffff;
          font-size: 9.5px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          flex: none;
        }
        .overdue-flat-btn-urge {
          background: #dc2626;
          color: #ffffff;
          border: none;
          font-size: 10px;
          font-weight: 700;
          padding: 2.5px 7px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .overdue-flat-btn-urge:hover {
          background: #b91c1c;
        }
        .overdue-flat-btn-mtl {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          color: #475569;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .overdue-flat-btn-mtl:hover {
          background: #f1f5f9;
          border-color: #94a3b8;
        }
        .overdue-flat-sub {
          font-size: 9.5px;
          color: #64748b;
          margin-top: 2px;
          display: flex;
          align-items: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ================= KHỞI TẠO TIẾN ĐỘ TỪ TEMPLATE (FLAT UI) ================= */
        .init-template-view {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow-y: auto;
          background: #f8fafc;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .init-template-topbar {
          background: #ffffff;
          border-bottom: 1px solid #e2e8f0;
          padding: 0 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 52px;
          flex: none;
          gap: 16px;
        }
        .init-topbar-left {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: 1;
          max-width: 600px;
        }
        .init-search-box {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 6px 12px;
          width: 100%;
          color: #64748b;
          font-size: 12.5px;
        }
        .init-search-box input {
          border: none;
          background: transparent;
          outline: none;
          width: 100%;
          font-size: 12.5px;
          color: #0f172a;
        }
        .init-topbar-right {
          display: flex;
          align-items: center;
          gap: 14px;
          flex: none;
        }
        .init-btn-home {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #22c55e;
          color: #ffffff;
          border: none;
          border-radius: 6px;
          padding: 6px 14px;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s ease;
          box-shadow: none !important;
        }
        .init-btn-home:hover {
          background: #16a34a;
        }
        .init-template-body {
          flex: 1;
          padding: 16px 24px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          box-sizing: border-box;
        }
        .init-breadcrumb {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #64748b;
        }
        .init-breadcrumb-sep {
          color: #94a3b8;
        }
        .init-page-title {
          font-size: 20px;
          font-weight: 800;
          color: #0f172a;
          margin: 2px 0 2px;
        }
        .init-page-desc {
          font-size: 12px;
          color: #64748b;
          margin-bottom: 8px;
        }
        .init-mode-switcher {
          display: flex;
          gap: 6px;
          background: #f1f5f9;
          padding: 4px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          width: fit-content;
          margin-bottom: 8px;
          box-shadow: none !important;
        }
        .init-mode-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 16px;
          border-radius: 6px;
          border: 1px solid transparent;
          background: transparent;
          font-size: 12.5px;
          font-weight: 600;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: none !important;
        }
        .init-mode-btn:hover {
          color: #1e293b;
          background: rgba(255, 255, 255, 0.6);
        }
        .init-mode-btn.active {
          background: #ffffff;
          font-weight: 700;
          border: 1px solid #cbd5e1;
        }
        .init-mode-btn.active.mode-template {
          color: #15803d;
          border-color: #86efac;
          background: #f0fdf4;
        }
        .init-mode-btn.active.mode-update {
          color: #1d4ed8;
          border-color: #93c5fd;
          background: #eff6ff;
        }
        .approved-version-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          background: #ecfdf5;
          border: 1px solid #a7f3d0;
          color: #065f46;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 700;
        }
        .version-meta-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 12px;
          box-shadow: none !important;
        }
        .version-meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .version-meta-label {
          color: #64748b;
          font-weight: 500;
        }
        .version-meta-val {
          color: #0f172a;
          font-weight: 700;
        }
        .approved-cert-card {
          border: 1.5px solid #86efac;
          background: #f0fdf4;
          border-radius: 8px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-shadow: none !important;
        }
        .init-template-grid {
          display: grid;
          grid-template-columns: 1.05fr 1.15fr 1.35fr;
          gap: 14px;
          align-items: stretch;
          flex: 1;
          min-height: 0;
        }
        @media (max-width: 1200px) {
          .init-template-grid {
            grid-template-columns: 1fr;
          }
        }
        .init-col-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          box-shadow: none !important;
          min-height: 0;
        }
        .init-col-head {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 14px;
          padding-bottom: 10px;
          border-bottom: 1px solid #f1f5f9;
        }
        .init-num-badge {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: #22c55e;
          color: #ffffff;
          display: grid;
          place-items: center;
          font-size: 12px;
          font-weight: 800;
          flex: none;
        }
        .init-col-title {
          font-size: 13.5px;
          font-weight: 800;
          color: #0f172a;
        }
        .init-field-group {
          display: flex;
          flex-direction: column;
          gap: 11px;
        }
        .init-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .init-field-label {
          font-size: 11.5px;
          font-weight: 700;
          color: #334155;
        }
        .init-field-input, .init-field-select {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 12.5px;
          color: #0f172a;
          background: #ffffff;
          box-sizing: border-box;
          outline: none;
          transition: border-color 0.15s;
          box-shadow: none !important;
        }
        .init-field-input:focus, .init-field-select:focus {
          border-color: #22c55e;
        }
        .init-field-input.readonly {
          background: #f1f5f9;
          color: #475569;
          cursor: default;
        }
        .template-item-card {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 11px 13px;
          display: flex;
          align-items: center;
          gap: 12px;
          background: #ffffff;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: none !important;
        }
        .template-item-card:hover {
          border-color: #cbd5e1;
          background: #f8fafc;
        }
        .template-item-card.active {
          border: 1.5px solid #22c55e;
          background: #f6fef9;
        }
        .template-radio-dot {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          border: 2px solid #cbd5e1;
          display: grid;
          place-items: center;
          flex: none;
        }
        .template-radio-dot.checked {
          border-color: #22c55e;
          background: #22c55e;
        }
        .template-radio-inner {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #ffffff;
        }
        .template-icon-square {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          display: grid;
          place-items: center;
          color: #ffffff;
          flex: none;
        }
        .template-icon-square.green { background: #22c55e; }
        .template-icon-square.blue { background: #2563eb; }
        .template-icon-square.purple { background: #8b5cf6; }

        .template-info-main {
          flex: 1;
          min-width: 0;
        }
        .template-name {
          font-size: 12.5px;
          font-weight: 700;
          color: #0f172a;
          margin-bottom: 3px;
        }
        .template-meta-row {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 10.5px;
          color: #64748b;
        }
        .template-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* WBS Tree View */
        .wbs-tree-flat {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 12px;
          color: #1e293b;
          overflow-y: auto;
          flex: 1;
          padding-right: 4px;
        }
        .wbs-tree-node {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 6px;
          border-radius: 4px;
          cursor: pointer;
          user-select: none;
        }
        .wbs-tree-node:hover {
          background: #f1f5f9;
        }
        .wbs-tree-node.root {
          font-weight: 800;
          color: #0f172a;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          padding: 6px 8px;
        }
        .wbs-tree-node.block {
          font-weight: 700;
          font-size: 11.5px;
          padding: 5px 8px;
          margin-top: 2px;
        }
        .wbs-tree-node.block-4 {
          color: #15803d;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
        }
        .wbs-tree-node.block-9 {
          color: #1d4ed8;
          background: #eff6ff;
          border: 1px solid #bfdbfe;
        }
        .wbs-tree-node.group {
          font-weight: 600;
          color: #1e293b;
          font-size: 11.5px;
          padding: 4px 8px;
        }
        .wbs-tree-node.task {
          font-size: 11px;
          color: #475569;
          padding: 3px 8px 3px 24px;
        }
        .wbs-tree-tag {
          font-size: 10px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 3px;
          margin-left: auto;
          flex: none;
        }
        .wbs-tree-chevron {
          width: 14px;
          display: inline-block;
          font-size: 10px;
          color: #94a3b8;
          text-align: center;
        }

        /* Bottom Action Bar */
        .init-bottom-bar {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex: none;
          box-shadow: none !important;
        }
        .init-info-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 11.5px;
          color: #166534;
          flex: 1;
        }
        .init-actions-right {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: none;
        }
        .init-btn-cancel {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          color: #475569;
          border-radius: 6px;
          padding: 7px 18px;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: none !important;
          transition: background 0.15s;
        }
        .init-btn-cancel:hover {
          background: #f8fafc;
        }
        .init-btn-submit {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: #22c55e;
          border: none;
          color: #ffffff;
          border-radius: 6px;
          padding: 7px 18px;
          font-size: 12.5px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: none !important;
          transition: background 0.15s;
        }
        .init-btn-submit:hover {
          background: #16a34a;
        }

        /* ================= WBS CATALOG ================= */
        .catalog-header {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 20px !important;
          padding: 18px 24px !important;
          background: #ffffff !important;
          border-bottom: 1px solid #e2e8f0 !important;
        }
        .catalog-header h1 {
          font-size: 20px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          margin: 4px 0 2px !important;
        }
        .catalog-header p {
          font-size: 12px !important;
          color: #64748b !important;
          margin: 0 !important;
        }
        .catalog-groups {
          display: grid !important;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important;
          gap: 8px !important;
          padding: 16px 24px !important;
          background: #ffffff !important;
          border-bottom: 1px solid #e2e8f0 !important;
        }
        .catalog-group-card {
          display: flex !important;
          flex-direction: column !important;
          justify-content: space-between !important;
          gap: 4px !important;
          padding: 10px 12px !important;
          border-radius: 8px !important;
          border: 1px solid #e2e8f0 !important;
          background: #f8fafc !important;
          cursor: pointer !important;
          transition: all 0.15s ease !important;
          text-align: left !important;
        }
        .catalog-group-card:hover {
          border-color: #cbd5e1 !important;
          background: #f1f5f9 !important;
          transform: translateY(-1px) !important;
        }
        .catalog-group-card.active {
          border-color: #8cc63f !important;
          background: #f4fbf0 !important;
          box-shadow: 0 2px 8px rgba(140, 198, 63, 0.22) !important;
        }
        .catalog-group-card-top {
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 6px !important;
        }
        .catalog-group-card-top span {
          font-size: 10px !important;
          font-weight: 800 !important;
          color: #1a56a8 !important;
          background: #e8f0fe !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
        }
        .catalog-group-card-top small {
          font-size: 10px !important;
          font-weight: 700 !important;
          color: #64748b !important;
        }
        .catalog-group-card b {
          font-size: 11.5px !important;
          font-weight: 700 !important;
          color: #0f172a !important;
          line-height: 1.25 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .catalog-table {
          margin: 14px 24px 24px !important;
          background: #ffffff !important;
          border-radius: 10px !important;
          border: 1px solid #e2e8f0 !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
          max-height: calc(100vh - 240px) !important;
          overflow-y: auto !important;
          overflow-x: auto !important;
        }
        .catalog-table-head {
          display: grid !important;
          grid-template-columns: 130px minmax(300px, 1.8fr) minmax(320px, 2fr) 200px 110px !important;
          align-items: center !important;
          gap: 12px !important;
          padding: 12px 16px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #e2e8f0 !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          color: #64748b !important;
          letter-spacing: 0.4px !important;
          text-transform: uppercase !important;
          position: sticky !important;
          top: 0 !important;
          z-index: 5 !important;
        }
        .catalog-row {
          display: grid !important;
          grid-template-columns: 130px minmax(300px, 1.8fr) minmax(320px, 2fr) 200px 110px !important;
          align-items: center !important;
          gap: 12px !important;
          padding: 10px 16px !important;
          border-bottom: 1px solid #f1f5f9 !important;
          font-size: 12.5px !important;
          color: #1e293b !important;
          transition: background 0.12s ease !important;
        }
        .catalog-row:hover {
          background: #f8fafc !important;
        }
        .catalog-row.auto-enabled {
          background: #ffffff !important;
        }
        .catalog-work-type-select {
          width: 100% !important;
          min-width: 0 !important;
          height: 32px !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 6px !important;
          background: #ffffff !important;
          color: #334155 !important;
          padding: 0 8px !important;
          font-size: 11.5px !important;
        }
        .catalog-wbs-cell {
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
          min-width: 0 !important;
          overflow: hidden !important;
        }
        .catalog-tree-toggle,
        .catalog-tree-spacer {
          width: 18px !important;
          height: 20px !important;
          flex: none !important;
        }
        .catalog-tree-toggle {
          display: grid !important;
          place-items: center !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 5px !important;
          background: #ffffff !important;
          color: #334155 !important;
          font-size: 14px !important;
          font-weight: 700 !important;
          line-height: 1 !important;
        }
        .catalog-tree-toggle:hover {
          border-color: #0f766e !important;
          background: #f0fdfa !important;
          color: #0f766e !important;
        }
        .catalog-wbs-code {
          font-size: 11.5px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          background: #f1f5f9 !important;
          padding: 3px 7px !important;
          border-radius: 5px !important;
          font-family: inherit !important;
          display: block !important;
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        .catalog-name-cell {
          font-size: 12.5px !important;
          font-weight: 600 !important;
          color: #1e293b !important;
          line-height: 1.4 !important;
        }
        .catalog-unit {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          min-width: 0 !important;
        }
        .catalog-unit b {
          font-size: 10px !important;
          font-weight: 800 !important;
          color: #1a56a8 !important;
          background: #eef4ff !important;
          padding: 1px 5px !important;
          border-radius: 4px !important;
          flex: none !important;
        }
        .catalog-unit span {
          font-size: 11.5px !important;
          color: #475569 !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .catalog-level-badge {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-size: 10.5px !important;
          font-weight: 700 !important;
          padding: 2px 7px !important;
          border-radius: 4px !important;
        }
        .catalog-level-1 { background: #fee2e2 !important; color: #991b1b !important; }
        .catalog-level-2 { background: #fef3c7 !important; color: #92400e !important; }
        .catalog-level-3 { background: #dbeafe !important; color: #1e40af !important; }
        .catalog-level-4 { background: #f1f5f9 !important; color: #475569 !important; }
        .source-standard {
          display: inline-flex !important;
          align-items: center !important;
          font-size: 10.5px !important;
          font-weight: 700 !important;
          color: #166534 !important;
          background: #dcfce7 !important;
          padding: 2px 8px !important;
          border-radius: 12px !important;
          font-style: normal !important;
        }
        .source-custom {
          display: inline-flex !important;
          align-items: center !important;
          font-size: 10.5px !important;
          font-weight: 700 !important;
          color: #854d0e !important;
          background: #fef9c3 !important;
          padding: 2px 8px !important;
          border-radius: 12px !important;
          font-style: normal !important;
        }
        .auto-generate-check {
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          cursor: pointer !important;
          user-select: none !important;
        }
        .auto-generate-check input {
          position: absolute !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .auto-generate-check i {
          width: 32px !important;
          height: 18px !important;
          position: relative !important;
          border-radius: 9px !important;
          background: #cbd5e1 !important;
          transition: background 0.18s ease !important;
          flex: none !important;
        }
        .auto-generate-check i:after {
          content: "" !important;
          width: 14px !important;
          height: 14px !important;
          position: absolute !important;
          left: 2px !important;
          top: 2px !important;
          border-radius: 50% !important;
          background: #ffffff !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25) !important;
          transition: transform 0.18s ease !important;
        }
        .auto-generate-check input:checked + i {
          background: #8cc63f !important;
        }
        .auto-generate-check input:checked + i:after {
          transform: translateX(14px) !important;
        }
        .auto-generate-check b {
          font-size: 11px !important;
          font-weight: 700 !important;
          color: #64748b !important;
        }
        .auto-generate-check input:checked ~ b {
          color: #15803d !important;
        }
        /* ================= COMPACT PROJECT INDEX HEADER ================= */
        .project-index-header {
          min-height: 68px !important;
          padding: 16px 24px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          border-bottom: 1px solid #e2e8f0 !important;
          background: #ffffff !important;
        }
        .project-index-header h1 {
          margin: 0 !important;
          font-size: 20px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          letter-spacing: -0.2px !important;
        }
        /* ================= 7-COLUMN PROJECT TABLE (NO LOẠI DỰ ÁN) ================= */
        .project-table {
          margin: 0 24px 20px !important;
          background: #ffffff !important;
          border-radius: 10px !important;
          border: 1px solid #e2e8f0 !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
          overflow: hidden !important;
        }
        .project-table-head {
          display: grid !important;
          grid-template-columns: 140px minmax(220px, 2fr) minmax(200px, 1.6fr) minmax(160px, 1.2fr) 140px 180px 90px !important;
          align-items: center !important;
          gap: 12px !important;
          padding: 12px 18px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #e2e8f0 !important;
          font-size: 11px !important;
          font-weight: 800 !important;
          color: #475569 !important;
          letter-spacing: 0.4px !important;
          text-transform: uppercase !important;
        }
        .project-table-row {
          display: grid !important;
          grid-template-columns: 140px minmax(220px, 2fr) minmax(200px, 1.6fr) minmax(160px, 1.2fr) 140px 180px 90px !important;
          align-items: center !important;
          gap: 12px !important;
          padding: 12px 18px !important;
          border-bottom: 1px solid #f1f5f9 !important;
          font-size: 12.5px !important;
          color: #1e293b !important;
          cursor: pointer !important;
          transition: all 0.12s ease !important;
        }
        .project-table-row:hover {
          background: #f8fafc !important;
        }
        .project-table-cell-ellipsis {
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .table-stats-bar {
          display: grid !important;
          grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)) !important;
          gap: 12px !important;
          padding: 14px 24px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #e2e8f0 !important;
        }
        .table-stat-card {
          display: flex !important;
          flex-direction: column !important;
          gap: 4px !important;
          padding: 10px 14px !important;
          background: #ffffff !important;
          border-radius: 8px !important;
          border: 1px solid #e2e8f0 !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03) !important;
        }
        .table-stat-card span {
          font-size: 10.5px !important;
          font-weight: 700 !important;
          color: #64748b !important;
          text-transform: uppercase !important;
          letter-spacing: 0.3px !important;
        }
        .table-stat-card b {
          font-size: 19px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          line-height: 1.2 !important;
        }
        /* ================= UNIFIED PAGE TOP HEADER & CARDS ================= */
        .page-top-header {
          min-height: 64px !important;
          height: auto !important;
          flex: none !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 12px 20px !important;
          padding: 10px 24px !important;
          background: #ffffff !important;
          border-bottom: 1px solid #e2e8f0 !important;
          flex-wrap: wrap !important;
        }
        .page-top-title-group {
          display: flex !important;
          align-items: center !important;
          gap: 14px !important;
          flex-wrap: wrap !important;
        }
        .page-top-title-group h1 {
          margin: 0 !important;
          font-size: 19px !important;
          font-weight: 800 !important;
          color: #173f51 !important;
          letter-spacing: -0.2px !important;
          white-space: nowrap !important;
        }
        .top-stat-cards {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          flex-wrap: wrap !important;
        }
        .top-stat-card {
          display: flex !important;
          flex-direction: column !important;
          gap: 2px !important;
          padding: 4px 10px !important;
          background: #f8fafc !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 6px !important;
          min-width: 76px !important;
        }
        .top-stat-card span {
          font-size: 9px !important;
          font-weight: 700 !important;
          color: #64748b !important;
          text-transform: uppercase !important;
          letter-spacing: 0.2px !important;
          line-height: 1 !important;
        }
        .top-stat-card b {
          font-size: 15px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          line-height: 1.1 !important;
        }
        .page-top-actions {
          margin-left: auto !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          flex-wrap: wrap !important;
        }
        /* ================= COMPACT WORKSPACE HEADER ================= */
        .workspace-topbar {
          min-height: 40px !important;
          height: 40px !important;
          padding: 0 20px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #e2e8f0 !important;
        }
        .workspace-topbar .breadcrumb-back {
          font-size: 12.5px !important;
          font-weight: 600 !important;
          color: #0284c7 !important;
          padding: 4px 8px !important;
          border-radius: 4px !important;
          cursor: pointer !important;
        }
        .workspace-topbar .top-actions {
          gap: 8px !important;
        }
        .workspace-topbar .saved-state {
          font-size: 11px !important;
          color: #64748b !important;
        }
        .project-header {
          min-height: 52px !important;
          height: auto !important;
          padding: 8px 20px !important;
          background: #ffffff !important;
          border-bottom: 1px solid #e2e8f0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
          gap: 16px !important;
          flex-wrap: wrap !important;
        }
        .project-header-left {
          display: flex !important;
          flex-direction: column !important;
          gap: 3px !important;
        }
        .project-title-row {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          flex-wrap: wrap !important;
        }
        .project-title-row h1 {
          margin: 0 !important;
          font-size: 18px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          line-height: 1.2 !important;
        }
        .project-header-left p {
          margin: 0 !important;
          font-size: 11.5px !important;
          color: #64748b !important;
          line-height: 1.3 !important;
        }
        .workspace-stat-cards {
          margin-left: auto !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
        }
        .workspace-stat-cards .top-stat-card {
          padding: 4px 10px !important;
          min-width: 80px !important;
          background: #f8fafc !important;
          border: 1px solid #e2e8f0 !important;
          border-radius: 6px !important;
        }
        .workspace-stat-cards .top-stat-card span {
          font-size: 8.5px !important;
          font-weight: 700 !important;
          color: #64748b !important;
          text-transform: uppercase !important;
          letter-spacing: 0.3px !important;
        }
        .workspace-stat-cards .top-stat-card b {
          font-size: 15px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          line-height: 1.1 !important;
        }
        .toolbar {
          min-height: 44px !important;
          padding: 6px 20px !important;
        }
        /* ================= CONFIRM DELETE MODAL ================= */
        .confirm-modal {
          width: min(480px, 94vw) !important;
          background: #ffffff !important;
          border-radius: 16px !important;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35) !important;
          padding: 28px 24px 22px !important;
          text-align: center !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
          gap: 12px !important;
          animation: modal-scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        @keyframes modal-scale-in {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .confirm-modal-icon {
          width: 56px !important;
          height: 56px !important;
          border-radius: 50% !important;
          background: #fee2e2 !important;
          color: #dc2626 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          margin-bottom: 4px !important;
        }
        .confirm-modal-icon svg {
          width: 28px !important;
          height: 28px !important;
          stroke: #dc2626 !important;
        }
        .confirm-modal h2 {
          font-size: 19px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          margin: 0 !important;
          line-height: 1.3 !important;
        }
        .confirm-modal p {
          font-size: 13.5px !important;
          color: #475569 !important;
          margin: 0 !important;
          line-height: 1.5 !important;
        }
        .confirm-modal-project-badge {
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          background: #f1f5f9 !important;
          border: 1px solid #e2e8f0 !important;
          padding: 6px 12px !important;
          border-radius: 8px !important;
          margin: 4px 0 !important;
          font-size: 12px !important;
          color: #1e293b !important;
        }
        .confirm-modal-actions {
          display: flex !important;
          gap: 10px !important;
          width: 100% !important;
          margin-top: 12px !important;
        }
        .confirm-modal-actions button {
          flex: 1 !important;
          height: 42px !important;
          border-radius: 8px !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          transition: all 0.15s ease !important;
        }
        .confirm-modal-cancel {
          background: #f1f5f9 !important;
          color: #475569 !important;
          border: 1px solid #cbd5e1 !important;
        }
        .confirm-modal-cancel:hover {
          background: #e2e8f0 !important;
          color: #0f172a !important;
        }
        .confirm-modal-delete {
          background: #dc2626 !important;
          color: #ffffff !important;
          border: 1px solid #b91c1c !important;
          box-shadow: 0 2px 6px rgba(220, 38, 38, 0.3) !important;
        }
        .confirm-modal-delete:hover {
          background: #b91c1c !important;
        }
        /* ================= ELEGANT CREATE PROJECT MODAL ================= */
        .create-project-modal {
          width: min(780px, 94vw) !important;
          height: min(860px, 94vh) !important;
          height: min(860px, 94dvh) !important;
          max-height: 94vh !important;
          max-height: 94dvh !important;
          display: flex !important;
          flex-direction: column !important;
          border-radius: 16px !important;
          background: #ffffff !important;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28) !important;
          overflow: hidden !important;
        }
        .create-project-modal header {
          flex: 0 0 auto !important;
          padding: 14px 28px !important;
          border-bottom: 1px solid #e2e8f0 !important;
          background: #f8fafc !important;
          display: flex !important;
          align-items: center !important;
          justify-content: space-between !important;
        }
        .create-project-modal header span {
          font-size: 10px !important;
          font-weight: 800 !important;
          color: #167461 !important;
          letter-spacing: 1px !important;
          text-transform: uppercase !important;
        }
        .create-project-modal header h2 {
          font-size: 20px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          margin: 4px 0 0 !important;
        }
        .create-project-modal .form-grid {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          grid-auto-rows: max-content !important;
          align-content: start !important;
          flex: 1 1 auto !important;
          min-height: 0 !important;
          gap: 16px !important;
          padding: 24px 28px 12px !important;
          overflow-y: auto !important;
          overscroll-behavior: contain !important;
        }
        .create-project-modal .create-slide {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
          align-content: start !important;
          gap: 16px !important;
          width: 100% !important;
        }
        .create-project-modal .field {
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
          margin-bottom: 0 !important;
        }
        .create-project-modal .field > span {
          font-size: 12px !important;
          font-weight: 700 !important;
          color: #334155 !important;
          margin-bottom: 0 !important;
        }
        .create-project-modal .field small {
          color: #7a8c95 !important;
          font-size: 10.5px !important;
          line-height: 1.4 !important;
        }
        .create-guide {
          display: grid !important;
          grid-template-columns: repeat(3, 1fr) !important;
          gap: 8px !important;
          padding: 12px !important;
          border: 1px solid #cfe2de !important;
          border-radius: 9px !important;
          background: #f1faf7 !important;
        }
        .create-guide div { display: flex !important; gap: 8px !important; color: #45616d !important; font-size: 10.5px !important; line-height: 1.4 !important; }
        .create-guide b { width: 22px !important; height: 22px !important; flex: none !important; display: grid !important; place-items: center !important; border-radius: 50% !important; background: #167461 !important; color: #fff !important; font-size: 10px !important; }
        .create-tabs {
          flex: 1 1 auto !important;
          display: grid !important;
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 8px !important;
          margin-right: 16px !important;
        }
        .create-tabs > div { display: flex !important; align-items: center !important; justify-content: center !important; gap: 8px !important; padding: 11px 14px !important; border: 1px solid #dce7e4 !important; border-radius: 9px !important; background: #f4f7f6 !important; color: #84939a !important; font-size: 12px !important; font-weight: 700 !important; transition: background .2s, color .2s, border-color .2s !important; }
        .create-tabs b { width: 22px !important; height: 22px !important; display: grid !important; place-items: center !important; flex: none !important; border-radius: 50% !important; background: #dfe7e5 !important; color: #60736e !important; font-size: 11px !important; }
        .create-tabs > div.active { background: #73b52d !important; border-color: #64a024 !important; color: #ffffff !important; box-shadow: 0 4px 12px rgba(115, 181, 45, 0.28) !important; }
        .create-tabs > div.active b { background: #ffffff !important; color: #4f8a1c !important; }
        .create-tabs > div.done { background: #f1f8ea !important; border-color: #cfe5b8 !important; color: #4f8a1c !important; }
        .create-tabs > div.done b { background: #73b52d !important; color: #ffffff !important; }
        .parameter-pair { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 16px !important; }
        .input-with-unit { display: grid !important; grid-template-columns: 1fr 76px !important; gap: 7px !important; }
        .parameter-summary { display: grid !important; grid-template-columns: repeat(4, 1fr) !important; gap: 9px !important; }
        .parameter-summary > div { padding: 13px !important; border: 1px solid #dce7e4 !important; border-radius: 9px !important; background: #f8fbfa !important; }
        .parameter-summary b { display: block !important; color: #167461 !important; font-size: 21px !important; }
        .parameter-summary span { color: #6c807b !important; font-size: 9.5px !important; }
        .impact-list { display: grid !important; gap: 7px !important; max-height: 260px !important; overflow-y: auto !important; padding-right: 3px !important; }
        .impact-list article { display: grid !important; grid-template-columns: minmax(0, 1fr) 58px !important; align-items: center !important; gap: 12px !important; padding: 9px 11px !important; border: 1px solid #e3ebe9 !important; border-radius: 8px !important; }
        .impact-list article div b { display: block !important; }
        .impact-list article div b { color: #233f38 !important; font-size: 10.5px !important; }
        .impact-list article > span { justify-self: end !important; padding: 4px 6px !important; border-radius: 10px !important; background: #eef8f5 !important; color: #167461 !important; font-size: 8.5px !important; font-weight: 800 !important; }
        .milestone-intro { padding: 11px 13px !important; border: 1px solid #cce5dc !important; border-radius: 8px !important; background: #f3faf7 !important; color: #3a6559 !important; font-size: 10.5px !important; line-height: 1.5 !important; }
        .milestone-input-list { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 10px !important; }
        .milestone-preview-card { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 12px !important; padding: 10px !important; border: 1px solid #dce9e4 !important; border-radius: 8px !important; background: #fff !important; }
        .milestone-preview-card span { display: flex !important; align-items: center !important; flex-wrap: wrap !important; min-width: 0 !important; gap: 7px !important; color: #314d44 !important; font-size: 10.5px !important; }
        .milestone-preview-card em { white-space: nowrap !important; color: #6c807b !important; font-size: 8px !important; font-style: normal !important; }
        .milestone-preview-card strong { white-space: nowrap !important; color: #167461 !important; font-size: 11px !important; }
        .create-section-title {
          grid-column: 1 / -1 !important;
          margin: 2px 0 -5px !important;
          padding-bottom: 7px !important;
          border-bottom: 1px solid #e8eef1 !important;
          color: #167461 !important;
          font-size: 10px !important;
          font-weight: 800 !important;
          letter-spacing: .8px !important;
          text-transform: uppercase !important;
        }
        .create-project-modal .field input,
        .create-project-modal .field select {
          height: 42px !important;
          padding: 0 14px !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 8px !important;
          font-size: 13px !important;
          color: #0f172a !important;
          background: #ffffff !important;
          transition: all 0.15s ease !important;
        }
        .create-project-modal .field input:focus,
        .create-project-modal .field select:focus {
          border-color: #167461 !important;
          box-shadow: 0 0 0 3px rgba(22, 116, 97, 0.15) !important;
          outline: none !important;
        }
        .create-project-modal .field-wide {
          grid-column: 1 / -1 !important;
        }
        .create-project-modal .file-upload-box {
          padding: 12px 16px !important;
          background: #f8fafc !important;
          border: 1px dashed #cbd5e1 !important;
          border-radius: 8px !important;
          display: flex !important;
          flex-direction: column !important;
          gap: 6px !important;
        }
        .create-project-modal footer {
          padding: 16px 28px 22px !important;
          flex: 0 0 auto !important;
          display: flex !important;
          align-items: center !important;
          justify-content: flex-end !important;
          gap: 12px !important;
          border-top: 1px solid #f1f5f9 !important;
          background: #ffffff !important;
        }
        @media (max-width: 640px) {
          .create-project-modal header { padding: 16px 18px 12px !important; }
          .create-project-modal .form-grid { padding: 16px 18px 12px !important; }
          .create-project-modal .create-slide { grid-template-columns: minmax(0, 1fr) !important; }
          .create-project-modal footer { padding: 12px 18px calc(12px + env(safe-area-inset-bottom)) !important; flex-wrap: wrap !important; }
          .create-project-modal footer .secondary-button,
          .create-project-modal footer .primary-button { display: inline-flex !important; align-items: center !important; justify-content: center !important; flex: 1 1 0 !important; white-space: nowrap !important; }
          .create-tabs { margin-right: 10px !important; gap: 6px !important; }
          .create-tabs > div { padding: 9px 8px !important; font-size: 11px !important; }
          .parameter-pair, .parameter-summary { grid-template-columns: 1fr 1fr !important; }
          .milestone-input-list { grid-template-columns: 1fr !important; }
          .impact-list article { grid-template-columns: 1fr 54px !important; }
        }
        /* ================= 7-COLUMN MASTER TIMELINE TASK GRID ================= */
        .workspace-topbar {
          height: auto !important;
          min-height: 60px !important;
          flex-wrap: wrap !important;
          gap: 8px 16px !important;
          padding-top: 8px !important;
          padding-bottom: 8px !important;
        }
        .workspace-topbar .breadcrumbs {
          flex: 1 1 220px !important;
          min-width: 0 !important;
          white-space: nowrap !important;
        }
        .workspace-topbar .top-actions {
          flex: 0 1 auto !important;
          flex-wrap: wrap !important;
          justify-content: flex-end !important;
          gap: 6px !important;
        }
        .workspace-topbar .top-actions button,
        .workspace-topbar .saved-state {
          flex: none !important;
          white-space: nowrap !important;
        }
        .task-grid {
          background: #ffffff !important;
          border-radius: 10px !important;
          border: 1px solid #e2e8f0 !important;
          overflow: hidden !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
        }
        .task-grid .grid-header {
          display: grid !important;
          grid-template-columns: 150px minmax(280px, 2.5fr) 180px 120px 120px minmax(140px, 1.2fr) minmax(140px, 1.2fr) !important;
          align-items: center !important;
          min-width: 1130px !important;
          height: 42px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #e2e8f0 !important;
          font-size: 11px !important;
          font-weight: 800 !important;
          color: #475569 !important;
          letter-spacing: 0.4px !important;
          text-transform: uppercase !important;
        }
        .task-grid .grid-header > span {
          padding: 0 12px !important;
          border-right: 1px solid #edf2f7 !important;
          display: flex !important;
          align-items: center !important;
          height: 100% !important;
        }
        .task-grid .grid-header > span:last-child {
          border-right: none !important;
        }
        .task-grid .grid-header > span:nth-child(3) {
          padding: 0 8px !important;
        }
        .task-grid .task-row {
          display: grid !important;
          grid-template-columns: 150px minmax(280px, 2.5fr) 180px 120px 120px minmax(140px, 1.2fr) minmax(140px, 1.2fr) !important;
          align-items: center !important;
          min-width: 1130px !important;
          min-height: 44px !important;
          border-bottom: 1px solid #f1f5f9 !important;
          color: #1e293b !important;
          font-size: 12.5px !important;
          transition: background 0.12s ease !important;
          cursor: pointer !important;
        }
        .task-grid .task-row:hover {
          background: #f8fafc !important;
        }
        .task-grid .task-row.selected {
          background: #eff6ff !important;
          box-shadow: inset 3px 0 #1a56a8 !important;
        }
        .task-grid .task-row.summary {
          background: #fafafa !important;
          font-weight: 700 !important;
        }
        .task-grid .task-row.level-1 {
          background: #f1f5f9 !important;
          font-weight: 800 !important;
        }
        .task-cell-wbs {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          padding-left: calc(10px + var(--indent, 0px)) !important;
          padding-right: 8px !important;
          height: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
        }
        .wbs-tag {
          font-size: 11px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          background: #e2e8f0 !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          white-space: nowrap !important;
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .task-row.level-1 .wbs-tag {
          background: #cbd5e1 !important;
          color: #0f172a !important;
        }
        .task-cell-name {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          padding: 6px 12px !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          font-size: 12.5px !important;
          min-width: 0 !important;
        }
        .task-name-text {
          min-width: 0 !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .task-row.summary .task-cell-name {
          font-weight: 800 !important;
          color: #0f172a !important;
        }
        .task-cell-duration {
          padding: 0 12px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          color: #475569 !important;
        }
        .duration-badge {
          display: inline-block !important;
          padding: 2px 8px !important;
          background: #f1f5f9 !important;
          border-radius: 6px !important;
          font-size: 11.5px !important;
          font-weight: 700 !important;
          color: #334155 !important;
        }
        .task-cell-date {
          padding: 0 12px !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          color: #334155 !important;
          white-space: nowrap !important;
        }
        .task-cell-note {
          padding: 0 12px !important;
          font-size: 12px !important;
          color: #64748b !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
        }
        .task-cell-links {
          padding: 0 12px !important;
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
          flex-wrap: wrap !important;
        }
        .link-chips-wrap {
          display: flex !important;
          align-items: center !important;
          gap: 4px !important;
          flex-wrap: wrap !important;
        }
        .link-chip {
          display: inline-flex !important;
          align-items: center !important;
          padding: 1px 6px !important;
          background: #eff6ff !important;
          color: #1d4ed8 !important;
          border: 1px solid #bfdbfe !important;
          border-radius: 4px !important;
          font-size: 10px !important;
          font-weight: 700 !important;
          white-space: nowrap !important;
        }
        .link-chip.conflict {
          background: #fef2f2 !important;
          color: #b91c1c !important;
          border-color: #fca5a5 !important;
        }
        /* ================= CONFIRM APPROVAL TABLE ================= */
        .confirm-approval-table .project-table-head,
        .confirm-approval-table .project-table-row {
          grid-template-columns: 120px minmax(220px, 2fr) 150px 140px 160px 110px 150px !important;
        }
        .confirm-approval-table .project-action-cell {
          justify-content: flex-start !important;
          gap: 6px !important;
        }
      `}</style>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <div className="brand-logo-wrap">
            <img className="brand-logo" src="/nova-group-logo-light.png" alt="Nova Group" />
          </div>
          <div className="brand-app">
            <div className="brand-code">PMD</div>
            <div className="brand-title">
              <span>PROJECT</span>
              <span>MANAGEMENT</span>
            </div>
          </div>
        </div>
        <div className="sidebar-collapse-row">
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
            aria-label={sidebarCollapsed ? "Mở rộng thanh điều hướng" : "Thu nhỏ thanh điều hướng"}
          >
            {sidebarCollapsed ? (
              <IconChevronRight />
            ) : (
              <>
                <IconChevronLeft />
                <span>Thu nhỏ</span>
              </>
            )}
          </button>
        </div>
        {/* Module 0: TRANG CHỦ — ở vị trí đầu tiên, trực tiếp không xổ dropdown */}
        <button
          type="button"
          className={`sidebar-section-toggle ${view === "home" ? "active" : ""}`}
          onClick={() => setView("home")}
          title="Trang chủ"
          style={view === "home" ? { background: "#23b26d", color: "#ffffff", borderRadius: "8px", fontWeight: 700 } : undefined}
        >
          <div className="section-toggle-left">
            <IconHome />
            <span>Trang chủ</span>
          </div>
        </button>

        {/* Module 1: LẬP MASTER TIMELINE — sổ ra/thu gọn được */}
        {(() => {
          const lapMtlSectionOpen = lapMtlOpen;
          return <>
            <button
              type="button"
              className={`sidebar-section-toggle ${lapMtlSectionOpen ? "open" : ""}`}
              onClick={() => {
                if (sidebarCollapsed) {
                  setView("projects");
                } else {
                  setLapMtlOpen((current) => !current);
                  setView("projects");
                }
              }}
              aria-expanded={lapMtlSectionOpen}
              title="Lập Master Timeline"
            >
              <div className="section-toggle-left">
                <IconBuilding />
                <span>Lập Master Timeline</span>
              </div>
              <IconChevronDown />
            </button>
            <nav className={`sidebar-nav sidebar-collapsible ${lapMtlSectionOpen ? "" : "collapsed"}`} aria-label="Điều hướng Lập MTL" aria-hidden={!lapMtlSectionOpen}>
              <button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconList />
                <span>Cấu trúc Master Timeline</span>
              </button>
              <button className={view === "init_template" ? "active" : ""} onClick={() => setView("init_template")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconSparkles />
                <span>Khởi tạo tiến độ</span>
              </button>
              <button className={view === "projects" || view === "workspace" ? "active" : ""} onClick={() => setView("projects")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconTimeline />
                <span>Lập / Cập nhật</span>
              </button>
              <button className={view === "confirm_approval" ? "active" : ""} onClick={() => setView("confirm_approval")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconFileCheck />
                <span>Xác nhận phê duyệt</span>
              </button>
            </nav>
          </>;
        })()}

        {/* Module 2: LẬP NHIỆM VỤ THIẾT KẾ */}
        {(() => {
          const isSectionOpen = designTaskOpen;
          return <>
            <button
              type="button"
              className={`sidebar-section-toggle ${isSectionOpen ? "open" : ""}`}
              onClick={() => {
                if (sidebarCollapsed) {
                  setView("design_task");
                } else {
                  setDesignTaskOpen((current) => !current);
                  setView("design_task");
                }
              }}
              aria-expanded={isSectionOpen}
              title="Lập Nhiệm Vụ Thiết Kế"
            >
              <div className="section-toggle-left">
                <IconDesignTask />
                <span>Lập Nhiệm Vụ Thiết Kế</span>
              </div>
              <IconChevronDown />
            </button>
            <nav className={`sidebar-nav sidebar-collapsible ${isSectionOpen ? "" : "collapsed"}`} aria-label="Điều hướng Lập Nhiệm vụ thiết kế" aria-hidden={!isSectionOpen}>
              <button className={view === "design_task" ? "active" : ""} onClick={() => setView("design_task")} tabIndex={isSectionOpen ? 0 : -1}>
                <IconTimeline />
                <span>Lập & Cập nhật NVTK</span>
              </button>
              <button className="" onClick={() => setView("design_task")} tabIndex={isSectionOpen ? 0 : -1}>
                <IconCheck />
                <span>PBCM góp ý NVTK</span>
              </button>
              <button className="" onClick={() => setView("design_task")} tabIndex={isSectionOpen ? 0 : -1}>
                <IconFileCheck />
                <span>Thẩm định & Phê duyệt</span>
              </button>
            </nav>
          </>;
        })()}

        {/* Module 3: LẬP FS THỰC THI (FS-Ver2) */}
        {(() => {
          const isSectionOpen = fsVer2Open;
          return <>
            <button
              type="button"
              className={`sidebar-section-toggle ${isSectionOpen ? "open" : ""}`}
              onClick={() => {
                if (sidebarCollapsed) {
                  setView("fs_ver2");
                } else {
                  setFsVer2Open((current) => !current);
                  setView("fs_ver2");
                }
              }}
              aria-expanded={isSectionOpen}
              title="Lập FS Thực Thi (FS-Ver2)"
            >
              <div className="section-toggle-left">
                <IconFS />
                <span>Lập FS Thực Thi (FS-Ver2)</span>
              </div>
              <IconChevronDown />
            </button>
            <nav className={`sidebar-nav sidebar-collapsible ${isSectionOpen ? "" : "collapsed"}`} aria-label="Điều hướng Lập FS Thực thi" aria-hidden={!isSectionOpen}>
              <button className={view === "fs_ver2" ? "active" : ""} onClick={() => setView("fs_ver2")} tabIndex={isSectionOpen ? 0 : -1}>
                <IconTimeline />
                <span>Lập & Phân tích FS</span>
              </button>
              <button className="" onClick={() => setView("fs_ver2")} tabIndex={isSectionOpen ? 0 : -1}>
                <IconCheck />
                <span>Đối chiếu số liệu các Ban</span>
              </button>
              <button className="" onClick={() => setView("fs_ver2")} tabIndex={isSectionOpen ? 0 : -1}>
                <IconFileCheck />
                <span>Phê duyệt FS-Ver2</span>
              </button>
            </nav>
          </>;
        })()}

        {/* Module 4: THEO DÕI DỰ ÁN — ở vị trí cuối cùng */}
        {(() => {
          const isSectionOpen = trackingOpen;
          return <>
            <button
              type="button"
              className={`sidebar-section-toggle ${isSectionOpen ? "open" : ""}`}
              onClick={() => {
                if (sidebarCollapsed) {
                  setView("overview");
                } else {
                  setTrackingOpen((current) => !current);
                  setView("overview");
                }
              }}
              aria-expanded={isSectionOpen}
              title="Theo Dõi Dự Án"
            >
              <div className="section-toggle-left">
                <IconGauge />
                <span>Theo Dõi Dự Án</span>
              </div>
              <IconChevronDown />
            </button>
            <nav className={`sidebar-nav sidebar-collapsible ${isSectionOpen ? "" : "collapsed"}`} aria-label="Điều hướng Theo dõi dự án" aria-hidden={!isSectionOpen}>
              <button className={view === "overview" && overviewSource === "approved" ? "active" : ""} onClick={() => { setView("overview"); setOverviewSource("approved"); }} tabIndex={isSectionOpen ? 0 : -1}>
                <IconTimeline />
                <span>Tiến độ tổng thể MTL</span>
              </button>
              <button className={view === "overview" && overviewSource === "all" ? "active" : ""} onClick={() => { setView("overview"); setOverviewSource("all"); }} tabIndex={isSectionOpen ? 0 : -1}>
                <IconList />
                <span>Theo dõi công việc & KPI</span>
              </button>
            </nav>
          </>;
        })()}

        <div className="sidebar-footer" style={{ marginTop: "auto", padding: "16px 18px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", color: "#94a3b8", fontSize: "11px", lineHeight: "1.6" }}>
          <div className="sidebar-footer-info">
            <div style={{ color: "#dbe7ec", fontWeight: 700 }}>{currentAccount.name}</div>
            <div>{currentAccount.username}</div>
          </div>
          <button type="button" onClick={logout} className="sidebar-logout-btn" title="Đăng xuất">
            <IconLogOut />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      <section className="workspace">
        {view === "home" ? (
          <section className="home-dashboard-view">
            <header className="home-topbar">
              <div className="home-breadcrumb">
                <button
                  type="button"
                  className="topbar-toggle-sidebar-btn"
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                  aria-label="Chuyển đổi thanh điều hướng"
                >
                  <IconMenu />
                </button>
                <div className="home-breadcrumb-link">
                  <IconHome />
                  <span>Dự án</span>
                </div>
                <span className="home-breadcrumb-sep">&gt;</span>
                <span className="home-breadcrumb-title">
                  BẢNG ĐIỀU HÀNH &amp; THEO DÕI HIỆU SUẤT BĐHDA
                </span>
              </div>

              {/* Minimalist Period Switcher directly in topbar */}
              <div className="period-chips-group-flat">
                <button
                  type="button"
                  className={`period-chip-btn-flat ${homePeriod === "6m" ? "active" : ""}`}
                  onClick={() => setHomePeriod("6m")}
                >
                  <IconCalendar />
                  <span>6 Tháng đầu 2026</span>
                </button>
                <button
                  type="button"
                  className={`period-chip-btn-flat ${homePeriod === "q3" ? "active" : ""}`}
                  onClick={() => setHomePeriod("q3")}
                >
                  <span>Quý 3/2026</span>
                </button>
                <button
                  type="button"
                  className={`period-chip-btn-flat ${homePeriod === "year" ? "active" : ""}`}
                  onClick={() => setHomePeriod("year")}
                >
                  <span>Cả năm 2026</span>
                </button>
              </div>

              <div className="home-topbar-right">
                <div className="home-pill-badge kpi">
                  <span>KPI: {homePeriod === "6m" ? "88,0%" : homePeriod === "q3" ? "85,5%" : "89,2%"}</span>
                </div>
                <div className="home-pill-badge overdue">
                  <span>Trễ: 3 việc</span>
                </div>
                <div className="home-pill-badge date">
                  <IconCalendar />
                  <span>{formatDate(overviewToday)}</span>
                </div>
                <div className="home-role-title">
                  Giám đốc Ban điều hành dự án
                </div>
              </div>
            </header>

            {(() => {
              const todayDoneCount = todayTasksList.filter((t) => t.done).length;
              const todayTotalCount = todayTasksList.length;

              const bdhdaOperationsList = [
                {
                  code: "NV-01",
                  name: "Lập & Kiểm soát Master Timeline (WBS Cấp 1-5)",
                  dept: "Phòng Quản lý Dự án & MTL",
                  progress: 92,
                  target: 90,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "projects" as const,
                  actionLabel: "Xem Lập MTL",
                },
                {
                  code: "NV-02",
                  name: "Phê duyệt Nhiệm vụ Thiết kế (NVTVK) & Phương án KT",
                  dept: "Phòng Quản lý Thiết kế",
                  progress: 86,
                  target: 80,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "design_task" as const,
                  actionLabel: "Xem NVTK",
                },
                {
                  code: "NV-03",
                  name: "Thẩm định Mô hình Khả thi FS Thực thi (FS-Ver2)",
                  dept: "Phòng Thẩm định Đầu tư & FS",
                  progress: 82,
                  target: 80,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "fs_ver2" as const,
                  actionLabel: "Xem FS-Ver2",
                },
                {
                  code: "NV-04",
                  name: "Quản lý Hồ sơ Pháp lý & Mốc Giấy phép XD (GPXD)",
                  dept: "Ban Pháp lý Dự án",
                  progress: 90,
                  target: 85,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "overview" as const,
                  actionLabel: "Xem Tiến độ",
                },
                {
                  code: "NV-05",
                  name: "Giám sát Tiến độ Hiện trường & Nghiệm thu MEP",
                  dept: "Ban QLDA Xây dựng Hiện trường",
                  progress: 85,
                  target: 80,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "overview" as const,
                  actionLabel: "Xem Tiến độ",
                },
                {
                  code: "NV-06",
                  name: "Hoàn công, Thẩm duyệt PCCC & Bàn giao Dự án",
                  dept: "Ban Quản lý Bàn giao & CSKH",
                  progress: 76,
                  target: 80,
                  status: "improve",
                  statusText: "Cần đẩy nhanh",
                  actionView: "overview" as const,
                  actionLabel: "Mốc bàn giao",
                },
              ];

              const filteredOps = bdhdaOperationsList.filter((op) => {
                if (homeOpFilter === "passed") return op.status === "passed";
                if (homeOpFilter === "improve") return op.status === "improve";
                return true;
              });

              const teamMembersList = [
                {
                  role: "Phó giám đốc Phòng điều hành dự án",
                  email: "gmd.pgd@novaland.com.vn",
                  kpiScore: 92.0,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  scope: "Phụ trách Vùng Hồ Chí Minh & Khối Cao tầng",
                  projects: 4,
                },
                {
                  role: "Trưởng phòng cao cấp Quản lý dự án",
                  email: "gmd.tpcc@novaland.com.vn",
                  kpiScore: 88.5,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  scope: "Phụ trách Vùng Phan Thiết 1 & Khu nghỉ dưỡng",
                  projects: 3,
                },
                {
                  role: "Trưởng phòng Quản lý dự án",
                  email: "gmd.tp@novaland.com.vn",
                  kpiScore: 78.0,
                  status: "improve",
                  statusText: "Cần đôn đốc",
                  scope: "Kiểm soát MT, & Thẩm định, mốc tiến độ",
                  projects: 5,
                },
                {
                  role: "Admin hệ thống (PMD / ITT)",
                  email: "itt.admin@novagroup.vn",
                  kpiScore: 96.0,
                  status: "passed",
                  statusText: "Xuất sắc",
                  scope: "Quản trị dữ liệu WBS & Phân quyền hệ thống",
                  projects: 14,
                },
              ];

              const overdueList = [
                {
                  id: "od-1",
                  title: "Nộp hồ sơ thẩm duyệt nghiệm thu PCCC Tháp B & C",
                  project: "NovaWorld Phan Thiết",
                  projectCode: "NVL-NVW-2026",
                  projectId: "proj-novaworld-phanthiet",
                  dept: "Ban QLDA & Pháp lý",
                  dueDate: "10/08/2026",
                  daysLate: 40,
                  severity: "critical",
                  severityText: "Nghiêm trọng",
                  targetModule: "workspace" as const,
                },
                {
                  id: "od-2",
                  title: "Nghiệm thu hoàn thành cọc khoan nhồi Phân khu 2",
                  project: "Aqua City",
                  projectCode: "NVL-AQC-2026",
                  projectId: "proj-aqua-city",
                  dept: "Ban QLDA Hiện trường",
                  dueDate: "12/08/2026",
                  daysLate: 38,
                  severity: "warning",
                  severityText: "Cảnh báo trễ",
                  targetModule: "workspace" as const,
                },
                {
                  id: "od-3",
                  title: "Đối chiếu chi phí tư vấn và ký nháy hồ sơ NVTK",
                  project: "Sunrise Riverside",
                  projectCode: "NVL-SRR-2026",
                  projectId: "proj-sunrise-riverside",
                  dept: "Phòng Quản lý Thiết kế",
                  dueDate: "20/08/2026",
                  daysLate: 30,
                  severity: "alert",
                  severityText: "Chờ ký duyệt",
                  targetModule: "design_task" as const,
                },
              ];

              return (
                <div className="home-content-wrap">
                  {/* Flat 3-Column Landscape Grid */}
                  <div className="home-landscape-grid">
                    {/* CỘT 1: TỔNG QUAN TIẾN ĐỘ & TRÁCH NHIỆM QUẢN LÝ */}
                    <div className="home-col">
                      {/* Card 1A: Tổng Quan Tiến Độ */}
                      <div className="exec-card-flat card-kpi">
                        <div className="exec-card-head-flat">
                          <div className="exec-card-title-flat">
                            <div className="exec-icon-box-flat green">
                              <IconAward />
                            </div>
                            <span>Tổng Quan Tiến Độ</span>
                          </div>
                          <span className="exec-badge-pill-flat">
                            {homePeriod === "6m" ? "Kỳ 6 Tháng" : homePeriod === "q3" ? "Kỳ Quý 3" : "Kỳ Cả Năm"}
                          </span>
                        </div>

                        <ExecutiveArcGauge
                          score={homePeriod === "6m" ? 88.0 : homePeriod === "q3" ? 85.5 : 89.2}
                          max={100}
                          label="ĐẠT CHUẨN"
                        />

                        <div className="gauge-sub-metrics-grid">
                          <div className="gauge-sub-metric-item">
                            <span className="sub-metric-label"><span className="metric-dot green">●</span> Đúng hạn</span>
                            <span className="sub-metric-val">92.5 d</span>
                          </div>
                          <div className="gauge-sub-metric-item">
                            <span className="sub-metric-label"><span className="metric-dot red">●</span> Trễ hạn</span>
                            <span className="sub-metric-val text-red">+3.5 d</span>
                          </div>
                          <div className="gauge-sub-metric-item">
                            <span className="sub-metric-label"><span className="metric-dot orange">●</span> Quá hạn</span>
                            <span className="sub-metric-val">75.0%</span>
                          </div>
                        </div>
                      </div>

                      {/* Card 1B: Trách Nhiệm Quản Lý */}
                      <div className="exec-card-flat card-mgmt">
                        <div className="exec-card-head-flat">
                          <div className="exec-card-title-flat">
                            <div className="exec-icon-box-flat purple">
                              <IconUsers />
                            </div>
                            <span>Trách Nhiệm Quản Lý</span>
                          </div>
                          <span className="exec-badge-pill-flat green">
                            3/4 Đạt (75%)
                          </span>
                        </div>

                        <div className="mgmt-flat-list">
                          {teamMembersList.map((m) => (
                            <div className="mgmt-flat-item" key={m.role}>
                              <div className="mgmt-flat-info">
                                <div className="mgmt-flat-role">{m.role}</div>
                                <div className="mgmt-flat-scope">{m.scope}</div>
                              </div>
                              <div className={`mgmt-flat-score-box ${m.status}`}>
                                <span className="mgmt-flat-score">{m.kpiScore.toFixed(1)}</span>
                                <span className="mgmt-flat-status">{m.statusText}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* CỘT 2: TIẾN ĐỘ NGHIỆP VỤ BĐHDA */}
                    <div className="home-col">
                      <div className="exec-card-flat card-ops">
                        <div className="exec-card-head-flat">
                          <div className="exec-card-title-flat">
                            <div className="exec-icon-box-flat blue">
                              <IconBriefcase />
                            </div>
                            <span>Tiến Độ Nghiệp Vụ BĐHDA</span>
                          </div>
                          <div className="op-filter-pills-flat">
                            <button
                              type="button"
                              className={`op-filter-pill-btn ${homeOpFilter === "all" ? "active" : ""}`}
                              onClick={() => setHomeOpFilter("all")}
                            >
                              Tất cả ({bdhdaOperationsList.length})
                            </button>
                            <button
                              type="button"
                              className={`op-filter-pill-btn ${homeOpFilter === "passed" ? "active" : ""}`}
                              onClick={() => setHomeOpFilter("passed")}
                            >
                              Đạt ({bdhdaOperationsList.filter((o) => o.status === "passed").length})
                            </button>
                            <button
                              type="button"
                              className={`op-filter-pill-btn ${homeOpFilter === "improve" ? "active" : ""}`}
                              onClick={() => setHomeOpFilter("improve")}
                            >
                              Cần đẩy nhanh ({bdhdaOperationsList.filter((o) => o.status === "improve").length})
                            </button>
                          </div>
                        </div>

                        <div className="op-subhead-row-flat">
                          <div className="op-legend-flat">
                            <span className="op-legend-item" style={{ color: "#16a34a" }}>● Đạt chuẩn (≥80%)</span>
                            <span className="op-legend-item" style={{ color: "#ea580c" }}>● Cần cải thiện (&lt;80%)</span>
                          </div>
                          <button
                            type="button"
                            className="op-link-all"
                            onClick={() => {
                              setTrackingOpen(true);
                              setView("overview");
                            }}
                          >
                            <span>Xem tất cả tiến độ</span>
                            <span>→</span>
                          </button>
                        </div>

                        <div className="op-flat-list">
                          {filteredOps.map((op) => (
                            <div className="op-flat-card" key={op.code}>
                              <div className="op-flat-row-1">
                                <div className="op-flat-left">
                                  <span className={`op-flat-badge ${op.status === "improve" ? "orange" : "blue"}`}>
                                    {op.code}
                                  </span>
                                  <span className="op-flat-title" title={op.name}>
                                    {op.name}
                                  </span>
                                </div>
                                <div className="op-flat-right">
                                  <span className={`op-flat-score ${op.status === "improve" ? "orange" : "green"}`}>
                                    {op.progress}%
                                  </span>
                                  <button
                                    type="button"
                                    className="op-flat-btn"
                                    onClick={() => setView(op.actionView)}
                                    title={`Mở phân hệ ${op.actionLabel}`}
                                  >
                                    {op.actionLabel} →
                                  </button>
                                </div>
                              </div>
                              <div className="op-flat-row-2">
                                <span>{op.dept}</span>
                                <span>Chỉ tiêu: {op.target}%</span>
                              </div>
                              <div className="op-flat-bar-track">
                                <div
                                  className={`op-flat-bar-fill ${op.status === "improve" ? "orange" : "green"}`}
                                  style={{ width: `${op.progress}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* CỘT 3: CÔNG VIỆC HÔM NAY & CÔNG VIỆC ĐANG TRỄ HẠN */}
                    <div className="home-col">
                      {/* Card 3A: Công Việc Hôm Nay */}
                      <div className="exec-card-flat card-today">
                        <div className="exec-card-head-flat">
                          <div className="exec-card-title-flat">
                            <div className="exec-icon-box-flat blue">
                              <IconClock />
                            </div>
                            <span>Công Việc Hôm Nay</span>
                          </div>
                          <span
                            className="exec-badge-pill-flat blue"
                          >
                            {todayDoneCount}/{todayTotalCount} Hoàn thành
                          </span>
                        </div>

                        <div className="today-flat-list">
                          {todayTasksList.map((t) => (
                            <div
                              key={t.id}
                              className={`today-flat-item ${t.done ? "is-done" : ""}`}
                              onClick={() => {
                                setTodayTasksList((prev) =>
                                  prev.map((item) => (item.id === t.id ? { ...item, done: !item.done } : item))
                                );
                              }}
                            >
                              <div className={`today-flat-check ${t.done ? "checked" : ""}`}>
                                {t.done && (
                                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </div>
                              <div className="today-flat-body">
                                <div className="today-flat-title">{t.title}</div>
                                <div className="today-flat-meta">
                                  <span>🕒 {t.time}</span>
                                  {t.project && <span>🏢 {t.project}</span>}
                                </div>
                              </div>
                              <span className={`today-flat-pill ${t.category}`}>
                                {t.category === "routine" ? "Định kỳ" : t.category === "technical" ? "Kỹ thuật" : "Giao thêm"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Card 3B: Công Việc Đang Trễ Hạn */}
                      <div className="exec-card-flat card-overdue">
                        <div className="exec-card-head-flat" style={{ borderBottomColor: "#fee2e2" }}>
                          <div className="exec-card-title-flat red">
                            <div className="exec-icon-box-flat red">
                              <IconAlertTriangle />
                            </div>
                            <span>Công Việc Đang Trễ Hạn</span>
                          </div>
                          <span className="exec-badge-pill-flat red">
                            {overdueList.length} việc
                          </span>
                        </div>

                        <div className="overdue-flat-list">
                          {overdueList.map((item) => (
                            <div className="overdue-flat-card" key={item.id}>
                              <div className="overdue-flat-top">
                                <span className="overdue-flat-title" title={item.title}>
                                  {item.title}
                                </span>
                                <div className="overdue-flat-actions">
                                  <span className="overdue-flat-badge-days">
                                    Trễ {item.daysLate} ngày
                                  </span>
                                  <button
                                    type="button"
                                    className="overdue-flat-btn-urge"
                                    onClick={() => setToast(`Đã gửi thông báo đôn đốc khẩn cấp cho: ${item.dept}`)}
                                    title="Gửi thông báo đôn đốc trực tiếp"
                                  >
                                    Đôn đốc
                                  </button>
                                  <button
                                    type="button"
                                    className="overdue-flat-btn-mtl"
                                    onClick={() => {
                                      if (item.targetModule === "workspace") {
                                        setActiveId(item.projectId);
                                        setView("workspace");
                                      } else {
                                        setView(item.targetModule);
                                      }
                                    }}
                                    title="Mở MTL để xem chi tiết"
                                  >
                                    ↗ MTL
                                  </button>
                                </div>
                              </div>
                              <div className="overdue-flat-sub">
                                <span>🏢 {item.project}</span>
                                <span style={{ color: "#ef4444", marginLeft: "8px" }}>📅 Hạn: {item.dueDate}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        ) : view === "overview" ? (
          <>
            <header className="topbar overview-topbar">
              <div style={{ width: "120px", display: "flex", alignItems: "center" }}>
                <button
                  type="button"
                  className="topbar-toggle-sidebar-btn"
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                  aria-label="Chuyển đổi thanh điều hướng"
                >
                  <IconMenu />
                </button>
              </div>
              <div className="overview-title-center">
                <h1>THEO DÕI THỰC HIỆN CÔNG VIỆC</h1>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", justifyContent: "center", marginTop: "4px" }}>
                  <div className="overview-date-badge">
                    <IconCalendar />
                    <span>{formatDate(overviewToday)}</span>
                  </div>
                  <div className="source-toggle">
                    <button type="button" className={overviewSource === "approved" ? "active" : ""} onClick={() => setOverviewSource("approved")} title="Chỉ thống kê từ các Master Timeline đã có phê duyệt E-Approval">
                      MTL đã duyệt ({officialApprovedProjects.length})
                    </button>
                    <button type="button" className={overviewSource === "all" ? "active" : ""} onClick={() => setOverviewSource("all")} title="Thống kê toàn bộ dự án">
                      Tất cả ({projects.length})
                    </button>
                  </div>
                </div>
              </div>
              <div className="top-actions">
                <button type="button" className="icon-action-btn" title="Làm mới"><IconRefresh /></button>
                <button type="button" className="icon-action-btn" title="Bộ lọc"><IconFilter /></button>
                <button type="button" className="icon-action-btn" title="Tùy chọn"><IconMore /></button>
              </div>
            </header>

            <section className="overview">
              <div className="overview-top">
                {/* 1. Filter Card */}
                <div className="overview-filters-card">
                  <div className="filter-col">
                    <span className="filter-label">Vùng</span>
                    <div className="filter-select-wrapper">
                      <select value={overviewRegion} onChange={(event) => setOverviewRegion(event.target.value)}>
                        <option value="all">All</option>
                        {overviewRegions.map((region) => <option key={region} value={region}>{region}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="filter-col">
                    <span className="filter-label">Tên dự án</span>
                    <div className="filter-select-wrapper">
                      <select value={overviewProject} onChange={(event) => setOverviewProject(event.target.value)}>
                        <option value="all">All</option>
                        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="filter-col">
                    <span className="filter-label">Phòng/Ban</span>
                    <div className="filter-select-wrapper">
                      <select value={overviewGroup} onChange={(event) => setOverviewGroup(event.target.value)}>
                        <option value="all">All</option>
                        {GROUPS.map((group) => <option key={group.code} value={group.code}>{group.code} · {group.short}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* 2. KPI 1: TỔNG VÙNG / DỰ ÁN */}
                <div className="kpi-card kpi-scope-split">
                  <div className="kpi-split-top">
                    <div className="kpi-icon-box"><IconBuilding /></div>
                    <div className="kpi-split-top-text">
                      <span>TỔNG VÙNG</span>
                      <b>{overview.regionCount || 14}</b>
                    </div>
                  </div>
                  <div className="kpi-split-bottom">
                    <span>DỰ ÁN</span>
                    <b>{formatCount(overview.projectCount || 64)}</b>
                  </div>
                </div>

                {/* 3. KPI 2: 9 BAN/PHÒNG GIÁN TIẾP */}
                <div className="kpi-card kpi-work-split indirect">
                  <header className="kpi-split-header">
                    <div className="kpi-header-left">
                      <IconUsers />
                      <span>{overview.indirectGroups} BAN/PHÒNG GIÁN TIẾP</span>
                    </div>
                    <b>{formatCount(overview.indirect.total)}</b>
                  </header>
                  <div className="kpi-split-body">
                    <div className="kpi-legend-rows">
                      <div className="kpi-legend-row">
                        <span className="dot dot-running" />
                        <span className="label">Đang triển khai</span>
                        <b className="val">{formatCount(overview.indirect.running)}</b>
                      </div>
                      <div className="kpi-legend-row">
                        <span className="dot dot-done" />
                        <span className="label">Hoàn thành</span>
                        <b className="val">{formatCount(overview.indirect.done)}</b>
                      </div>
                      <div className="kpi-legend-row">
                        <span className="dot dot-late" />
                        <span className="label">Trễ hạn</span>
                        <b className="val">{formatCount(overview.indirect.late)}</b>
                      </div>
                    </div>
                    <div className="kpi-donut-container">
                      <Donut stat={overview.indirect} size={76} />
                    </div>
                  </div>
                </div>

                {/* 4. KPI 3: 4 PHÒNG TRỰC TIẾP */}
                <div className="kpi-card kpi-work-split direct">
                  <header className="kpi-split-header">
                    <div className="kpi-header-left">
                      <IconFactory />
                      <span>{overview.directGroups} PHÒNG TRỰC TIẾP</span>
                    </div>
                    <b>{formatCount(overview.direct.total)}</b>
                  </header>
                  <div className="kpi-split-body">
                    <div className="kpi-legend-rows">
                      <div className="kpi-legend-row">
                        <span className="dot dot-running" />
                        <span className="label">Đang triển khai</span>
                        <b className="val">{formatCount(overview.direct.running)}</b>
                      </div>
                      <div className="kpi-legend-row">
                        <span className="dot dot-done" />
                        <span className="label">Hoàn thành</span>
                        <b className="val">{formatCount(overview.direct.done)}</b>
                      </div>
                      <div className="kpi-legend-row">
                        <span className="dot dot-late" />
                        <span className="label">Trễ hạn</span>
                        <b className="val">{formatCount(overview.direct.late)}</b>
                      </div>
                    </div>
                    <div className="kpi-donut-container">
                      <Donut stat={overview.direct} size={76} />
                    </div>
                  </div>
                </div>
              </div>

              {overview.all.total === 0 ? (
                <div className="overview-empty">
                  <b>Chưa có dữ liệu công việc</b>
                  <span>Tạo dự án và sinh Master Timeline để theo dõi tiến độ tại đây.</span>
                  <button className="primary-button" onClick={openCreate}>Tạo Master timeline</button>
                </div>
              ) : (
                <div className="overview-grid">
                  {/* Panel 1: CÔNG VIỆC THEO PHÒNG BAN */}
                  <section className="panel">
                    <header className="panel-head">
                      <h2>CÔNG VIỆC THEO PHÒNG BAN</h2>
                      <div className="panel-legend">
                        <span className="legend-item"><i className="dot dot-running" />Đang triển khai</span>
                        <span className="legend-item"><i className="dot dot-done" />Hoàn thành</span>
                        <span className="legend-item"><i className="dot dot-late" />Trễ hạn</span>
                      </div>
                    </header>
                    <div className="bar-chart-container">
                      <div className="bar-list">
                        {overview.groupRows.map(({ group, stat }) => (
                          <div className="bar-row" key={group.code}>
                            <span className="bar-label">{group.code} {group.short}</span>
                            <div className="bar-track-wrapper">
                              <span className="bar-track" style={{ width: `${(stat.total / overviewMaxGroupTotal) * 100}%` }}>
                                {stat.running > 0 && <i style={{ width: `${(stat.running / stat.total) * 100}%`, background: WORK_RUNNING }} title={`Đang triển khai: ${formatCount(stat.running)}`}>{stat.running / stat.total > 0.08 ? formatCount(stat.running) : ""}</i>}
                                {stat.done > 0 && <i style={{ width: `${(stat.done / stat.total) * 100}%`, background: WORK_DONE }} title={`Hoàn thành: ${formatCount(stat.done)}`}>{stat.done / stat.total > 0.08 ? formatCount(stat.done) : ""}</i>}
                                {stat.late > 0 && <i style={{ width: `${(stat.late / stat.total) * 100}%`, background: WORK_LATE }} title={`Trễ hạn: ${formatCount(stat.late)}`}>{stat.late / stat.total > 0.08 ? formatCount(stat.late) : ""}</i>}
                              </span>
                              <span className="bar-total">{formatCount(stat.total)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="bar-x-axis">
                        <span>0K</span>
                        <span>2K</span>
                        <span>4K</span>
                        <span>6K</span>
                        <span>8K</span>
                        <span>10K</span>
                      </div>
                    </div>
                  </section>

                  {/* Panel 2: CHI TIẾT THEO PHÒNG BAN */}
                  <section className="panel">
                    <header className="panel-head">
                      <h2>CHI TIẾT THEO PHÒNG BAN</h2>
                    </header>
                    <div className="heat-table">
                      <div className="heat-head">
                        <span>Phòng/Ban</span>
                        <span>Tổng công việc</span>
                        <span>Hoàn thành</span>
                        <span>Trễ hạn</span>
                        <span>Tỷ lệ trễ hạn</span>
                      </div>
                      <div className="heat-body">
                        {overview.groupRows.map(({ group, stat }) => {
                          const maxLate = Math.max(1, ...overview.groupRows.map((r) => r.stat.late));
                          const isHighLate = stat.late / maxLate > 0.5;
                          return (
                            <div className="heat-row" key={group.code}>
                              <span>{group.code} {group.short}</span>
                              <span>{formatCount(stat.total)}</span>
                              <span>{formatCount(stat.done)}</span>
                              <span className="heat-cell late-cell" style={{ background: stat.late ? (isHighLate ? "#f57c7c" : "#ffb3b3") : undefined, color: stat.late ? (isHighLate ? "#fff" : "#801515") : undefined }}>
                                {formatCount(stat.late)}
                              </span>
                              <span className="heat-cell rate-cell">
                                {latePercent(stat).toFixed(2)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="heat-row heat-total">
                        <span>Total</span>
                        <span>{formatCount(overview.all.total)}</span>
                        <span>{formatCount(overview.all.done)}</span>
                        <span>{formatCount(overview.all.late)}</span>
                        <span>{latePercent(overview.all).toFixed(2)}%</span>
                      </div>
                    </div>
                  </section>

                  {/* Panel 3: CÔNG VIỆC THEO DỰ ÁN */}
                  <section className="panel">
                    <header className="panel-head">
                      <h2>CÔNG VIỆC THEO DỰ ÁN</h2>
                      <div className="panel-legend">
                        <span className="legend-item"><i className="dot dot-running" />Đang triển khai</span>
                        <span className="legend-item"><i className="dot dot-done" />Hoàn thành</span>
                        <span className="legend-item"><i className="dot dot-late" />Trễ hạn</span>
                      </div>
                    </header>
                    <div className="project-chart-container">
                      <div className="chart-y-axis">
                        <span>2,000</span>
                        <span>1,500</span>
                        <span>1,000</span>
                        <span>500</span>
                        <span>0</span>
                      </div>
                      <div className="column-chart">
                        {overview.projectRows.slice(0, 5).map(({ project, stat }) => {
                          const chartMax = Math.max(1, ...overview.projectRows.slice(0, 5).flatMap((r) => [r.stat.running, r.stat.done, r.stat.late]));
                          return (
                            <div className="column-group" key={project.id}>
                              <div className="column-bars">
                                <div className="col-bar-wrap">
                                  <b>{formatCount(stat.running)}</b>
                                  <i style={{ height: `${(stat.running / chartMax) * 100}%`, background: WORK_RUNNING }} title={`Đang triển khai: ${formatCount(stat.running)}`} />
                                </div>
                                <div className="col-bar-wrap">
                                  <b>{formatCount(stat.done)}</b>
                                  <i style={{ height: `${(stat.done / chartMax) * 100}%`, background: WORK_DONE }} title={`Hoàn thành: ${formatCount(stat.done)}`} />
                                </div>
                                <div className="col-bar-wrap">
                                  <b>{formatCount(stat.late)}</b>
                                  <i style={{ height: `${(stat.late / chartMax) * 100}%`, background: WORK_LATE }} title={`Trễ hạn: ${formatCount(stat.late)}`} />
                                </div>
                              </div>
                              <div className="column-label" title={`${project.code} - ${project.name}`}>
                                <small>[{project.code}]</small>
                                <b>{project.name}</b>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  {/* Panel 4: NHÂN SỰ THỰC HIỆN */}
                  <section className="panel">
                    <header className="panel-head">
                      <h2>NHÂN SỰ THỰC HIỆN</h2>
                    </header>
                    <div className="heat-table person-table">
                      <div className="heat-head person-head">
                        <span>Tên QLTT</span>
                        <span>Người thực hiện</span>
                        <span>Tổng công việc</span>
                        <span>Trễ hạn</span>
                        <span>Tỷ lệ trễ hạn</span>
                      </div>
                      <div className="heat-body">
                        {overview.personRows.map(({ manager, person, stat }) => {
                          const maxLate = Math.max(1, ...overview.personRows.map((r) => r.stat.late));
                          const isHighLate = stat.late / maxLate > 0.5;
                          return (
                            <div className="heat-row person-row" key={person}>
                              <span className="manager-cell" title={manager}>{manager}</span>
                              <span className="person-cell" title={person}>{person}</span>
                              <span>{formatCount(stat.total)}</span>
                              <span className="heat-cell late-cell" style={{ background: stat.late ? (isHighLate ? "#e53935" : "#f57c7c") : undefined, color: stat.late ? "#fff" : undefined }}>
                                {formatCount(stat.late)}
                              </span>
                              <span className="heat-cell rate-cell">
                                {latePercent(stat).toFixed(2)}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div className="heat-row person-row heat-total">
                        <span>Total</span>
                        <span />
                        <span>{formatCount(overview.all.total)}</span>
                        <span>{formatCount(overview.all.late)}</span>
                        <span>{latePercent(overview.all).toFixed(2)}%</span>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </section>
          </>
        ) : view === "projects" ? (
          <>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <button
                  type="button"
                  className="topbar-toggle-sidebar-btn"
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                  aria-label="Chuyển đổi thanh điều hướng"
                >
                  <IconMenu />
                </button>
                <h1>Dự án</h1>
                <div className="top-stat-cards">
                  <div className="top-stat-card">
                    <span>TỔNG DỰ ÁN</span>
                    <b>{projects.length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐANG LẬP / CẬP NHẬT</span>
                    <b style={{ color: "#1a56a8" }}>{projects.filter((p) => p.approvalStatus !== "approved" && !p.isOfficialApproved).length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐÃ DUYỆT</span>
                    <b style={{ color: "#167461" }}>{projects.filter((p) => p.approvalStatus === "approved" || p.isOfficialApproved).length}</b>
                  </div>
                </div>
              </div>
              <div className="page-top-actions">
                <label className="search-field" style={{ margin: 0, minWidth: "220px", maxWidth: "300px" }}>
                  <span>Tìm dự án</span>
                  <input value={projectSearch} onChange={(event) => { setProjectSearch(event.target.value); setProjectPage(1); }} placeholder="Nhập tên, mã dự án, chủ đầu tư..." />
                </label>
                <button
                  className="secondary-button"
                  style={{ borderColor: "#22c55e", color: "#16a34a", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6, background: "#f0fdf4" }}
                  onClick={() => setView("init_template")}
                >
                  <IconSparkles /> Khởi tạo từ Template
                </button>
                <button className="primary-button" onClick={openCreate}>+ Tạo Master Timeline</button>
              </div>
            </header>
            <section className="project-index">

              {/* Table Filters */}
              {/* Table Filters */}
              <div className="table-filters" style={{ margin: "14px 24px 14px", border: "none" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <label className="table-filters-select">
                    <span>Vùng</span>
                    <select value={projectRegionFilter} onChange={(event) => { setProjectRegionFilter(event.target.value); setProjectPage(1); }}>
                      <option value="all">Tất cả vùng</option>
                      {[...new Set(projects.map((p) => p.region).filter(Boolean) as string[])].sort().map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="table-filters-select">
                    <span>Trạng thái MTL</span>
                    <select value={projectStatusFilter} onChange={(event) => { setProjectStatusFilter(event.target.value as ApprovalStatus | "all"); setProjectPage(1); }}>
                      <option value="all">Tất cả trạng thái</option>
                      <option value="draft">{APPROVAL_LABEL.draft}</option>
                      <option value="gmd_review">{APPROVAL_LABEL.gmd_review}</option>
                      <option value="submitted">{APPROVAL_LABEL.submitted}</option>
                      <option value="appraised">{APPROVAL_LABEL.appraised}</option>
                      <option value="approved">{APPROVAL_LABEL.approved}</option>
                      <option value="changes_requested">{APPROVAL_LABEL.changes_requested}</option>
                    </select>
                  </label>
                </div>
                <span className="table-filters-count">{visibleProjects.length} dự án</span>
              </div>

              {/* Exact 7-column Table (No Loại Dự Án) */}
              {visibleProjects.length > 0 ? (
                <div className="project-table" aria-label="Danh sách dự án Master Timeline">
                  <div className="project-table-head">
                    <span>Mã dự án</span>
                    <span>Tên dự án</span>
                    <span>Chủ đầu tư</span>
                    <span>Khu vực</span>
                    <span>Vùng</span>
                    <span>Trạng thái</span>
                    <span>Hành động</span>
                  </div>
                  <div className="project-table-body">
                    {pagedProjects.map((project) => (
                      <div key={project.id} className="project-table-row" onClick={() => openProject(project)}>
                        <span className="project-code">{project.code}</span>
                        <span className="project-name-cell">
                          <b>{project.name}</b>
                        </span>
                        <span className="project-table-cell-ellipsis" title={project.investor || "Tập đoàn Novaland"}>{project.investor || "Tập đoàn Novaland"}</span>
                        <span className="project-table-cell-ellipsis" title={project.location || project.area || "—"}>{project.location || project.area || "—"}</span>
                        <span className="project-region-cell">{project.region || "Toàn quốc"}</span>
                        <span>
                          <span className={`status-badge approval-${project.approvalStatus}`}>
                            {projectApprovalLabel(project)}{project.approvedVersion ? ` · ${project.approvedVersion}` : ""}
                          </span>
                        </span>
                        <span className="project-action-cell" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="action-btn view-btn" title="Mở Master Timeline" aria-label="Mở dự án" onClick={() => openProject(project)}>
                            <IconEye />
                          </button>
                          <button type="button" className="action-btn delete-btn" title="Xóa dự án" aria-label="Xóa dự án" onClick={() => setProjectToDelete(project)}>
                            <IconTrash />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="project-index-empty">
                  <b>{projectSearch || projectStatusFilter !== "all" || projectRegionFilter !== "all" ? "Không tìm thấy dự án phù hợp" : "Chưa có dự án nào"}</b>
                  <span>{projectSearch || projectStatusFilter !== "all" || projectRegionFilter !== "all" ? "Thử tìm bằng từ khóa khác hoặc thiết lập lại bộ lọc." : "Tạo dự án đầu tiên để hệ thống sinh Master Timeline từ Cấu trúc Master Timeline."}</span>
                  {!projectSearch && projectStatusFilter === "all" && <button className="primary-button" onClick={openCreate}>Tạo Master timeline</button>}
                </div>
              )}
              <Pagination total={visibleProjects.length} pageSize={projectPageSize} page={projectPage} onPageChange={setProjectPage} onPageSizeChange={(size) => { setProjectPageSize(size); setProjectPage(1); }} />
            </section>
          </>
        ) : view === "catalog" ? (
          <>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <h1>Cấu trúc Master Timeline</h1>
              </div>
            </header>

            <section className="catalog-groups">
              {GROUPS.map((group) => {
                const count = fullCatalog.filter((task) => task.groupCode === group.code).length;
                const isSelected = catalogGroupFilter === group.code;
                return (
                  <button
                    type="button"
                    key={group.code}
                    className={`catalog-group-card ${isSelected ? "active" : ""}`}
                    onClick={() => {
                      setCatalogGroupFilter((curr) => (curr === group.code ? "all" : group.code));
                    }}
                  >
                    <div className="catalog-group-card-top">
                      <span>{group.code}</span>
                      <small>{count}</small>
                    </div>
                    <b title={group.name}>{group.short}</b>
                  </button>
                );
              })}
            </section>

            <div
              className="table-filters"
              style={{
                margin: "14px 24px 0",
                borderRadius: "10px 10px 0 0",
                border: "1px solid #e2e8f0",
                borderBottom: 0,
                background: "#fff",
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
                padding: "10px 20px"
              }}
            >
              {/* 1. Tìm */}
              <label className="search-field" style={{ margin: 0, minWidth: "180px", maxWidth: "240px", height: "34px" }}>
                <span>Tìm</span>
                <input
                  value={catalogSearch}
                  onChange={(event) => {
                    setCatalogSearch(event.target.value);
                  }}
                  placeholder="Tìm theo mã WBS hoặc tên..."
                />
              </label>

              {/* 2. Cấp công việc */}
              <label className="table-filters-select" style={{ gap: "6px" }}>
                <span>Cấp công việc</span>
                <select
                  value={catalogLevel}
                  onChange={(event) => applyCatalogLevel(event.target.value === "all" ? "all" : Number(event.target.value))}
                  style={{ height: "34px", minWidth: "115px", fontSize: "12px" }}
                  title="Hiển thị theo cấp công việc"
                >
                  <option value="all">Tất cả cấp</option>
                  <option value="1">Cấp 1</option>
                  <option value="2">Cấp 2</option>
                  <option value="3">Cấp 3</option>
                  <option value="4">Cấp 4</option>
                  <option value="5">Cấp 5</option>
                  {catalogLevel === "custom" && <option value="custom">Tùy biến</option>}
                </select>
              </label>

              {/* 3. Loại công việc */}
              <label className="table-filters-select">
                <span>Loại công việc</span>
                <select
                  value={catalogWorkGroupFilter}
                  onChange={(event) => {
                    setCatalogWorkGroupFilter(event.target.value as "all" | Exclude<WorkType, "">);
                    setCatalogCollapsed(new Set());
                    setCatalogLevel("all");
                  }}
                  style={{ maxWidth: "185px" }}
                >
                  <option value="all">Tất cả loại công việc</option>
                  <option value="Báo cáo định kỳ">Báo cáo định kỳ (gồm công việc cha)</option>
                  <option value="Tracking công việc">Tracking công việc (gồm công việc cha)</option>
                </select>
              </label>

              {/* 4. Nguồn */}
              <label className="table-filters-select">
                <span>Nguồn</span>
                <select
                  value={catalogSourceFilter}
                  onChange={(event) => {
                    setCatalogSourceFilter(event.target.value as "all" | "custom" | "standard");
                  }}
                  style={{ maxWidth: "135px" }}
                >
                  <option value="all">Tất cả nguồn</option>
                  <option value="standard">Mẫu chuẩn</option>
                  <option value="custom">Tùy chỉnh</option>
                </select>
              </label>

              {/* 5. Thêm công việc */}
              <button
                type="button"
                className="primary-button"
                style={{ height: "34px", minHeight: "34px", padding: "0 14px", fontSize: "11.5px", whiteSpace: "nowrap" }}
                onClick={() => openTaskCreator(false)}
              >
                + Thêm công việc
              </button>

              <span className="table-filters-count" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                Hiển thị <strong>{visibleCatalogRows.length}</strong> / {fullCatalog.length} công việc
              </span>
            </div>

            <section className="catalog-table" style={{ marginTop: 0, borderRadius: "0 0 10px 10px" }}>
              <div className="catalog-table-head">
                <span>WBS</span>
                <span>HẠNG MỤC CÔNG VIỆC</span>
                <span>BÁO CÁO GMD</span>
                <span>LOẠI CÔNG VIỆC</span>
                <span>TRẠNG THÁI</span>
              </div>
              {visibleCatalogRows.map((task) => {
                const hasChildren = catalogParentCodes.has(task.code);
                const isCollapsed = catalogCollapsed.has(task.code);
                return (
                  <div
                    className={`catalog-row ${enabledCatalogCodes.has(task.code) ? "auto-enabled" : ""}`}
                    key={`${task.custom ? "custom" : "base"}-${task.code}`}
                  >
                    <span className="catalog-wbs-cell" style={{ paddingLeft: `${(task.level - 1) * 5}px` }}>
                      {hasChildren ? (
                        <button
                          type="button"
                          className="catalog-tree-toggle"
                          aria-expanded={!isCollapsed}
                          aria-label={isCollapsed ? `Mở rộng ${task.code}` : `Thu gọn ${task.code}`}
                          title={isCollapsed ? "Expand" : "Collapse"}
                          onClick={() => {
                            setCatalogLevel("custom");
                            setCatalogCollapsed((current) => {
                              const next = new Set(current);
                              if (isCollapsed) next.delete(task.code);
                              else next.add(task.code);
                              return next;
                            });
                          }}
                        >
                          {isCollapsed ? "+" : "−"}
                        </button>
                      ) : <i className="catalog-tree-spacer" aria-hidden="true" />}
                      <b className="catalog-wbs-code" title={task.code}>{task.code}</b>
                    </span>
                    <span className="catalog-name-cell" title={task.name}>
                      {task.name}
                    </span>
                    <span className="catalog-name-cell" title={task.gmdReport}>
                      {task.gmdReport || "—"}
                    </span>
                    <span>
                      <select
                        className="catalog-work-type-select"
                        value={task.workGroup ?? ""}
                        onChange={(event) => updateCatalogWorkType(task, event.target.value as WorkType)}
                        aria-label={`Loại công việc ${task.code}`}
                      >
                        <option value="">Chưa phân loại</option>
                        <option value="Báo cáo định kỳ">Báo cáo định kỳ</option>
                        <option value="Tracking công việc">Tracking công việc</option>
                      </select>
                    </span>
                    <span>
                      <label className="auto-generate-check">
                        <input
                          type="checkbox"
                          checked={enabledCatalogCodes.has(task.code)}
                          onChange={() => toggleCatalogTask(task)}
                          aria-label={`Trạng thái ${task.code}`}
                        />
                        <i />
                        <b>{enabledCatalogCodes.has(task.code) ? "Có" : "Không"}</b>
                      </label>
                    </span>
                  </div>
                );
              })}
              {!catalogRows.length && (
                <div className="no-results" style={{ padding: "40px 20px", textAlign: "center", color: "#64748b" }}>
                  Không tìm thấy công việc phù hợp với bộ lọc.
                </div>
              )}
            </section>
          </>
        ) : view === "departments" ? (
          <>
            <header className="topbar"><div className="top-actions">{activeProject && <label className="department-project-select"><span>Dự án</span><select value={activeProject.id} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) { setActiveId(project.id); setDepartmentCode(project.selectedGroups[0] ?? GROUPS[0].code); } }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}</div></header>
            {activeProject ? <>
              <section className="department-header"><div><h1>Xác nhận MTL theo phòng ban</h1></div><div className="department-progress"><b>{departmentApprovedCount}/{activeProject.selectedGroups.length}</b><span>ĐẦU MỤC ĐÃ XÁC NHẬN</span><i><em style={{ width: `${(departmentApprovedCount / Math.max(activeProject.selectedGroups.length, 1)) * 100}%` }} /></i></div></section>
              <section className="department-review-layout">
                <aside className="department-groups" aria-label="Đầu mục phòng ban">
                  <header><span>PHÒNG BAN</span><b>{departmentPendingCount} chờ xác nhận</b></header>
                  <div className="department-group-section"><strong>KHỐI PHÒNG BAN · 9.x</strong>{GROUPS.filter((group) => group.code.startsWith("9.") && activeProject.selectedGroups.includes(group.code)).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} className={`${departmentCode === group.code ? "active" : ""} status-${approval?.status ?? "pending"}`} onClick={() => setDepartmentCode(group.code)}><i>{approval?.status === "approved" ? "✓" : approval?.status === "changes_requested" ? "!" : "·"}</i><span><b>{group.code} · {group.short}</b><small>{group.name}</small>{approval?.reviewer && <em>{approval.reviewer}</em>}</span></button>; })}</div>
                  <div className="department-group-section"><strong>PHÒNG TRỰC TIẾP · 4.x</strong>{PBCM_GROUPS.filter((group) => group.code.startsWith("4.") && activeProject.selectedGroups.includes(group.code)).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} className={`${departmentCode === group.code ? "active" : ""} status-${approval?.status ?? "pending"}`} onClick={() => setDepartmentCode(group.code)}><i>{approval?.status === "approved" ? "✓" : approval?.status === "changes_requested" ? "!" : "·"}</i><span><b>{group.code} · {group.short}</b><small>{group.name}</small>{approval?.reviewer && <em>{approval.reviewer}</em>}</span></button>; })}</div>
                </aside>
                <section className="department-review-main">
                  {departmentApproval ? <>
                    <header className="department-review-title"><div><span className={`department-status status-${departmentApproval.status}`}>{DEPARTMENT_APPROVAL_LABEL[departmentApproval.status]}</span><h2>{selectedDepartment.code} · {selectedDepartment.name}</h2><p>Xác nhận đầu mục cấp cao nhất sẽ áp dụng cho toàn bộ {departmentTasks.length} công việc bên dưới.</p></div><label className="field"><span>Người phụ trách xác nhận</span><input disabled={!isPlanEditable(activeProject)} value={departmentApproval.reviewer} onChange={(event) => updateDepartmentApproval(departmentCode, { reviewer: event.target.value, status: "pending", reviewedAt: undefined })} placeholder="Nhập họ tên người xác nhận" /></label></header>
                    <div className="department-task-table"><div className="department-task-head"><span>WBS / CÔNG VIỆC</span><span>PIC</span><span>BẮT ĐẦU</span><span>KẾT THÚC</span><span>TRẠNG THÁI</span></div><div className="department-task-body">{departmentTasks.map((task) => <div className={`department-task-row ${task.summary ? "summary" : ""}`} key={task.code}><span style={{ paddingLeft: `${12 + (task.level - 1) * 14}px` }}><b>{task.code}</b><small>{task.name}</small></span><span>{task.pic || "Chưa gán"}</span><span>{formatDate(task.startDate)}</span><span>{formatDate(task.endDate)}</span><span><i className={`task-status status-${taskStatusClass(task.status)}`}>{task.status}</i></span></div>)}</div></div>
                    <footer className="department-opinion"><label className="field"><span>Ý kiến xác nhận <i>Người lập MTL sẽ đọc được phản hồi này</i></span><textarea disabled={!isPlanEditable(activeProject)} value={departmentApproval.note} onChange={(event) => updateDepartmentApproval(departmentCode, { note: event.target.value, status: departmentApproval.status === "approved" ? "pending" : departmentApproval.status, reviewedAt: departmentApproval.status === "approved" ? undefined : departmentApproval.reviewedAt })} placeholder={`Nêu rõ nội dung cần điều chỉnh trong đầu mục ${departmentCode}…`} rows={3} /></label><div>{departmentApproval.reviewedAt && <span>Xác nhận gần nhất: {formatDateTime(departmentApproval.reviewedAt)}</span>}<button className="danger-button" disabled={!isPlanEditable(activeProject)} onClick={() => reviewDepartment("changes_requested")}>Yêu cầu điều chỉnh</button><button className="approve-button" disabled={!isPlanEditable(activeProject)} onClick={() => reviewDepartment("approved")}>Xác nhận toàn bộ {departmentCode}</button></div></footer>
                  </> : <div className="gms-select-prompt"><h2>Đầu mục không thuộc dự án</h2><p>Hãy chọn một phòng ban đang tham gia dự án này.</p></div>}
                </section>
              </section>
            </> : <div className="empty-state"><span className="empty-kicker">XÁC NHẬN PHÒNG BAN</span><h1>Chưa có dự án để xác nhận</h1><p>Tạo dự án MTL trước, sau đó phân công người xác nhận cho từng đầu mục phòng ban.</p><button className="primary-button" onClick={openCreate}>Tạo Master timeline</button></div>}
          </>
        ) : view === "gmd" ? (
          <>
            <section className="gms-header"><div><h1>Ban điều hành dự án kiểm soát MTL</h1></div><div className="gms-metrics"><div><b>{pendingGmdCount}</b><span>CHỜ KIỂM SOÁT</span></div><div><b>{projects.filter((project) => project.approvalStatus === "gmd_returned").length}</b><span>ĐÃ TRẢ VỀ</span></div><div><b>{projects.filter((project) => Boolean(project.gmdReviewedAt) && project.approvalStatus !== "gmd_returned").length}</b><span>ĐÃ CHO ĐI THẨM ĐỊNH</span></div></div></section>

            <section className="gms-queue">
              <div className="gms-directory-toolbar">
                <div className="gms-function-tabs"><button className={gmdFilter === "pending" ? "active" : ""} onClick={() => setGmdFilter("pending")}>Chờ kiểm soát <b>{pendingGmdCount}</b></button><button className={gmdFilter === "history" ? "active" : ""} onClick={() => setGmdFilter("history")}>Đã xử lý</button></div>
                <label className="search-field gms-search"><span>Tìm dự án</span><input value={gmdSearch} onChange={(event) => setGmdSearch(event.target.value)} placeholder="Tên hoặc mã dự án" /></label>
              </div>

              <div className="gms-directory-layout">
                <section className="gms-directory-list" aria-label="Danh sách hồ sơ chờ GMD">
                  <div className="gms-queue-heading"><div><span>{gmdFilter === "pending" ? "HỒ SƠ ĐANG CHỜ" : "HỒ SƠ ĐÃ XỬ LÝ"}</span><h2>{visibleGmdProjects.length} dự án</h2></div></div>
                  <div className="gms-list">
                    {visibleGmdProjects.map((project) => <button className={`gms-card status-${project.approvalStatus} ${gmdSelectedId === project.id ? "selected" : ""}`} key={project.id} onClick={() => selectGmdProject(project)}>
                      <div className="gms-project-mark">{project.code.slice(0, 2)}</div>
                      <div className="gms-project-info"><span className={`gms-status ${project.approvalStatus}`}>{APPROVAL_LABEL[project.approvalStatus]}</span><h3>{project.name}</h3><p>{project.code} · {projectTaskCount(project)} task</p><small>{project.gmdSubmittedAt ? `Trình lúc ${formatDateTime(project.gmdSubmittedAt)}` : "Chưa ghi nhận thời điểm trình"}</small></div>
                      <span className="gms-open-label">Mở hồ sơ</span>
                    </button>)}
                    {!visibleGmdProjects.length && <div className="gms-empty"><b>{gmdSearch ? "Không tìm thấy dự án phù hợp" : gmdFilter === "pending" ? "Chưa có MTL nào chờ kiểm soát" : "Chưa có hồ sơ đã xử lý"}</b><span>{gmdSearch ? "Thử tìm theo mã hoặc tên dự án." : gmdFilter === "pending" ? "Khi người lập trình MTL lên, hồ sơ sẽ xuất hiện tại đây." : "Các hồ sơ GMD đã cho ý kiến sẽ được lưu tại đây."}</span></div>}
                  </div>
                </section>

                <section className="gms-review-pane" aria-label="Chi tiết kiểm soát">
                  {gmdSelectedProject ? <>
                    <header className="gms-review-header"><div><span className={`gms-status ${gmdSelectedProject.approvalStatus}`}>{APPROVAL_LABEL[gmdSelectedProject.approvalStatus]}</span><h2>{gmdSelectedProject.name}</h2><p>{gmdSelectedProject.code} · {gmdSelectedTasks.filter((task) => !task.summary).length} công việc · Mục tiêu {formatDate(gmdSelectedProject.targetDate)}</p></div><div className="gms-review-sender"><small>TRÌNH LÚC</small><b>{gmdSelectedProject.gmdSubmittedAt ? formatDateTime(gmdSelectedProject.gmdSubmittedAt) : "—"}</b><span>{gmdSelectedProject.selectedGroups.length} đầu mục phòng ban</span></div></header>

                    <div className="gmd-body">
                      <section className="gmd-panel">
                        <header className="gmd-panel-head"><h3>Cảnh báo tự động</h3>{gmdBlockingCount > 0 ? <span className="gmd-verdict blocked">{gmdBlockingCount} vấn đề cần xem xét</span> : <span className="gmd-verdict clear">Không có vấn đề chặn</span>}</header>
                        <ul className="gmd-checks">
                          {gmdChecks.map((check) => <li key={check.key} className={check.count > 0 ? (check.blocking ? "hit blocking" : "hit") : "pass"}>
                            <span className="gmd-check-mark" aria-hidden="true">{check.count > 0 ? (check.blocking ? "!" : "•") : "✓"}</span>
                            <span className="gmd-check-body"><b>{check.label}</b><small>{check.detail}</small></span>
                            <span className="gmd-check-count">{check.count > 0 ? `${check.count}${check.unit ? ` ${check.unit}` : ""}` : "0"}</span>
                          </li>)}
                        </ul>
                      </section>

                      <section className="gmd-panel">
                        <header className="gmd-panel-head"><h3>Xác nhận của phòng ban</h3><span className="gmd-verdict clear">{approvedDepartmentCount(gmdSelectedProject)}/{pbcmGroupsOf(gmdSelectedProject).length} đã xác nhận</span></header>
                        <p className="gmd-panel-note">Đây là bằng chứng thay cho biên bản họp thống nhất ở bước 5. Khi trả hồ sơ về, tích chọn đầu mục cần xác nhận lại.</p>
                        <div className="gmd-dept-table">
                          <div className="gmd-dept-head"><span>Chọn</span><span>Đầu mục</span><span>Người xác nhận</span><span>Thời điểm</span><span>Ý kiến</span></div>
                          <div className="gmd-dept-body">
                            {PBCM_GROUPS.filter((group) => gmdSelectedProject.selectedGroups.includes(group.code)).map((group) => {
                              const approval = gmdSelectedProject.departmentApprovals[group.code];
                              const status = approval?.status ?? "pending";
                              const canEdit = gmdSelectedProject.approvalStatus === "gmd_review";
                              return <label className={`gmd-dept-row status-${status}`} key={group.code}>
                                <span><input type="checkbox" disabled={!canEdit} checked={gmdReturnGroups.has(group.code)} onChange={() => setGmdReturnGroups((current) => { const next = new Set(current); if (next.has(group.code)) next.delete(group.code); else next.add(group.code); return next; })} aria-label={`Yêu cầu ${group.short} xác nhận lại`} /></span>
                                <span className="gmd-dept-name"><b>{group.code} · {group.short}</b><small>{group.name}</small></span>
                                <span>{approval?.reviewer || <i className="gmd-muted">Chưa gán</i>}</span>
                                <span>{approval?.reviewedAt ? formatDateTime(approval.reviewedAt) : <i className="gmd-muted">—</i>}</span>
                                <span className="gmd-dept-note" title={approval?.note || ""}>{approval?.note || <i className="gmd-muted">Không có ý kiến</i>}</span>
                              </label>;
                            })}
                          </div>
                        </div>
                      </section>
                    </div>

                    {gmdSelectedProject.approvalStatus === "gmd_review" ? (
                      <footer className="gmd-decision">
                        <div className="gmd-decision-fields">
                          <label className="field"><span>Người kiểm soát</span><input value={gmdReviewer} onChange={(event) => setGmdReviewer(event.target.value)} placeholder="Họ tên đại diện GMD" /></label>
                          <label className="field"><span>Ý kiến kiểm soát <i>Bắt buộc khi trả hồ sơ về</i></span><textarea value={gmdNote} onChange={(event) => setGmdNote(event.target.value)} rows={3} placeholder="Nêu rõ nội dung cần điều chỉnh hoặc điều kiện để MTL đi thẩm định…" /></label>
                        </div>
                        <div className="gmd-decision-actions">
                          {gmdReturnGroups.size > 0 && <span className="gmd-return-hint">{gmdReturnGroups.size} đầu mục sẽ phải xác nhận lại</span>}
                          <button type="button" className="danger-button" onClick={() => reviewByGmd("return")}>Trả về người lập</button>
                          <button type="button" className="approve-button" onClick={() => reviewByGmd("pass")}>Đồng ý · chuyển GMS thẩm định</button>
                        </div>
                      </footer>
                    ) : (
                      <footer className="gmd-decision is-readonly">
                        <div className="gms-review-result">
                          <b>{gmdSelectedProject.approvalStatus === "gmd_returned" ? "GMD đã trả hồ sơ về người lập" : "GMD đã cho hồ sơ đi thẩm định"}</b>
                          <span>{gmdSelectedProject.gmdNote || "Không có ý kiến kèm theo"}</span>
                          <span>{gmdSelectedProject.gmdReviewer || "Chưa ghi nhận người kiểm soát"} · {gmdSelectedProject.gmdReviewedAt ? formatDateTime(gmdSelectedProject.gmdReviewedAt) : "—"}</span>
                        </div>
                      </footer>
                    )}
                  </> : <div className="gms-select-prompt"><span>GMD</span><h2>Chọn một dự án để kiểm soát</h2><p>Chọn hồ sơ bên trái để xem cảnh báo tự động, xác nhận của từng phòng ban và cho ý kiến.</p></div>}
                </section>
              </div>
            </section>
          </>
        ) : view === "gms" ? (
          <>
            <section className="gms-header"><div><h1>Danh mục dự án MTL cần thẩm định</h1></div><div className="gms-metrics"><div><b>{pendingGmsCount}</b><span>CHỜ THẨM ĐỊNH</span></div><div><b>{projects.filter((project) => project.approvalStatus === "approved").length}</b><span>ĐÃ XÁC NHẬN</span></div><div><b>{projects.filter((project) => project.approvalStatus === "changes_requested").length}</b><span>YÊU CẦU ĐIỀU CHỈNH</span></div></div></section>
            <section className="gms-queue">
              <div className="gms-directory-toolbar">
                <div className="gms-function-tabs"><button className={gmsFilter === "pending" ? "active" : ""} onClick={() => setGmsFilter("pending")}>Cần phê duyệt <b>{pendingGmsCount}</b></button><button className={gmsFilter === "history" ? "active" : ""} onClick={() => setGmsFilter("history")}>Lịch sử thẩm định</button></div>
                <label className="search-field gms-search"><span>Tìm dự án</span><input value={gmsSearch} onChange={(event) => setGmsSearch(event.target.value)} placeholder="Tên, mã dự án hoặc người gửi" /></label>
              </div>
              <div className="gms-directory-layout">
                <section className="gms-directory-list" aria-label="Danh sách hồ sơ GMS">
                  <div className="gms-queue-heading"><div><span>{gmsFilter === "pending" ? "HỒ SƠ ĐANG CHỜ" : "HỒ SƠ ĐÃ XỬ LÝ"}</span><h2>{visibleGmsProjects.length} dự án</h2></div></div>
                  <div className="gms-list">
                    {visibleGmsProjects.map((project) => <button className={`gms-card status-${project.approvalStatus} ${gmsSelectedId === project.id ? "selected" : ""}`} key={project.id} onClick={() => selectGmsProject(project)}>
                      <div className="gms-project-mark">{project.code.slice(0, 2)}</div>
                      <div className="gms-project-info"><span className={`gms-status ${project.approvalStatus}`}>{APPROVAL_LABEL[project.approvalStatus]}{project.approvedVersion ? ` · ${project.approvedVersion}` : ""}</span><h3>{project.name}</h3><p>{project.code} · {projectTaskCount(project)} task</p><small>Gửi bởi {project.submittedBy ?? "Project Manager"} · {formatDateTime(project.submittedAt)}</small></div>
                      <span className="gms-open-label">Mở hồ sơ</span>
                    </button>)}
                    {!visibleGmsProjects.length && <div className="gms-empty"><b>{gmsSearch ? "Không tìm thấy dự án phù hợp" : gmsFilter === "pending" ? "Chưa có dự án MTL cần phê duyệt" : "Chưa có lịch sử thẩm định"}</b><span>{gmsSearch ? "Thử tìm theo mã dự án, tên dự án hoặc người gửi." : gmsFilter === "pending" ? "Khi Project Manager gửi thẩm định, dự án sẽ xuất hiện tại đây." : "Các dự án đã xử lý sẽ được lưu tại đây."}</span></div>}
                  </div>
                </section>
                <section className="gms-review-pane" aria-label="Chi tiết thẩm định">
                  {gmsSelectedProject ? <>
                    <header className="gms-review-header"><div><span className={`gms-status ${gmsSelectedProject.approvalStatus}`}>{APPROVAL_LABEL[gmsSelectedProject.approvalStatus]}</span><h2>{gmsSelectedProject.name}</h2><p>{gmsSelectedProject.code} · {gmsSelectedTasks.length} công việc · Mục tiêu {formatDate(gmsSelectedProject.targetDate)}</p></div><div className="gms-review-sender"><small>NGƯỜI GỬI</small><b>{gmsSelectedProject.submittedBy ?? "Project Manager"}</b><span>{formatDateTime(gmsSelectedProject.submittedAt)}</span></div></header>
                    <div className="gms-task-table"><div className="gms-task-head"><span>WBS / CÔNG VIỆC</span><span>ĐƠN VỊ</span><span>BẮT ĐẦU</span><span>KẾT THÚC</span><span>THỜI LƯỢNG</span><span>TRẠNG THÁI</span></div><div className="gms-task-body">{gmsSelectedTasks.map((task) => <div className={`gms-task-row ${task.summary ? "summary" : ""}`} key={task.code}><span style={{ paddingLeft: `${12 + (task.level - 1) * 14}px` }}><b>{task.code}</b><small>{task.name}</small></span><span>{GROUP_BY_CODE[task.groupCode]?.short}</span><span>{formatDate(task.startDate)}</span><span>{formatDate(task.endDate)}</span><span>{task.duration} ngày</span><span><i className={`task-status status-${taskStatusClass(task.status)}`}>{task.status}</i></span></div>)}</div></div>
                    <div className={`gms-opinion-box ${gmsSelectedProject.approvalStatus !== "submitted" ? "is-readonly" : ""}`}><label className="field"><span>Ý kiến thẩm định {gmsSelectedProject.approvalStatus === "submitted" && <i>Phản hồi này sẽ được gửi về người lập MTL</i>}</span><textarea disabled={gmsSelectedProject.approvalStatus !== "submitted"} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Nêu rõ công việc/WBS cần sửa, nội dung cần bổ sung hoặc điều kiện phê duyệt…" rows={4} /></label>{gmsSelectedProject.approvalStatus === "submitted" ? <div className="gms-review-actions"><button className="danger-button" onClick={() => reviewProject("changes_requested")}>Trả về để điều chỉnh</button><button className="approve-button" onClick={() => reviewProject("appraised")}>Xác nhận đã thẩm định</button></div> : <div className="gms-review-result"><b>Đã phản hồi cho người lập</b><span>{formatDateTime(gmsSelectedProject.reviewedAt)} · {gmsSelectedProject.reviewNote || "Không có ý kiến bổ sung."}</span></div>}</div>
                    {gmsSelectedProject.approvalStatus === "submitted" && <div className="gms-return-picker">
                      <b>Đầu mục cần xác nhận lại <i>chỉ áp dụng khi trả về để điều chỉnh</i></b>
                      <div>{PBCM_GROUPS.filter((group) => gmsSelectedProject.selectedGroups.includes(group.code)).map((group) => <label key={group.code} className={gmsReturnGroups.has(group.code) ? "checked" : ""}>
                        <input type="checkbox" checked={gmsReturnGroups.has(group.code)} onChange={() => setGmsReturnGroups((current) => { const next = new Set(current); if (next.has(group.code)) next.delete(group.code); else next.add(group.code); return next; })} />
                        <span>{group.code} · {group.short}</span>
                      </label>)}</div>
                    </div>}
                  </> : <div className="gms-select-prompt"><span>GMS</span><h2>Chọn một dự án để thẩm định</h2><p>Tìm dự án ở phía trên, sau đó chọn hồ sơ bên trái để xem danh sách công việc và nhập ý kiến phản hồi.</p></div>}
                </section>
              </div>
            </section>
          </>
        ) : view === "confirm_approval" ? (
          <>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <h1>Xác nhận phê duyệt</h1>
                <div className="top-stat-cards">
                  <div className="top-stat-card">
                    <span>TỔNG DỰ ÁN</span>
                    <b>{projects.length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>CHỜ XÁC NHẬN E-APPROVAL</span>
                    <b style={{ color: "#d97706" }}>{projects.filter((p) => !p.isOfficialApproved).length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐÃ PHÊ DUYỆT CHÍNH THỨC</span>
                    <b style={{ color: "#167461" }}>{officialApprovedProjects.length}</b>
                  </div>
                </div>
              </div>
              <div className="page-top-actions">
                <label className="search-field" style={{ margin: 0, minWidth: "220px", maxWidth: "300px" }}>
                  <span>Tìm dự án</span>
                  <input value={confirmSearch} onChange={(event) => { setConfirmSearch(event.target.value); setConfirmPage(1); }} placeholder="Tên, mã dự án hoặc mã E-Approval..." />
                </label>
                <button type="button" className="primary-button" onClick={() => openEApprovalModal()}>
                  + Nhập phê duyệt E-Approval
                </button>
              </div>
            </header>
            <section className="project-index">

              {/* Filter Tabs */}
              <div className="table-filters" style={{ margin: "14px 24px 14px", border: "none" }}>
                <div className="gms-function-tabs" style={{ margin: 0 }}>
                  <button className={confirmFilter === "all" ? "active" : ""} onClick={() => { setConfirmFilter("all"); setConfirmPage(1); }}>
                    Tất cả dự án <b>{projects.length}</b>
                  </button>
                  <button className={confirmFilter === "pending" ? "active" : ""} onClick={() => { setConfirmFilter("pending"); setConfirmPage(1); }}>
                    Chưa xác nhận <b>{projects.filter((p) => !p.isOfficialApproved).length}</b>
                  </button>
                  <button className={confirmFilter === "approved" ? "active" : ""} onClick={() => { setConfirmFilter("approved"); setConfirmPage(1); }}>
                    Đã phê duyệt <b>{officialApprovedProjects.length}</b>
                  </button>
                </div>
                <span className="table-filters-count">{visibleConfirmProjects.length} dự án</span>
              </div>

              {visibleConfirmProjects.length > 0 ? (
                <div className="project-table confirm-approval-table" aria-label="Danh sách xác nhận phê duyệt MTL">
                  <div className="project-table-head">
                    <span>Mã dự án</span>
                    <span>Tên dự án</span>
                    <span>Vùng</span>
                    <span>Trạng thái</span>
                    <span>Mã E-Approval</span>
                    <span>Ngày duyệt</span>
                    <span>Hành động</span>
                  </div>
                  <div className="project-table-body">
                    {pagedConfirmProjects.map((project) => (
                      <div key={project.id} className="project-table-row">
                        <span className="project-code">{project.code}</span>
                        <span className="project-name-cell">
                          <b>{project.name}</b>
                        </span>
                        <span className="project-region-cell">{project.region || project.area || "—"}</span>
                        <span>
                          {project.isOfficialApproved ? (
                            <span className="status-badge" style={{ background: "#edf8f5", color: "#167461", border: "1px solid #a4dfd1" }}>
                              ✓ ĐÃ DUYỆT {project.officialVersion || "v1.0"}
                            </span>
                          ) : (
                            <span className="status-badge" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>
                              CHỜ E-APPROVAL
                            </span>
                          )}
                        </span>
                        <span>
                          {project.eApprovalUrl ? (
                            <a href={project.eApprovalUrl} target="_blank" rel="noreferrer" className="eapp-link-badge" title="Mở trên E-Approval">
                              <span>{project.eApprovalCode || "E-Approval"}</span>
                              <IconExternalLink />
                            </a>
                          ) : (
                            <span style={{ color: "#94a3b8", fontSize: "12px" }}>{project.eApprovalCode || "Chưa nhập"}</span>
                          )}
                        </span>
                        <span>{project.eApprovalDate ? formatDate(project.eApprovalDate) : <span style={{ color: "#94a3b8" }}>—</span>}</span>
                        <span className="project-action-cell" onClick={(event) => event.stopPropagation()}>
                          {!project.isOfficialApproved ? (
                            <button
                              type="button"
                              className="primary-button"
                              style={{ height: "30px", fontSize: "11.5px", padding: "0 12px", background: "#73b52d", borderColor: "#64a024" }}
                              onClick={() => openEApprovalModal(project)}
                            >
                              ✓ Xác nhận
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ height: "30px", fontSize: "11.5px", padding: "0 10px" }}
                              title="Sửa thông tin E-Approval"
                              onClick={() => openEApprovalModal(project)}
                            >
                              Sửa
                            </button>
                          )}
                          <button
                            type="button"
                            className="action-btn view-btn"
                            title="Xem chi tiết dự án"
                            onClick={() => { setActiveId(project.id); setView("workspace"); }}
                          >
                            <IconEye />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="project-index-empty">
                  <b>Không tìm thấy dự án phù hợp</b>
                  <span>Thử tìm bằng tên/mã khác hoặc bấm nút bên dưới để nhập phê duyệt E-Approval.</span>
                  <button className="primary-button" onClick={() => openEApprovalModal()}>+ Nhập phê duyệt E-Approval</button>
                </div>
              )}
              <Pagination total={visibleConfirmProjects.length} pageSize={confirmPageSize} page={confirmPage} onPageChange={setConfirmPage} onPageSizeChange={(size) => { setConfirmPageSize(size); setConfirmPage(1); }} />
            </section>
          </>
        ) : view === "approved_projects" ? (
          <>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <h1>Master Timeline đã duyệt</h1>
              </div>
              <div className="page-top-actions">
                <label className="search-field" style={{ margin: 0, minWidth: "220px", maxWidth: "300px" }}>
                  <span>Tìm dự án</span>
                  <input value={approvedSearch} onChange={(event) => { setApprovedSearch(event.target.value); setApprovedPage(1); }} placeholder="Tên, mã dự án hoặc mã E-Approval" />
                </label>
                <button type="button" className="primary-button" onClick={() => openEApprovalModal()}>
                  + Xác nhận phê duyệt MTL
                </button>
              </div>
            </header>
            <section className="project-index">

              <div className="approved-summary-strip" style={{ margin: "0 24px 14px" }}>
                <div className="approved-metric-card">
                  <span>DỰ ÁN ĐÃ DUYỆT</span>
                  <b>{officialApprovedProjects.length}</b>
                </div>
                <div className="approved-metric-card">
                  <span>TỔNG VIỆC BASELINE</span>
                  <b>{formatCount(approvedTotalTasks)}</b>
                </div>
                <div className="approved-metric-card">
                  <span>TIẾN ĐỘ THỰC HIỆN TB</span>
                  <b style={{ color: "#168c72" }}>{approvedAverageProgress}%</b>
                </div>
                <div className="approved-metric-card">
                  <span>VIỆC HOÀN THÀNH</span>
                  <b style={{ color: "#2ea44f" }}>{formatCount(approvedDoneTasks)}</b>
                </div>
                <div className="approved-metric-card">
                  <span>VIỆC TRỄ HẠN</span>
                  <b style={{ color: approvedLateTasks > 0 ? "#d92b2b" : "#627d98" }}>{formatCount(approvedLateTasks)}</b>
                </div>
              </div>

              <div className="table-filters">
                <label className="table-filters-select">
                  <span>Vùng</span>
                  <select value={approvedRegionFilter} onChange={(event) => { setApprovedRegionFilter(event.target.value); setApprovedPage(1); }}>
                    <option value="all">Tất cả vùng</option>
                    {overviewRegions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                <span className="table-filters-count">{visibleApprovedProjects.length} dự án</span>
              </div>

              {visibleApprovedProjects.length > 0 ? (
                <div className="project-table approved-project-table" aria-label="Các dự án MTL đã duyệt">
                  <div className="project-table-head" style={{ gridTemplateColumns: "90px 100px minmax(170px, 1.4fr) 140px 80px 100px 130px 110px 150px" }}>
                    <span>Vùng</span>
                    <span>Mã DA</span>
                    <span>Tên dự án</span>
                    <span>Mã E-Approval</span>
                    <span>Bản</span>
                    <span>Ngày duyệt</span>
                    <span>Tiến độ thực tế</span>
                    <span>Trạng thái</span>
                    <span>Hành động</span>
                  </div>
                  <div className="project-table-body">
                    {pagedApprovedProjects.map((project) => {
                      const tasks = scheduleTasks(project);
                      const nonSummary = tasks.filter((t) => !t.summary);
                      const progress = nonSummary.length ? Math.round(nonSummary.reduce((s, t) => s + t.actualProgress, 0) / nonSummary.length) : 0;
                      const lateCount = nonSummary.filter((t) => t.actualStatus === "Trễ hạn").length;
                      return (
                        <div key={project.id} className="project-table-row" style={{ gridTemplateColumns: "90px 100px minmax(170px, 1.4fr) 140px 80px 100px 130px 110px 150px" }} onClick={() => openProject(project)}>
                          <span className="project-region-cell">{project.region || project.area || "—"}</span>
                          <span className="project-code">{project.code}</span>
                          <span className="project-name-cell"><b>{project.name}</b><small>{project.type}</small></span>
                          <span onClick={(e) => e.stopPropagation()}>
                            {project.eApprovalUrl ? (
                              <a href={project.eApprovalUrl} target="_blank" rel="noreferrer" className="eapp-link-badge" title="Mở trên E-Approval">
                                <span>{project.eApprovalCode || "E-Approval"}</span>
                                <IconExternalLink />
                              </a>
                            ) : (
                              <span style={{ fontWeight: 700, color: "#168c72", fontSize: "11px" }}>{project.eApprovalCode || "Đã duyệt"}</span>
                            )}
                          </span>
                          <span><b>{project.officialVersion || "v1.0"}</b></span>
                          <span>{formatDate(project.eApprovalDate || project.approvedAt)}</span>
                          <span className="progress-cell">
                            <div className="progress-cell-header">
                              <span className="percent">{progress}%</span>
                              {lateCount > 0 && <span style={{ color: "#d92b2b", fontSize: "9px" }}>{lateCount} trễ</span>}
                            </div>
                            <div className="progress-bar-track">
                              <div className={`progress-bar-fill ${progress === 100 ? "done" : (lateCount > 0 ? "late" : "running")}`} style={{ width: `${progress}%` }} />
                            </div>
                          </span>
                          <span>
                            <i className={`actual-status-badge ${progress === 100 ? "status-done" : (lateCount > 0 ? "status-late" : "status-running")}`}>
                              {progress === 100 ? "Hoàn thành" : (lateCount > 0 ? "Có trễ hạn" : "Đang chạy")}
                            </i>
                          </span>
                          <span className="project-action-cell" style={{ gap: "4px" }}>
                            <button type="button" className="action-btn view-btn" title="Theo dõi và cập nhật tiến độ" aria-label="Theo dõi tiến độ" onClick={(event) => { event.stopPropagation(); openProject(project); }}>
                              <IconEye />
                            </button>
                            <button type="button" className="action-btn" title="Xuất MS Project XML" aria-label="Xuất XML" onClick={(event) => { event.stopPropagation(); setActiveId(project.id); exportMicrosoftProject(); }}>
                              <IconDownload />
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="project-index-empty">
                  <b>Chưa có dự án nào trong danh mục MTL đã phê duyệt</b>
                  <span>Nhập Mã hồ sơ và Link phê duyệt E-Approval để xác nhận Master Timeline chính thức.</span>
                  <button className="primary-button" onClick={() => openEApprovalModal()}>+ Xác nhận phê duyệt MTL</button>
                </div>
              )}
              <Pagination total={visibleApprovedProjects.length} pageSize={approvedPageSize} page={approvedPage} onPageChange={setApprovedPage} onPageSizeChange={(size) => { setApprovedPageSize(size); setApprovedPage(1); }} />
            </section>
          </>
        ) : view === "design_task" ? (
          <>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <h1>Nhiệm vụ thiết kế</h1>
                <div className="top-stat-cards">
                  <div className="top-stat-card">
                    <span>TỔNG DỰ ÁN</span>
                    <b>{projects.length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>CHƯA LẬP</span>
                    <b style={{ color: "#64748b" }}>{projects.filter((p) => p.designTaskStatus === "chua_lap").length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐANG LẬP</span>
                    <b style={{ color: "#1a56a8" }}>{projects.filter((p) => p.designTaskStatus === "dang_lap").length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>PBCM GÓP Ý</span>
                    <b style={{ color: "#d97706" }}>{projects.filter((p) => p.designTaskStatus === "pbcm_gop_y").length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐÃ DUYỆT</span>
                    <b style={{ color: "#167461" }}>{projects.filter((p) => p.designTaskStatus === "da_duyet").length}</b>
                  </div>
                </div>
              </div>
              <div className="page-top-actions">
                <label className="search-field" style={{ margin: 0, minWidth: "200px", maxWidth: "260px" }}>
                  <span>Tìm dự án</span>
                  <input value={designSearch} onChange={(event) => { setDesignSearch(event.target.value); setDesignPage(1); }} placeholder="Nhập tên, mã dự án..." />
                </label>
                <button type="button" className="secondary-button" onClick={() => setView("projects")}>← Quay lại MTL</button>
                <button type="button" className="primary-button">+ Tạo NVTK</button>
              </div>
            </header>
            <section className="project-index">

              {/* Filters */}
              <div className="table-filters" style={{ margin: "14px 24px 14px", border: "none" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <label className="table-filters-select">
                    <span>Vùng</span>
                    <select value={designRegionFilter} onChange={(event) => { setDesignRegionFilter(event.target.value); setDesignPage(1); }}>
                      <option value="all">Tất cả vùng</option>
                      {[...new Set(projects.map((p) => p.region).filter(Boolean) as string[])].sort().map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="table-filters-select">
                    <span>Trạng thái NVTK</span>
                    <select value={designStatusFilter} onChange={(event) => { setDesignStatusFilter(event.target.value); setDesignPage(1); }}>
                      <option value="all">Tất cả trạng thái NVTK</option>
                      <option value="chua_lap">Chưa lập NVTK</option>
                      <option value="dang_lap">Đang lập NVTK</option>
                      <option value="pbcm_gop_y">PBCM góp ý</option>
                      <option value="da_duyet">Đã phê duyệt NVTK</option>
                    </select>
                  </label>
                </div>
                <span className="table-filters-count">{visibleDesignProjects.length} dự án</span>
              </div>

              {/* Exact 7-column Table (No Loại Dự Án) */}
              {visibleDesignProjects.length > 0 ? (
                <div className="project-table" aria-label="Danh sách dự án Lập Nhiệm Vụ Thiết Kế">
                  <div className="project-table-head">
                    <span>Mã dự án</span>
                    <span>Tên dự án</span>
                    <span>Chủ đầu tư</span>
                    <span>Khu vực</span>
                    <span>Vùng</span>
                    <span>Trạng thái</span>
                    <span>Hành động</span>
                  </div>
                  <div className="project-table-body">
                    {pagedDesignProjects.map((project) => (
                      <div key={project.id} className="project-table-row" onClick={() => { setActiveId(project.id); setView("workspace"); }}>
                        <span className="project-code">{project.code}</span>
                        <span className="project-name-cell">
                          <b>{project.name}</b>
                        </span>
                        <span className="project-table-cell-ellipsis" title={project.investor || "Tập đoàn Novaland"}>{project.investor || "Tập đoàn Novaland"}</span>
                        <span className="project-table-cell-ellipsis" title={project.location || project.area || "—"}>{project.location || project.area || "—"}</span>
                        <span className="project-region-cell">{project.region || "Toàn quốc"}</span>
                        <span>
                          {project.designTaskStatus === "da_duyet" ? (
                            <span className="status-badge" style={{ background: "#edf8f5", color: "#167461", border: "1px solid #a4dfd1" }}>✓ ĐÃ DUYỆT NVTK</span>
                          ) : project.designTaskStatus === "pbcm_gop_y" ? (
                            <span className="status-badge" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>PBCM GÓP Ý</span>
                          ) : project.designTaskStatus === "dang_lap" ? (
                            <span className="status-badge" style={{ background: "#eef4fb", color: "#1a56a8", border: "1px solid #bfdbfe" }}>ĐANG LẬP NVTK</span>
                          ) : (
                            <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>CHƯA LẬP NVTK</span>
                          )}
                        </span>
                        <span className="project-action-cell" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="action-btn view-btn" title="Xem chi tiết NVTK" aria-label="Chi tiết NVTK" onClick={() => { setActiveId(project.id); setView("workspace"); }}>
                            <IconEye />
                          </button>
                          <button type="button" className="action-btn delete-btn" title="Xóa dự án" aria-label="Xóa dự án" onClick={() => setProjectToDelete(project)}>
                            <IconTrash />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="project-index-empty">
                  <b>Không tìm thấy hồ sơ NVTK phù hợp</b>
                  <span>Thử tìm bằng từ khóa khác hoặc thiết lập lại bộ lọc.</span>
                </div>
              )}
              <Pagination total={visibleDesignProjects.length} pageSize={designPageSize} page={designPage} onPageChange={setDesignPage} onPageSizeChange={(size) => { setDesignPageSize(size); setDesignPage(1); }} />
            </section>
          </>
        ) : view === "fs_ver2" ? (
          <>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <h1>FS thực thi</h1>
                <div className="top-stat-cards">
                  <div className="top-stat-card">
                    <span>TỔNG DỰ ÁN</span>
                    <b>{projects.length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>CHƯA LẬP</span>
                    <b style={{ color: "#64748b" }}>{projects.filter((p) => p.fsStatus === "chua_lap").length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐANG TÍNH TOÁN</span>
                    <b style={{ color: "#1a56a8" }}>{projects.filter((p) => p.fsStatus === "dang_tinh_toan").length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐỐI CHIẾU</span>
                    <b style={{ color: "#d97706" }}>{projects.filter((p) => p.fsStatus === "cho_doi_chieu").length}</b>
                  </div>
                  <div className="top-stat-card">
                    <span>ĐÃ DUYỆT</span>
                    <b style={{ color: "#167461" }}>{projects.filter((p) => p.fsStatus === "da_duyet").length}</b>
                  </div>
                </div>
              </div>
              <div className="page-top-actions">
                <label className="search-field" style={{ margin: 0, minWidth: "200px", maxWidth: "260px" }}>
                  <span>Tìm dự án</span>
                  <input value={fsSearch} onChange={(event) => { setFsSearch(event.target.value); setFsPage(1); }} placeholder="Nhập tên, mã dự án..." />
                </label>
                <button type="button" className="secondary-button" onClick={() => setView("projects")}>← Quay lại MTL</button>
                <button type="button" className="primary-button">+ Lập Phương Án FS</button>
              </div>
            </header>
            <section className="project-index">

              {/* Filters */}
              <div className="table-filters" style={{ margin: "14px 24px 14px", border: "none" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <label className="table-filters-select">
                    <span>Vùng</span>
                    <select value={fsRegionFilter} onChange={(event) => { setFsRegionFilter(event.target.value); setFsPage(1); }}>
                      <option value="all">Tất cả vùng</option>
                      {[...new Set(projects.map((p) => p.region).filter(Boolean) as string[])].sort().map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label className="table-filters-select">
                    <span>Trạng thái FS</span>
                    <select value={fsStatusFilter} onChange={(event) => { setFsStatusFilter(event.target.value); setFsPage(1); }}>
                      <option value="all">Tất cả trạng thái FS</option>
                      <option value="chua_lap">Chưa lập FS</option>
                      <option value="dang_tinh_toan">Đang tính toán FS</option>
                      <option value="cho_doi_chieu">Đối chiếu số liệu</option>
                      <option value="da_duyet">Đã duyệt FS-Ver2</option>
                    </select>
                  </label>
                </div>
                <span className="table-filters-count">{visibleFsProjects.length} dự án</span>
              </div>

              {/* Exact 7-column Table (No Loại Dự Án) */}
              {visibleFsProjects.length > 0 ? (
                <div className="project-table" aria-label="Danh sách dự án Lập FS Thực Thi">
                  <div className="project-table-head">
                    <span>Mã dự án</span>
                    <span>Tên dự án</span>
                    <span>Chủ đầu tư</span>
                    <span>Khu vực</span>
                    <span>Vùng</span>
                    <span>Trạng thái</span>
                    <span>Hành động</span>
                  </div>
                  <div className="project-table-body">
                    {pagedFsProjects.map((project) => (
                      <div key={project.id} className="project-table-row" onClick={() => { setActiveId(project.id); setView("workspace"); }}>
                        <span className="project-code">{project.code}</span>
                        <span className="project-name-cell">
                          <b>{project.name}</b>
                        </span>
                        <span className="project-table-cell-ellipsis" title={project.investor || "Tập đoàn Novaland"}>{project.investor || "Tập đoàn Novaland"}</span>
                        <span className="project-table-cell-ellipsis" title={project.location || project.area || "—"}>{project.location || project.area || "—"}</span>
                        <span className="project-region-cell">{project.region || "Toàn quốc"}</span>
                        <span>
                          {project.fsStatus === "da_duyet" ? (
                            <span className="status-badge" style={{ background: "#edf8f5", color: "#167461", border: "1px solid #a4dfd1" }}>✓ ĐÃ DUYỆT FS-VER2</span>
                          ) : project.fsStatus === "cho_doi_chieu" ? (
                            <span className="status-badge" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}>ĐỐI CHIẾU SỐ LIỆU</span>
                          ) : project.fsStatus === "dang_tinh_toan" ? (
                            <span className="status-badge" style={{ background: "#eef4fb", color: "#1a56a8", border: "1px solid #bfdbfe" }}>ĐANG TÍNH TOÁN FS</span>
                          ) : (
                            <span className="status-badge" style={{ background: "#f1f5f9", color: "#64748b" }}>CHƯA LẬP FS</span>
                          )}
                        </span>
                        <span className="project-action-cell" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="action-btn view-btn" title="Xem phân tích FS" aria-label="Xem FS" onClick={() => { setActiveId(project.id); setView("workspace"); }}>
                            <IconEye />
                          </button>
                          <button type="button" className="action-btn delete-btn" title="Xóa dự án" aria-label="Xóa dự án" onClick={() => setProjectToDelete(project)}>
                            <IconTrash />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="project-index-empty">
                  <b>Không tìm thấy hồ sơ FS phù hợp</b>
                  <span>Thử tìm bằng từ khóa khác hoặc thiết lập lại bộ lọc.</span>
                </div>
              )}
              <Pagination total={visibleFsProjects.length} pageSize={fsPageSize} page={fsPage} onPageChange={setFsPage} onPageSizeChange={(size) => { setFsPageSize(size); setFsPage(1); }} />
            </section>
          </>
        ) : view === "init_template" ? (
          <div className="init-template-view">
            {/* Topbar */}
            <header className="init-template-topbar">
              <div className="init-topbar-left">
                <button
                  type="button"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", display: "grid", placeItems: "center" }}
                  onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  title="Thu gọn / Mở rộng menu"
                >
                  <IconMenu />
                </button>
                <div className="init-search-box">
                  <IconSearch />
                  <input
                    type="text"
                    placeholder="Tìm kiếm dự án, công việc, tài liệu..."
                    value={initTemplateSearch}
                    onChange={(e) => setInitTemplateSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="init-topbar-right">
                <button
                  type="button"
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", display: "grid", placeItems: "center" }}
                  title="Thông báo"
                >
                  <IconBell />
                </button>
                <div style={{ width: 1, height: 18, background: "#e2e8f0" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "12.5px", fontWeight: 600, color: "#1e293b", cursor: "pointer" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#f1f5f9", display: "grid", placeItems: "center", color: "#64748b", fontSize: "11px", fontWeight: 700 }}>
                    NV
                  </span>
                  <span>Nguyễn Văn A</span>
                  <IconChevronDown />
                </div>
                <button className="init-btn-home" onClick={() => setView("home")}>
                  <IconHome />
                  <span>Về trang chủ</span>
                </button>
              </div>
            </header>

            {/* Main Body */}
            <div className="init-template-body">
              {/* Breadcrumbs */}
              <nav className="init-breadcrumb" aria-label="Breadcrumb">
                <button
                  onClick={() => setView("home")}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#64748b", display: "inline-flex", alignItems: "center" }}
                  title="Trang chủ"
                >
                  <IconHome />
                </button>
                <span className="init-breadcrumb-sep">/</span>
                <button
                  onClick={() => setView("projects")}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "#64748b" }}
                >
                  Dự án
                </button>
                <span className="init-breadcrumb-sep">/</span>
                <span style={{ color: "#0f172a", fontWeight: 600 }}>Khởi tạo tiến độ</span>
              </nav>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h1 className="init-page-title">Khởi tạo tiến độ Master Timeline</h1>
                  <p className="init-page-desc">
                    Khởi tạo tiến độ mới hoàn toàn từ Mẫu chuẩn (Cấu trúc Master Timeline) hoặc kế thừa từ Version MTL đã duyệt để cập nhật điều chỉnh.
                  </p>
                </div>

                {/* Mode Switcher Tabs */}
                <div className="init-mode-switcher" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={initMode === "from_template"}
                    className={`init-mode-btn ${initMode === "from_template" ? "active mode-template" : ""}`}
                    onClick={() => setInitMode("from_template")}
                  >
                    <IconSparkles />
                    <span>1. Khởi tạo mới từ Mẫu chuẩn</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={initMode === "from_approved_version"}
                    className={`init-mode-btn ${initMode === "from_approved_version" ? "active mode-update" : ""}`}
                    onClick={() => setInitMode("from_approved_version")}
                  >
                    <IconRefresh />
                    <span>2. Khởi tạo từ Version MTL đã duyệt (Cập nhật)</span>
                  </button>
                </div>
              </div>

              {initMode === "from_template" ? (
                /* ================= MODE 1: KHỞI TẠO MỚI TỪ MẪU CHUẨN ================= */
                <>
                  <div className="init-template-grid">
                    {/* Column 1: Thông tin dự án mới */}
                    <div className="init-col-card">
                      <div className="init-col-head">
                        <span className="init-num-badge">1</span>
                        <span className="init-col-title">Thông tin dự án mới</span>
                      </div>

                      <div className="init-field-group">
                        <div className="init-field">
                          <label className="init-field-label">
                            Tên dự án mới <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <input
                            type="text"
                            className="init-field-input"
                            value={initProjectName}
                            onChange={(e) => setInitProjectName(e.target.value)}
                            placeholder="Nhập tên dự án..."
                          />
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">
                            Mã dự án <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <input
                            type="text"
                            className="init-field-input"
                            value={initProjectCode}
                            onChange={(e) => setInitProjectCode(e.target.value)}
                            placeholder="Ví dụ: AQC-PS-2026..."
                          />
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Chủ đầu tư</label>
                          <input
                            type="text"
                            className="init-field-input"
                            value={initInvestor}
                            onChange={(e) => setInitInvestor(e.target.value)}
                            placeholder="Tập đoàn Novaland..."
                          />
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Loại hình dự án</label>
                          <select
                            className="init-field-select"
                            value={initProjectType}
                            onChange={(e) => setInitProjectType(e.target.value)}
                          >
                            <option value="Khu đô thị sinh thái thông minh">Khu đô thị sinh thái thông minh</option>
                            <option value="Tổ hợp Du lịch Nghỉ dưỡng Giải trí">Tổ hợp Du lịch Nghỉ dưỡng Giải trí</option>
                            <option value="Khu phức hợp Căn hộ Cao cấp & Thương mại">Khu phức hợp Căn hộ Cao cấp & Thương mại</option>
                            <option value="Bất động sản công nghiệp & Dân dụng">Bất động sản công nghiệp & Dân dụng</option>
                          </select>
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Khu vực</label>
                          <select
                            className="init-field-select"
                            value={initArea}
                            onChange={(e) => setInitArea(e.target.value)}
                          >
                            <option value="Đồng Nai">Đồng Nai</option>
                            <option value="TP. Hồ Chí Minh">TP. Hồ Chí Minh</option>
                            <option value="Bình Thuận">Bình Thuận</option>
                            <option value="Bà Rịa - Vũng Tàu">Bà Rịa - Vũng Tàu</option>
                            <option value="Khánh Hòa">Khánh Hòa</option>
                            <option value="Lâm Đồng">Lâm Đồng</option>
                          </select>
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Vùng</label>
                          <select
                            className="init-field-select"
                            value={initRegion}
                            onChange={(e) => setInitRegion(e.target.value)}
                          >
                            <option value="Miền Nam">Miền Nam</option>
                            <option value="Miền Trung">Miền Trung</option>
                            <option value="Miền Bắc">Miền Bắc</option>
                            <option value="Tây Nguyên">Tây Nguyên</option>
                          </select>
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Ngày bắt đầu dự kiến</label>
                          <input
                            type="date"
                            className="init-field-input"
                            value={initStartDate}
                            onChange={(e) => setInitStartDate(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Cấu trúc Mẫu Master Timeline chuẩn (Mô hình 9-4) */}
                    <div className="init-col-card">
                      <div className="init-col-head">
                        <span className="init-num-badge">2</span>
                        <span className="init-col-title">Mẫu Cấu trúc Master Timeline chuẩn (9-4)</span>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, overflowY: "auto", paddingRight: 2 }}>
                        <div className="approved-cert-card">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span className="approved-version-pill">
                              <IconCheck /> ĐÃ PHÊ DUYỆT CHUẨN
                            </span>
                            <span style={{ fontSize: "11px", color: "#166534", fontWeight: 700 }}>
                              QĐ 128/QĐ-HĐQT-NVL
                            </span>
                          </div>
                          <div style={{ fontSize: "13.5px", fontWeight: 800, color: "#0f172a" }}>
                            Cấu trúc Master Timeline Novaland – Mô hình 9-4
                          </div>
                          <div style={{ fontSize: "11px", color: "#475569", lineHeight: "1.45" }}>
                            Bộ khung tiến độ chuẩn hóa tích hợp Khối Trực tiếp & Chủ trì (Khối 4: 5 nhóm · 317 task) và Khối Ban/Phòng Gián tiếp (Khối 9: 9 ban/phòng · 783 task).
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                            <span style={{ background: "#ffffff", border: "1px solid #bbf7d0", padding: "2px 7px", borderRadius: 4, fontSize: "10.5px", fontWeight: 700, color: "#15803d" }}>
                              Khối 4: 5 nhóm (317 task)
                            </span>
                            <span style={{ background: "#ffffff", border: "1px solid #bfdbfe", padding: "2px 7px", borderRadius: 4, fontSize: "10.5px", fontWeight: 700, color: "#1d4ed8" }}>
                              Khối 9: 9 nhóm (783 task)
                            </span>
                            <span style={{ background: "#ffffff", border: "1px solid #e2e8f0", padding: "2px 7px", borderRadius: 4, fontSize: "10.5px", fontWeight: 700, color: "#0f172a" }}>
                              Tổng {fullCatalog.length} công việc
                            </span>
                          </div>
                        </div>

                        {/* Block 4 */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                            <span style={{ fontSize: "11px", fontWeight: 800, color: "#166534", textTransform: "uppercase", letterSpacing: "0.3px" }}>
                              Khối 4 · Trực tiếp & Chủ trì (5 nhóm · 317 task)
                            </span>
                            <span style={{ fontSize: "10px", fontWeight: 700, color: "#15803d", background: "#dcfce7", padding: "1px 5px", borderRadius: 3 }}>
                              Direct & PMD
                            </span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {[
                              { code: "4.0", short: "PMD", name: "Phòng Điều hành Dự án", desc: "Chủ trì lập, tích hợp & điều phối tổng tiến độ MTL", count: "7 task" },
                              { code: "4.1", short: "PLP", name: "Phòng Thủ tục Pháp lý Dự án", desc: "Chủ trương ĐT, quy hoạch 1/500, đất đai, GPXD, nghiệm thu", count: "99 task" },
                              { code: "4.2", short: "DMD", name: "Phòng Quản lý Thiết kế", desc: "Nhiệm vụ thiết kế, TKCS, TKBVTC, thẩm duyệt PCCC", count: "120 task" },
                              { code: "4.3", short: "PCD", name: "Phòng Quản lý Xây dựng, An toàn & MT", desc: "Mặt bằng, cọc móng, kết cấu ngầm/thân, MEP, hạ tầng", count: "74 task" },
                              { code: "4.4", short: "OM", name: "Phòng Quản lý Vận hành Dự án", desc: "Phí QLVH, pre-opening vận hành, nghiệm thu bàn giao", count: "17 task" },
                            ].map((g) => (
                              <div
                                key={g.code}
                                style={{
                                  background: "#f0fdf4",
                                  border: "1px solid #bbf7d0",
                                  borderRadius: 5,
                                  padding: "6px 8px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#14532d" }}>
                                    <span style={{ color: "#15803d", marginRight: 5 }}>{g.code}</span>
                                    {g.short} – {g.name}
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {g.desc}
                                  </div>
                                </div>
                                <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#166534", background: "#ffffff", border: "1px solid #86efac", padding: "2px 6px", borderRadius: 4, flex: "none" }}>
                                  {g.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Block 9 */}
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                            <span style={{ fontSize: "11px", fontWeight: 800, color: "#1e40af", textTransform: "uppercase", letterSpacing: "0.3px" }}>
                              Khối 9 · Ban / Phòng Gián tiếp (9 ban/phòng · 783 task)
                            </span>
                            <span style={{ fontSize: "10px", fontWeight: 700, color: "#1d4ed8", background: "#dbeafe", padding: "1px 5px", borderRadius: 3 }}>
                              Indirect / Support
                            </span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                            {[
                              { code: "9.1", short: "HRC", name: "Ban Nhân sự", desc: "Quản lý nguồn nhân lực, tuyển dụng, đào tạo & HRBP", count: "57 task" },
                              { code: "9.2", short: "FAC", name: "Ban Tài chính Kế toán", desc: "FS, CF, P/L, quản trị vốn, dòng tiền Capex/Opex", count: "160 task" },
                              { code: "9.3", short: "SAC", name: "Ban Kinh doanh", desc: "Kế hoạch sản phẩm, bán hàng B2C, khai thác thương mại", count: "44 task" },
                              { code: "9.4", short: "MAC", name: "Ban Marketing", desc: "Chiến lược MKT, sự kiện mở bán, nội dung & digital", count: "145 task" },
                              { code: "9.5", short: "PTC", name: "Ban Cung ứng Đấu thầu", desc: "Cung ứng VLXD/MEP, tổ chức đấu thầu & thanh quyết toán", count: "128 task" },
                              { code: "9.6", short: "QSB", name: "Phòng Khối lượng và Ngân sách", desc: "Suất đầu tư, ngân sách xây dựng, kiểm soát khối lượng BoQ", count: "43 task" },
                              { code: "9.7", short: "SED", name: "Phòng An ninh", desc: "Phương án an ninh nội bộ, bảo vệ dự án, giám sát an toàn", count: "30 task" },
                              { code: "9.8", short: "IDC", name: "Trung tâm Thiết kế Nội bộ", desc: "Thiết kế quy hoạch, ý tưởng kiến trúc, nội thất & cảnh quan", count: "169 task" },
                              { code: "9.9", short: "CSC", name: "Trung tâm Bồi thường GPMB", desc: "Kế hoạch đền bù, thỏa thuận bồi thường & giải phóng MB", count: "7 task" },
                            ].map((g) => (
                              <div
                                key={g.code}
                                style={{
                                  background: "#f8fafc",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: 5,
                                  padding: "6px 8px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                }}
                              >
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#0f172a" }}>
                                    <span style={{ color: "#2563eb", marginRight: 5 }}>{g.code}</span>
                                    {g.short} – {g.name}
                                  </div>
                                  <div style={{ fontSize: "10px", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {g.desc}
                                  </div>
                                </div>
                                <span style={{ fontSize: "10.5px", fontWeight: 700, color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "2px 6px", borderRadius: 4, flex: "none" }}>
                                  {g.count}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Column 3: Xem trước cấu trúc WBS mẫu (Mô hình 9-4) */}
                    <div className="init-col-card">
                      <div className="init-col-head">
                        <span className="init-num-badge" style={{ display: "grid", placeItems: "center" }}>
                          <IconEye />
                        </span>
                        <span className="init-col-title">Cấu trúc WBS mẫu (9-4)</span>
                        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                          <button
                            type="button"
                            onClick={() =>
                              setInitTreeExpanded({
                                root: true,
                                block4: true,
                                block9: true,
                                g4_0: true,
                                g4_1: true,
                                g4_2: true,
                                g4_3: true,
                                g4_4: true,
                                g9_1: true,
                                g9_2: true,
                                g9_3: true,
                                g9_4: true,
                                g9_5: true,
                                g9_6: true,
                                g9_7: true,
                                g9_8: true,
                                g9_9: true,
                              })
                            }
                            style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 3, padding: "2px 6px", fontSize: "10.5px", fontWeight: 600, color: "#334155", cursor: "pointer" }}
                          >
                            Mở tất cả
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setInitTreeExpanded({
                                root: true,
                                block4: false,
                                block9: false,
                                g4_0: false,
                                g4_1: false,
                                g4_2: false,
                                g4_3: false,
                                g4_4: false,
                                g9_1: false,
                                g9_2: false,
                                g9_3: false,
                                g9_4: false,
                                g9_5: false,
                                g9_6: false,
                                g9_7: false,
                                g9_8: false,
                                g9_9: false,
                              })
                            }
                            style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 3, padding: "2px 6px", fontSize: "10.5px", fontWeight: 600, color: "#334155", cursor: "pointer" }}
                          >
                            Thu gọn
                          </button>
                        </div>
                      </div>

                      <div className="wbs-tree-flat">
                        <div>
                          {/* Root */}
                          <div
                            className="wbs-tree-node root"
                            onClick={() =>
                              setInitTreeExpanded((prev) => ({
                                ...prev,
                                root: !prev.root,
                              }))
                            }
                          >
                            <span className="wbs-tree-chevron">{initTreeExpanded.root ? "▼" : "▶"}</span>
                            <IconFolderFlat />
                            <span>Master Timeline Novaland (Chuẩn 9-4 · 1.100 công việc)</span>
                          </div>

                          {initTreeExpanded.root && (
                            <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                              {/* KHỐI 4 */}
                              <div>
                                <div
                                  className="wbs-tree-node block block-4"
                                  onClick={() => setInitTreeExpanded((prev) => ({ ...prev, block4: !prev.block4 }))}
                                >
                                  <span className="wbs-tree-chevron">{initTreeExpanded.block4 ? "▼" : "▶"}</span>
                                  <IconFolderFlat />
                                  <span>KHỐI 4: PHÒNG BAN TRỰC TIẾP & CHỦ TRÌ (317 task)</span>
                                </div>

                                {initTreeExpanded.block4 && (
                                  <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 2 }}>
                                    {/* 4.0 PMD */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_0: !prev.g4_0 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g4_0 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>4.0 PMD – Phòng Điều hành Dự án (7 task)</span>
                                      </div>
                                      {initTreeExpanded.g4_0 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.0.1 Lập và cập nhật tổng tiến độ dự án (MTL)</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.0.2 Lập và cập nhật FS thực thi (Fs-Ver2)</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.0.3 Lập nhiệm vụ thiết kế</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 4.1 PLP */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_1: !prev.g4_1 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g4_1 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>4.1 PLP – Phòng Thủ tục Pháp lý Dự án (99 task)</span>
                                      </div>
                                      {initTreeExpanded.g4_1 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.1.1 Thủ tục pháp lý chung & Thanh tra kiểm toán</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.1.2 Thủ tục pháp lý đầu tư & Chủ trương đầu tư</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.1.3 Thủ tục pháp lý đất đai & Giao đất/Tiền SDĐ</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.1.4 Thủ tục pháp lý quy hoạch 1/500 & Giấy phép XD</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 4.2 DMD */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_2: !prev.g4_2 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g4_2 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>4.2 DMD – Phòng Quản lý Thiết kế (120 task)</span>
                                      </div>
                                      {initTreeExpanded.g4_2 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.2.1 Thiết kế Quy hoạch (1/5000, 1/2000, 1/500)</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.2.2 Thiết kế Hạ tầng kỹ thuật & Cơ điện (MEP)</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.2.3 Thiết kế Kiến trúc, Kết cấu & TKBVTC</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 4.3 PCD */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_3: !prev.g4_3 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g4_3 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>4.3 PCD – Phòng Quản lý Xây dựng, AT & MT (74 task)</span>
                                      </div>
                                      {initTreeExpanded.g4_3 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.3.1 Thi công Công tác chuẩn bị & Khởi công</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.3.2 Thi công San lấp mặt bằng & Xử lý nền móng</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.3.3 Thi công Kết cấu thân & Hoàn thiện MEP</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 4.4 OM */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_4: !prev.g4_4 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g4_4 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>4.4 OM – Phòng Quản lý Vận hành Dự án (17 task)</span>
                                      </div>
                                      {initTreeExpanded.g4_4 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.4.1 Tính giá dịch vụ QLVH & Tiêu chuẩn vận hành</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>4.4.2 Triển khai Pre-opening & Bàn giao sản phẩm</span></div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* KHỐI 9 */}
                              <div>
                                <div
                                  className="wbs-tree-node block block-9"
                                  onClick={() => setInitTreeExpanded((prev) => ({ ...prev, block9: !prev.block9 }))}
                                >
                                  <span className="wbs-tree-chevron">{initTreeExpanded.block9 ? "▼" : "▶"}</span>
                                  <IconFolderFlat />
                                  <span>KHỐI 9: BAN / PHÒNG BAN GIÁN TIẾP (783 task)</span>
                                </div>

                                {initTreeExpanded.block9 && (
                                  <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 2 }}>
                                    {/* 9.1 HRC */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_1: !prev.g9_1 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_1 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.1 HRC – Ban Nhân sự (57 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_1 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.1.1 Phòng Quản lý Nguồn nhân lực (HRM, Tuyển dụng)</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.1.2 Phòng Hành chính Nhân sự (HRA)</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.2 FAC */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_2: !prev.g9_2 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_2 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.2 FAC – Ban Tài chính Kế toán (160 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_2 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.2.1 Phòng Hoạch định & Phân tích Tài chính (FS, CF, P/L)</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.2.2 Phòng Tài chính Dự án, Thị trường vốn & IR</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.3 SAC */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_3: !prev.g9_3 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_3 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.3 SAC – Ban Kinh doanh (44 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_3 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.3.1 Quản lý kinh doanh dự án & Kế hoạch sản phẩm</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.3.2 Phòng Kinh doanh B2C & Khai thác chuyển nhượng</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.4 MAC */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_4: !prev.g9_4 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_4 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.4 MAC – Ban Marketing (145 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_4 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.4.1 Kế hoạch Marketing theo giai đoạn & Ngân sách MKT</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.4.2 Tổ chức sự kiện mở bán, Nội dung & Digital</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.5 PTC */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_5: !prev.g9_5 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_5 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.5 PTC – Ban Cung ứng Đấu thầu (128 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_5 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.5.1 Cung ứng VLXD, Thiết bị Cơ điện & Hoàn thiện</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.5.2 Đấu thầu gói thầu xây dựng & Thanh quyết toán</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.6 QSB */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_6: !prev.g9_6 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_6 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.6 QSB – Phòng Khối lượng và Ngân sách (43 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_6 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.6.1 Xây dựng suất đầu tư & Ngân sách dự án xây dựng</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.6.2 Lập bảng khối lượng mời thầu (BoQ) C&S, MEP & HTKT</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.7 SED */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_7: !prev.g9_7 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_7 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.7 SED – Phòng An ninh (30 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_7 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.7.1 An ninh nội bộ & Bảo vệ mục tiêu dự án</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.7.2 Công nghệ an ninh & Nghiệp vụ Giám sát đặc biệt</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.8 IDC */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_8: !prev.g9_8 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_8 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.8 IDC – Trung tâm Thiết kế Nội bộ (169 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_8 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.8.1 Nghiên cứu, đề xuất phương án thiết kế ý tưởng</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.8.2 Thiết kế Ý tưởng Quy hoạch, Nội thất & Cảnh quan</span></div>
                                        </div>
                                      )}
                                    </div>

                                    {/* 9.9 CSC */}
                                    <div>
                                      <div
                                        className="wbs-tree-node group"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_9: !prev.g9_9 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.g9_9 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>9.9 CSC – Trung tâm Bồi thường GPMB (7 task)</span>
                                      </div>
                                      {initTreeExpanded.g9_9 && (
                                        <div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.9.1 Thỏa thuận bồi thường & Giải phóng mặt bằng</span></div>
                                          <div className="wbs-tree-node task"><IconDocFlat /><span>9.9.2 Quản lý & Bàn giao mốc giới mặt bằng thi công</span></div>
                                        </div>
                                      )}
                                    </div>

                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Notification & Action Bar */}
                  <div className="init-bottom-bar">
                    <div className="init-info-pill">
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#16a34a" }}>ℹ</span>
                      <span>Hệ thống sẽ tạo bộ tiến độ gốc hoàn toàn mới cho dự án dựa trên Cấu trúc Master Timeline mẫu đã phê duyệt.</span>
                    </div>

                    <div className="init-actions-right">
                      <button
                        type="button"
                        className="init-btn-cancel"
                        onClick={() => setView("projects")}
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        className="init-btn-submit"
                        onClick={() => {
                          const newId = `project-${Date.now()}`;
                          const newProj: Project = {
                            id: newId,
                            name: initProjectName.trim() || "Dự án mới",
                            code: initProjectCode.trim() || `PRJ-${Date.now().toString().slice(-4)}`,
                            type: initProjectType || "Khu đô thị sinh thái thông minh",
                            investor: initInvestor || "Tập đoàn Novaland",
                            location: initArea || "Đồng Nai",
                            area: initArea || "Đồng Nai",
                            region: initRegion || "Miền Nam",
                            startDate: initStartDate || today,
                            targetDate: dateAtWorkingOffset(initStartDate || today, 365),
                            parameters: DEFAULT_PROJECT_PARAMETERS,
                            parameterImpacts: [],
                            milestoneDates: {},
                            selectedGroups: ["G1", "G2", "G3", "G4", "G5"],
                            createdAt: new Date().toISOString(),
                            taskEdits: {},
                            taskDependencies: {},
                            customTasks: [],
                            includedTaskCodes: fullCatalog.map((t) => t.code),
                            departmentApprovals: normalizeDepartmentApprovals(["G1", "G2", "G3", "G4", "G5"]),
                            approvalStatus: "draft",
                            officialVersion: "v1.0",
                          };
                          setProjects((prev) => [newProj, ...prev]);
                          setActiveId(newId);
                          setView("workspace");
                          notify(`Đã khởi tạo thành công tiến độ mới từ Cấu trúc Master Timeline mẫu cho ${newProj.name}!`);
                        }}
                      >
                        <IconSparkles />
                        <span>Khởi tạo tiến độ mới</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* ================= MODE 2: KHỞI TẠO TỪ VERSION MTL ĐÃ DUYỆT (CẬP NHẬT) ================= */
                <>
                  {(() => {
                    const targetProject =
                      projects.find((p) => p.id === initSelectedApprovedProjectId) ||
                      projects.find((p) => p.isOfficialApproved) ||
                      projects[0];
                    const sourceVersion = targetProject?.officialVersion || targetProject?.approvedVersion || "v1.0";
                    const approvalCode = targetProject?.eApprovalCode || "QĐ-NVL-2026/892";
                    const approvalDate = targetProject?.eApprovalDate || "2026-06-15";

                    return (
                      <>
                        <div className="init-template-grid">
                          {/* Column 1: Chọn Dự án & Version đã duyệt nguồn */}
                          <div className="init-col-card">
                            <div className="init-col-head">
                              <span className="init-num-badge" style={{ background: "#2563eb" }}>1</span>
                              <span className="init-col-title">Dự án & Version đã duyệt nguồn</span>
                            </div>

                            <div className="init-field-group">
                              <div className="init-field">
                                <label className="init-field-label">
                                  Dự án cần cập nhật <span style={{ color: "#ef4444" }}>*</span>
                                </label>
                                <select
                                  className="init-field-select"
                                  value={targetProject?.id || ""}
                                  onChange={(e) => {
                                    const projId = e.target.value;
                                    setInitSelectedApprovedProjectId(projId);
                                    const p = projects.find((item) => item.id === projId);
                                    if (p) {
                                      const curVer = p.officialVersion || p.approvedVersion || "v1.0";
                                      setInitSelectedVersion(curVer);
                                      const match = curVer.match(/v(\d+)\.(\d+)/);
                                      if (match) {
                                        setInitNewVersionCode(`v${match[1]}.${Number(match[2]) + 1}`);
                                      } else {
                                        setInitNewVersionCode("v1.1");
                                      }
                                    }
                                  }}
                                >
                                  {projects.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name} ({p.code}) {p.isOfficialApproved ? "· [ĐÃ PHÊ DUYỆT]" : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="init-field">
                                <label className="init-field-label">Version MTL đã duyệt (Nguồn)</label>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "8px 12px",
                                    background: "#f1f5f9",
                                    borderRadius: 6,
                                    border: "1px solid #e2e8f0",
                                    fontSize: "12.5px",
                                    color: "#0f172a",
                                    fontWeight: 700,
                                  }}
                                >
                                  <span className="approved-version-pill">
                                    <IconCheck /> {sourceVersion}
                                  </span>
                                  <span>{approvalCode}</span>
                                  <span style={{ color: "#64748b", fontWeight: 500, fontSize: "11px" }}>
                                    (Duyệt ngày {formatDate(approvalDate)})
                                  </span>
                                </div>
                              </div>

                              <div className="init-field">
                                <label className="init-field-label">
                                  Mã phiên bản cập nhật mới <span style={{ color: "#ef4444" }}>*</span>
                                </label>
                                <input
                                  type="text"
                                  className="init-field-input"
                                  style={{ fontWeight: 700, color: "#1d4ed8" }}
                                  value={initNewVersionCode}
                                  onChange={(e) => setInitNewVersionCode(e.target.value)}
                                  placeholder="Ví dụ: v1.1 hoặc v2.0..."
                                />
                                <span style={{ fontSize: "10.5px", color: "#64748b" }}>
                                  Hệ thống tự động gợi ý phiên bản kế tiếp ({initNewVersionCode}).
                                </span>
                              </div>

                              <div className="init-field">
                                <label className="init-field-label">
                                  Lý do / Căn cứ cập nhật MTL <span style={{ color: "#ef4444" }}>*</span>
                                </label>
                                <textarea
                                  className="init-field-input"
                                  rows={3}
                                  style={{ resize: "vertical", height: "auto" }}
                                  value={initUpdateReason}
                                  onChange={(e) => setInitUpdateReason(e.target.value)}
                                  placeholder="Nhập lý do điều chỉnh tiến độ hoặc cập nhật thực tế..."
                                />
                              </div>

                              <div className="init-field">
                                <label className="init-field-label">Ngày tạo bản cập nhật</label>
                                <input
                                  type="date"
                                  className="init-field-input readonly"
                                  readOnly
                                  value={today}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Column 2: Chi tiết hồ sơ phê duyệt trước đó */}
                          <div className="init-col-card">
                            <div className="init-col-head">
                              <span className="init-num-badge" style={{ background: "#2563eb" }}>2</span>
                              <span className="init-col-title">Hồ sơ Version đã duyệt trước đó</span>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                              <div className="version-meta-box">
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Dự án gốc:</span>
                                  <span className="version-meta-val">{targetProject?.name}</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Mã dự án:</span>
                                  <span className="version-meta-val" style={{ color: "#2563eb" }}>{targetProject?.code}</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Số quyết định phê duyệt:</span>
                                  <span className="version-meta-val">{approvalCode}</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Ngày ký duyệt chính thức:</span>
                                  <span className="version-meta-val">{formatDate(approvalDate)}</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Cấp phê duyệt:</span>
                                  <span className="version-meta-val">HĐQT / Ban Tổng Giám đốc</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Phiên bản nguồn:</span>
                                  <span className="version-meta-val" style={{ color: "#166534" }}>{sourceVersion} (Chính thức)</span>
                                </div>
                              </div>

                              <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155", margin: "2px 0 0" }}>
                                Dữ liệu WBS kế thừa vào bản mới (Mô hình 9-4):
                              </div>

                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "8px 10px" }}>
                                  <div style={{ fontSize: "10px", color: "#166534", fontWeight: 700, textTransform: "uppercase" }}>Khối 4 · Trực tiếp & Chủ trì</div>
                                  <div style={{ fontSize: "13.5px", fontWeight: 800, color: "#14532d" }}>
                                    5 nhóm · 317 task
                                  </div>
                                </div>
                                <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "8px 10px" }}>
                                  <div style={{ fontSize: "10px", color: "#1d4ed8", fontWeight: 700, textTransform: "uppercase" }}>Khối 9 · Ban / Phòng Gián tiếp</div>
                                  <div style={{ fontSize: "13.5px", fontWeight: 800, color: "#1e3a8a" }}>
                                    9 nhóm · 783 task
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
                                  <div style={{ fontSize: "10.5px", color: "#64748b" }}>Tổng số công việc WBS</div>
                                  <div style={{ fontSize: "13.5px", fontWeight: 800, color: "#0f172a" }}>
                                    {fullCatalog.length} task
                                  </div>
                                </div>
                                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "8px 10px" }}>
                                  <div style={{ fontSize: "10.5px", color: "#64748b" }}>Liên kết logic WBS</div>
                                  <div style={{ fontSize: "13.5px", fontWeight: 800, color: "#0f172a" }}>
                                    100% liên kết 14 đơn vị
                                  </div>
                                </div>
                              </div>

                              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "9px 12px", fontSize: "11.5px", color: "#1e40af", lineHeight: "1.5" }}>
                                <b>Quy chế cập nhật theo mô hình 9-4:</b> Phiên bản mới sẽ kế thừa toàn bộ cấu trúc 14 đơn vị chuyên môn (Khối 4 trực tiếp & Khối 9 gián tiếp), ngày bắt đầu/kết thúc cơ sở và liên kết logic của version {sourceVersion}. Sau khi khởi tạo, PMD và các phòng ban có thể cập nhật thực tế mốc tiến độ theo thẩm quyền.
                              </div>
                            </div>
                          </div>

                          {/* Column 3: Xem trước cấu trúc & tiến độ kế thừa */}
                          <div className="init-col-card">
                            <div className="init-col-head">
                              <span className="init-num-badge" style={{ background: "#2563eb", display: "grid", placeItems: "center" }}>
                                <IconEye />
                              </span>
                              <span className="init-col-title">Xem trước cấu trúc kế thừa (9-4)</span>
                              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInitTreeExpanded({
                                      root: true,
                                      block4: true,
                                      block9: true,
                                      g4_0: true,
                                      g4_1: true,
                                      g4_2: true,
                                      g4_3: true,
                                      g4_4: true,
                                      g9_1: true,
                                      g9_2: true,
                                      g9_3: true,
                                      g9_4: true,
                                      g9_5: true,
                                      g9_6: true,
                                      g9_7: true,
                                      g9_8: true,
                                      g9_9: true,
                                    })
                                  }
                                  style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 3, padding: "2px 6px", fontSize: "10.5px", fontWeight: 600, color: "#334155", cursor: "pointer" }}
                                >
                                  Mở tất cả
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setInitTreeExpanded({
                                      root: true,
                                      block4: false,
                                      block9: false,
                                      g4_0: false,
                                      g4_1: false,
                                      g4_2: false,
                                      g4_3: false,
                                      g4_4: false,
                                      g9_1: false,
                                      g9_2: false,
                                      g9_3: false,
                                      g9_4: false,
                                      g9_5: false,
                                      g9_6: false,
                                      g9_7: false,
                                      g9_8: false,
                                      g9_9: false,
                                    })
                                  }
                                  style={{ background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 3, padding: "2px 6px", fontSize: "10.5px", fontWeight: 600, color: "#334155", cursor: "pointer" }}
                                >
                                  Thu gọn
                                </button>
                              </div>
                            </div>

                            <div className="wbs-tree-flat">
                              <div>
                                <div
                                  className="wbs-tree-node root"
                                  onClick={() =>
                                    setInitTreeExpanded((prev) => ({
                                      ...prev,
                                      root: !prev.root,
                                    }))
                                  }
                                >
                                  <span className="wbs-tree-chevron">{initTreeExpanded.root ? "▼" : "▶"}</span>
                                  <IconFolderFlat />
                                  <span>{targetProject?.name} ({sourceVersion} · Mô hình 9-4)</span>
                                </div>

                                {initTreeExpanded.root && (
                                  <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                                    {/* KHỐI 4 */}
                                    <div>
                                      <div
                                        className="wbs-tree-node block block-4"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, block4: !prev.block4 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.block4 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>KHỐI 4: PHÒNG BAN TRỰC TIẾP & CHỦ TRÌ (317 task)</span>
                                      </div>

                                      {initTreeExpanded.block4 && (
                                        <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 2 }}>
                                          {/* 4.0 PMD */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_0: !prev.g4_0 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g4_0 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>4.0 PMD – Phòng Điều hành Dự án</span>
                                              <span className="wbs-tree-tag" style={{ background: "#dcfce7", color: "#166534" }}>Chủ trì điều phối</span>
                                            </div>
                                            {initTreeExpanded.g4_0 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.0.1 Lập & cập nhật tổng tiến độ MTL [Kế thừa mốc]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.0.2 Lập & cập nhật FS thực thi [Đã phê duyệt]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.0.3 Lập nhiệm vụ thiết kế [Đã duyệt]</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 4.1 PLP */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_1: !prev.g4_1 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g4_1 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>4.1 PLP – Phòng Thủ tục Pháp lý Dự án</span>
                                              <span className="wbs-tree-tag" style={{ background: "#dbeafe", color: "#1e40af" }}>Kế thừa mốc</span>
                                            </div>
                                            {initTreeExpanded.g4_1 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.1.1 Pháp lý đầu tư & Đất đai [Đã hoàn thành]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.1.2 Quy hoạch 1/500 & Giấy phép XD [Kế thừa mốc]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.1.3 Thẩm định pháp lý chuyên ngành [Đang cập nhật]</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 4.2 DMD */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_2: !prev.g4_2 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g4_2 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>4.2 DMD – Phòng Quản lý Thiết kế</span>
                                              <span className="wbs-tree-tag" style={{ background: "#dbeafe", color: "#1e40af" }}>Kế thừa mốc</span>
                                            </div>
                                            {initTreeExpanded.g4_2 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.2.1 Nhiệm vụ thiết kế & Thiết kế cơ sở [Đã duyệt]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.2.2 TKBVTC & Thẩm duyệt PCCC [Kế thừa mốc]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.2.3 Hồ sơ mời thầu thiết kế kỹ thuật [Đang cập nhật]</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 4.3 PCD */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_3: !prev.g4_3 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g4_3 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>4.3 PCD – Phòng Quản lý Xây dựng, AT & MT</span>
                                              <span className="wbs-tree-tag" style={{ background: "#fef3c7", color: "#92400e" }}>Đang thi công</span>
                                            </div>
                                            {initTreeExpanded.g4_3 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.3.1 Công tác chuẩn bị & Khởi công [Hoàn thành]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.3.2 Thi công cọc móng & San lấp [Đã hoàn thành]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.3.3 Thi công kết cấu hầm & thân [Đang thi công]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.3.4 Hoàn thiện, MEP & Cảnh quan [Kế thừa mốc]</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 4.4 OM */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g4_4: !prev.g4_4 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g4_4 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>4.4 OM – Phòng Quản lý Vận hành Dự án</span>
                                              <span className="wbs-tree-tag" style={{ background: "#dbeafe", color: "#1e40af" }}>Kế thừa mốc</span>
                                            </div>
                                            {initTreeExpanded.g4_4 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.4.1 Tiêu chuẩn QLVH & Tính giá dịch vụ [Kế thừa mốc]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>4.4.2 Pre-opening & Nghiệm thu bàn giao [Kế thừa mốc]</span></div>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* KHỐI 9 */}
                                    <div>
                                      <div
                                        className="wbs-tree-node block block-9"
                                        onClick={() => setInitTreeExpanded((prev) => ({ ...prev, block9: !prev.block9 }))}
                                      >
                                        <span className="wbs-tree-chevron">{initTreeExpanded.block9 ? "▼" : "▶"}</span>
                                        <IconFolderFlat />
                                        <span>KHỐI 9: BAN / PHÒNG BAN GIÁN TIẾP (783 task)</span>
                                      </div>

                                      {initTreeExpanded.block9 && (
                                        <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 2 }}>
                                          {/* 9.1 HRC */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_1: !prev.g9_1 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_1 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.1 HRC – Ban Nhân sự</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa định biên</span>
                                            </div>
                                            {initTreeExpanded.g9_1 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.1.1 Kế hoạch nhân sự & Tuyển dụng dự án [Kế thừa]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.1.2 Đào tạo tiền khai trương & Nhân sự ban QLDA</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.2 FAC */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_2: !prev.g9_2 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_2 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.2 FAC – Ban Tài chính Kế toán</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa dòng tiền</span>
                                            </div>
                                            {initTreeExpanded.g9_2 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.2.1 Kế hoạch giải ngân & Dòng tiền dự án CF [Kế thừa]</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.2.2 Kiểm soát hạn mức vốn vay & Capex/Opex</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.3 SAC */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_3: !prev.g9_3 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_3 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.3 SAC – Ban Kinh doanh</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa bán hàng</span>
                                            </div>
                                            {initTreeExpanded.g9_3 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.3.1 Kế hoạch mở bán đợt tiếp theo & Giỏ hàng</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.3.2 Tiến độ ký kết HĐMB & Khai thác thương mại</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.4 MAC */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_4: !prev.g9_4 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_4 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.4 MAC – Ban Marketing</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa chiến dịch</span>
                                            </div>
                                            {initTreeExpanded.g9_4 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.4.1 Chiến dịch truyền thông tổng thể & Ngân sách MKT</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.4.2 Sự kiện bán hàng & Triển lãm sa bàn thực tế</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.5 PTC */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_5: !prev.g9_5 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_5 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.5 PTC – Ban Cung ứng Đấu thầu</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa gói thầu</span>
                                            </div>
                                            {initTreeExpanded.g9_5 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.5.1 Kế hoạch thầu cơ điện MEP, Thang máy, Hoàn thiện</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.5.2 Cung ứng vật tư thiết bị & Hợp đồng thi công</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.6 QSB */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_6: !prev.g9_6 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_6 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.6 QSB – Phòng Khối lượng và Ngân sách</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa BoQ</span>
                                            </div>
                                            {initTreeExpanded.g9_6 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.6.1 Rà soát dự toán chi phí xây dựng & Khối lượng</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.6.2 Kiểm soát biến động giá & Phát sinh công trường</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.7 SED */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_7: !prev.g9_7 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_7 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.7 SED – Phòng An ninh</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa an ninh</span>
                                            </div>
                                            {initTreeExpanded.g9_7 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.7.1 Phương án an ninh ranh đất & Giám sát 24/7</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.7.2 Phối hợp chính quyền địa phương & PCCC cơ sở</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.8 IDC */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_8: !prev.g9_8 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_8 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.8 IDC – Trung tâm Thiết kế Nội bộ</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa hồ sơ</span>
                                            </div>
                                            {initTreeExpanded.g9_8 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.8.1 Chuẩn hóa concept & Thiết kế nhà mẫu thực tế</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.8.2 Thiết kế chi tiết cảnh quan & Chiếu sáng đô thị</span></div>
                                              </div>
                                            )}
                                          </div>

                                          {/* 9.9 CSC */}
                                          <div>
                                            <div
                                              className="wbs-tree-node group"
                                              onClick={() => setInitTreeExpanded((prev) => ({ ...prev, g9_9: !prev.g9_9 }))}
                                            >
                                              <span className="wbs-tree-chevron">{initTreeExpanded.g9_9 ? "▼" : "▶"}</span>
                                              <IconFolderFlat />
                                              <span>9.9 CSC – Trung tâm Bồi thường GPMB</span>
                                              <span className="wbs-tree-tag" style={{ background: "#f1f5f9", color: "#475569" }}>Kế thừa tiến độ MB</span>
                                            </div>
                                            {initTreeExpanded.g9_9 && (
                                              <div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.9.1 Tiến độ chi trả bồi thường & Nhận bàn giao đất</span></div>
                                                <div className="wbs-tree-node task"><IconDocFlat /><span>9.9.2 Bàn giao mốc giới thi công đợt bổ sung</span></div>
                                              </div>
                                            )}
                                          </div>

                                        </div>
                                      )}
                                    </div>

                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Bottom Notification & Action Bar */}
                        <div className="init-bottom-bar">
                          <div className="init-info-pill" style={{ background: "#eff6ff", borderColor: "#bfdbfe", color: "#1e40af" }}>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: "#2563eb" }}>ℹ</span>
                            <span>
                              Phiên bản mới <b>{initNewVersionCode}</b> sẽ kế thừa toàn bộ cấu trúc WBS và mốc thời gian từ bản <b>{sourceVersion}</b> đã duyệt; bạn có thể cập nhật thực tế trước khi trình thẩm định lại.
                            </span>
                          </div>

                          <div className="init-actions-right">
                            <button
                              type="button"
                              className="init-btn-cancel"
                              onClick={() => setView("projects")}
                            >
                              Hủy
                            </button>
                            <button
                              type="button"
                              className="init-btn-submit"
                              style={{ background: "#2563eb" }}
                              onClick={() => {
                                if (!targetProject) return;
                                const newVer = initNewVersionCode.trim() || "v1.1";
                                const updatedProject: Project = {
                                  ...targetProject,
                                  officialVersion: newVer,
                                  approvedVersion: undefined,
                                  approvalStatus: "draft",
                                  isOfficialApproved: false,
                                  baselineLocked: false,
                                  reviewNote: `Bản cập nhật ${newVer} (kế thừa từ ${sourceVersion}): ${initUpdateReason}`,
                                  departmentApprovals: normalizeDepartmentApprovals(targetProject.selectedGroups),
                                  createdAt: new Date().toISOString(),
                                };
                                setProjects((current) =>
                                  current.map((p) => (p.id === targetProject.id ? updatedProject : p))
                                );
                                setActiveId(targetProject.id);
                                setView("workspace");
                                notify(`Đã khởi tạo thành công bản cập nhật ${newVer} từ phiên bản ${sourceVersion} cho dự án ${targetProject.name}!`);
                              }}
                            >
                              <IconRefresh />
                              <span>Khởi tạo bản cập nhật ({initNewVersionCode})</span>
                            </button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        ) : !activeProject ? (
          <div className="empty-state">
            <span className="empty-kicker">MTL WORKSPACE</span><h1>Tạo Master Timeline trong vài phút</h1><p>Nhập thông tin dự án, chọn phạm vi áp dụng và hệ thống sẽ sinh đúng cây công việc từ mẫu Microsoft Project.</p>
            <div className="empty-metrics"><div><b>9</b><span>Phòng ban</span></div><div><b>5</b><span>Nhóm Phần 4</span></div><div><b>{fullCatalog.length}</b><span>Task mẫu</span></div></div>
            <button className="primary-button" onClick={openCreate}>Tạo dự án đầu tiên</button>
          </div>
        ) : (
          <>
            <header className="topbar workspace-topbar">
              <button className="breadcrumb-back" onClick={() => setView("projects")}>← Danh sách dự án</button>
              <div className="top-actions">
                <span className="saved-state"><i />Đã lưu trên thiết bị</span>
                <button className="secondary-button project-export" onClick={exportMicrosoftProject}>
                  Xuất Microsoft Project
                </button>
                {activeProject.isOfficialApproved && activeProject.eApprovalUrl && (
                  <a
                    href={activeProject.eApprovalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="secondary-button"
                    style={{ height: "30px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  >
                    <span>E-Approval</span>
                    <IconExternalLink />
                  </a>
                )}
                {!activeProject.isOfficialApproved ? (
                  <button
                    type="button"
                    className="primary-button"
                    style={{ background: "#73b52d", borderColor: "#64a024", height: "30px", fontSize: "12px", fontWeight: 700 }}
                    onClick={() => openEApprovalModal(activeProject)}
                  >
                    ✓ Xác nhận phê duyệt
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ height: "30px", fontSize: "12px", fontWeight: 600 }}
                    onClick={reopenApproved}
                  >
                    Tạo bản điều chỉnh
                  </button>
                )}
                <button className="danger-button" onClick={() => setShowDelete(true)}>Xóa dự án</button>
              </div>
            </header>

            <section className="project-header">
              <div className="project-header-left">
                <div className="project-title-row">
                  <span className={`status-badge approval-${activeProject.approvalStatus}`}>
                    {activeProject.isOfficialApproved ? "🛡️ " : ""}{projectApprovalLabel(activeProject)}{activeProject.approvedVersion ? ` · ${activeProject.approvedVersion}` : ""}
                  </span>
                  <h1>{activeProject.name}</h1>
                </div>
                <p>
                  {activeProject.code} · {activeProject.type}{activeProject.location ? ` · ${activeProject.location}` : ""}
                  {activeProject.isOfficialApproved && activeProject.eApprovalCode ? ` · QĐ: ${activeProject.eApprovalCode} (${formatDate(activeProject.eApprovalDate || activeProject.approvedAt)})` : ""}
                </p>
              </div>
              <div className="top-stat-cards workspace-stat-cards">
                <div className="top-stat-card">
                  <span>Công việc</span>
                  <b>{scheduled.length}</b>
                </div>
                <div className="top-stat-card">
                  <span>BAN/PHÒNG GIÁN TIẾP</span>
                  <b>{activeProject.selectedGroups.filter((code) => GROUP_BY_CODE[code]?.role === "indirect").length}/{INDIRECT_COUNT}</b>
                </div>
                <div className="top-stat-card">
                  <span>PHÒNG TRỰC TIẾP</span>
                  <b>{activeProject.selectedGroups.filter((code) => GROUP_BY_CODE[code]?.role === "direct").length}/{DIRECT_COUNT}</b>
                </div>
                <div className="top-stat-card">
                  <span>NGÀY MỤC TIÊU</span>
                  <b style={{ fontSize: "13px" }}>{formatDate(activeProject.targetDate)}</b>
                </div>
              </div>
            </section>

            <section className="toolbar" aria-label="Công cụ danh sách MTL">
              <div className="scope-tabs"><span className="active">Tất cả công việc ({scheduled.length})</span></div>
              <label className="search-field"><span>Tìm</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã WBS hoặc tên công việc" /></label>
              <button className="text-button" onClick={() => setCollapsed(new Set())}>Mở tất cả</button><button className="text-button" onClick={() => setCollapsed(new Set(activeProject.selectedGroups))}>Thu gọn</button>
            </section>

            <div className={`planning-area ${selectedTask ? "with-detail" : ""}`}>
              <section className="task-grid" aria-label="Cây công việc Master Timeline">
                <div className="grid-header" style={{ gridTemplateColumns: "150px minmax(280px, 2.5fr) 180px 120px 120px minmax(140px, 1.2fr) minmax(140px, 1.2fr)" }}>
                  <span>WBS</span>
                  <span>HẠNG MỤC</span>
                  <span style={{ whiteSpace: "nowrap" }}>THỜI GIAN THỰC HIỆN</span>
                  <span>NGÀY BẮT ĐẦU</span>
                  <span>NGÀY KẾT THÚC</span>
                  <span>GHI CHÚ</span>
                  <span>LIÊN KẾT</span>
                </div>
                <div className="grid-body">
                  {visibleTasks.map((task) => {
                    const isCollapsed = collapsed.has(task.code);
                    const taskNote = activeProject.taskEdits[task.code]?.note || activeProject.taskEdits[task.code]?.actualNote || "";
                    return (
                      <div
                        key={task.code}
                        role="button"
                        tabIndex={0}
                        className={`task-row level-${Math.min(task.level, 4)} ${selectedCode === task.code ? "selected" : ""} ${task.summary ? "summary" : ""}`}
                        style={{ gridTemplateColumns: "150px minmax(280px, 2.5fr) 180px 120px 120px minmax(140px, 1.2fr) minmax(140px, 1.2fr)" }}
                        onClick={() => setSelectedCode(task.code)}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedCode(task.code); }}
                      >
                        {/* 1. WBS */}
                        <span className="task-cell task-cell-wbs" style={{ "--indent": `${(task.level - 1) * 6}px` } as React.CSSProperties}>
                          {task.summary ? (
                            <i
                              className="toggle"
                              role="button"
                              aria-label={isCollapsed ? "Mở nhóm" : "Thu gọn nhóm"}
                              onClick={(event) => {
                                event.stopPropagation();
                                setCollapsed((current) => {
                                  const next = new Set(current);
                                  if (next.has(task.code)) next.delete(task.code);
                                  else next.add(task.code);
                                  return next;
                                });
                              }}
                            >
                              {isCollapsed ? "+" : "−"}
                            </i>
                          ) : (
                            <i className="task-dot" />
                          )}
                          <span className="wbs-tag" title={task.code}>{task.code}</span>
                        </span>

                        {/* 2. Hạng mục */}
                        <span
                          className="task-cell task-cell-name"
                          title={task.name}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setContextMenu({
                              code: task.code,
                              x: Math.min(event.clientX, window.innerWidth - 220),
                              y: Math.min(event.clientY, window.innerHeight - 180),
                            });
                          }}
                        >
                          <span className="task-name-text">{task.name}</span>
                          {task.custom && <i className="custom-chip">Mới</i>}
                        </span>

                        {/* 3. Thời gian thực hiện */}
                        <span className="task-cell task-cell-duration">
                          <span className="duration-badge">{task.duration} ngày</span>
                        </span>

                        {/* 4. Ngày bắt đầu */}
                        <span className="task-cell task-cell-date">
                          <b>{formatDate(task.startDate)}</b>
                        </span>

                        {/* 5. Ngày kết thúc */}
                        <span className="task-cell task-cell-date">
                          <b>{formatDate(task.endDate)}</b>
                        </span>

                        {/* 6. Ghi chú */}
                        <span className="task-cell task-cell-note" title={taskNote || "Chưa có ghi chú"}>
                          {taskNote ? <span>{taskNote}</span> : <span style={{ color: "#cbd5e1" }}>—</span>}
                        </span>

                        {/* 7. Liên kết */}
                        <span className="task-cell task-cell-links">
                          {task.predecessors.length > 0 ? (
                            <div className="link-chips-wrap">
                              {task.predecessors.map((dep) => (
                                <span
                                  key={dep.predecessorCode}
                                  className={`link-chip ${task.dependencyConflict ? "conflict" : ""}`}
                                  title={`Liên kết ${dep.type} từ ${dep.predecessorCode}${dep.lagDays ? ` (+${dep.lagDays} ngày)` : ""}`}
                                >
                                  {dep.predecessorCode} ({dep.type}{dep.lagDays ? `+${dep.lagDays}d` : ""})
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: "#cbd5e1" }}>—</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  {!visibleTasks.length && <div className="no-results">Không tìm thấy công việc phù hợp.</div>}
                </div>
                <footer className="grid-footer"><span>{visibleTasks.length}/{scheduled.length} công việc</span><span>{projectDependencyCount(activeProject)} liên kết</span></footer>
              </section>

              {selectedTask && (
                <aside className="detail-panel">
                  <header><span>CHI TIẾT CÔNG VIỆC</span><button aria-label="Đóng chi tiết" onClick={() => setSelectedCode("")}>Đóng</button></header>
                  {activeProject.isOfficialApproved && <div className="locked-banner" style={{ background: "#102d4b", color: "#9fe3d5" }}>🛡️ Baseline đã khóa · Cập nhật tiến độ thực tế bên dưới</div>}
                  <div className="detail-code">{selectedTask.code}</div><h2>{selectedTask.name}</h2><div className="detail-meta"><span>{GROUP_BY_CODE[selectedTask.groupCode]?.short}</span><b>{selectedTask.summary ? "Summary task" : "Task thực hiện"}</b></div>
                  
                  {!selectedTask.summary && (
                    <div style={{ margin: "14px 0", padding: "12px", background: "#f0f7f5", borderRadius: "8px", border: "1px solid #cce8e2" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "#167664" }}>Tiến độ thực tế:</span>
                        <b style={{ fontSize: "14px", color: "#167664" }}>{selectedTask.actualProgress}% ({selectedTask.actualStatus})</b>
                      </div>
                      <button type="button" className="primary-button" style={{ width: "100%", height: "32px", fontSize: "11px" }} onClick={() => openProgressModal(selectedTask)}>
                        Cập nhật % & Ngày thực tế
                      </button>
                    </div>
                  )}

                  <label className="field"><span>PIC phụ trách</span><input disabled={activeProject.baselineLocked} value={selectedTask.pic} onChange={(event) => updateTask(selectedTask.code, { pic: event.target.value })} placeholder="Nhập tên người phụ trách" /></label>
                  <label className="field"><span>Ngày bắt đầu (Kế hoạch)</span><input disabled={activeProject.baselineLocked || selectedTask.summary} type="date" value={selectedTask.startDate} max={selectedTask.endDate} onChange={(event) => updateTaskDates(selectedTask.code, event.target.value, selectedTask.endDate)} /></label>
                  <label className="field"><span>Ngày kết thúc (Kế hoạch)</span><input disabled={activeProject.baselineLocked || selectedTask.summary} type="date" value={selectedTask.endDate} min={selectedTask.startDate} onChange={(event) => updateTaskDates(selectedTask.code, selectedTask.startDate, event.target.value)} /></label>
                  <label className="field field-readonly"><span>Thời lượng kế hoạch</span><input readOnly value={`${selectedTask.duration} ngày làm việc`} /></label>
                  <DependencyPicker tasks={scheduled} selectedDependencies={selectedTask.predecessors} successorCode={selectedTask.code} disabled={activeProject.baselineLocked || selectedTask.summary} onChange={(dependencies) => updateTaskDependencies(selectedTask.code, dependencies)} />
                  {selectedTask.dependencyConflict && <div className="dependency-warning" role="alert"><b>Xung đột liên kết FS</b><span>{selectedTask.dependencyConflict}</span>{selectedTask.suggestedStartDate && <button type="button" onClick={() => updateTaskDates(selectedTask.code, selectedTask.suggestedStartDate!, dateAtWorkingOffset(selectedTask.suggestedStartDate!, selectedTask.duration - 1))}>Áp dụng ngày {formatDate(selectedTask.suggestedStartDate)}</button>}</div>}
                  <div className="detail-summary"><div><span>Bắt đầu</span><b>{formatDate(selectedTask.startDate)}</b></div><div><span>Kết thúc</span><b>{formatDate(selectedTask.endDate)}</b></div></div>
                  <p className="detail-note">{selectedTask.summary ? "Ngày của task tổng hợp được tự động lấy theo các công việc con." : activeProject.isOfficialApproved ? "Master Timeline chính thức đã khóa. Bấm 'Tạo bản điều chỉnh' nếu cần thay đổi kế hoạch cơ sở." : "Thay đổi được lưu tự động trên thiết bị cho dự án này."}</p>
                </aside>
              )}
            </div>
          </>
        )}
      </section>

      {contextMenu && contextTask && activeProject && <section className="task-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <header><span>{contextTask.code}</span><b>{contextTask.name}</b></header>
        <button disabled={contextTask.level >= 4 || activeProject.baselineLocked} onClick={() => { setContextMenu(null); openTaskCreator(true, contextTask, true); }}><i>+</i><span><b>Thêm công việc con</b><small>{contextTask.level >= 4 ? "Đã đạt WBS cấp 4" : `Tạo bên dưới ${contextTask.code}`}</small></span></button>
        <button onClick={() => { setSelectedCode(contextTask.code); setContextMenu(null); }}><i>…</i><span><b>Chỉnh sửa chi tiết</b><small>Mở bảng thông tin bên phải</small></span></button>
        {!contextTask.summary && <button onClick={() => { setContextMenu(null); openProgressModal(contextTask); }}><i>%</i><span><b>Cập nhật tiến độ</b><small>Nhập % hoàn thành thực tế</small></span></button>}
        <button className="context-danger" disabled={activeProject.baselineLocked} onClick={() => { setContextMenu(null); removeTaskFromProject(contextTask); }}><i>×</i><span><b>Xóa khỏi dự án</b><small>{contextTask.summary ? "Bao gồm các công việc con" : "Không xóa khỏi danh mục mẫu"}</small></span></button>
      </section>}

      {showEApprovalModal && (
        <div className="modal-backdrop" onMouseDown={() => setShowEApprovalModal(false)}>
          <form className="project-modal" style={{ maxWidth: "560px" }} onSubmit={submitEApproval} onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="status-badge" style={{ background: "#eaf8f4", color: "#167664" }}>XÁC NHẬN PHÊ DUYỆT MTL</span>
                <h2>Liên kết phê duyệt từ E-Approval</h2>
                <p>Khóa Kế hoạch cơ sở (Baseline) và đưa dự án vào Danh mục MTL đã duyệt để theo dõi tiến độ thực tế.</p>
              </div>
              <button type="button" onClick={() => setShowEApprovalModal(false)}>Đóng</button>
            </header>
            <div className="form-grid">
              <label className="field field-wide">
                <span>Dự án cần phê duyệt *</span>
                <select value={eApprovalForm.projectId} onChange={(e) => setEApprovalForm({ ...eApprovalForm, projectId: e.target.value })}>
                  <option value="">-- Chọn dự án --</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.code}] {p.name} {p.isOfficialApproved ? "(Đã duyệt)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Mã hồ sơ trình ký (E-Approval) *</span>
                <input required autoFocus value={eApprovalForm.code} onChange={(e) => setEApprovalForm({ ...eApprovalForm, code: e.target.value })} placeholder="vd: HS-EAPP-2026-08892 hoặc QĐ-NVL-2026/89" />
              </label>
              <label className="field">
                <span>Phiên bản Baseline</span>
                <input value={eApprovalForm.version} onChange={(e) => setEApprovalForm({ ...eApprovalForm, version: e.target.value })} placeholder="v1.0" />
              </label>
              <label className="field field-wide">
                <span>Đường dẫn (Link) E-Approval *</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input required style={{ flex: 1 }} type="url" value={eApprovalForm.url} onChange={(e) => setEApprovalForm({ ...eApprovalForm, url: e.target.value })} placeholder="https://eapproval.novaland.com.vn/document/..." />
                  {eApprovalForm.url && (
                    <a href={eApprovalForm.url} target="_blank" rel="noreferrer" className="secondary-button" style={{ height: "38px", display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 12px", textDecoration: "none", fontSize: "11px" }}>
                      Mở thử ↗
                    </a>
                  )}
                </div>
              </label>
              <label className="field">
                <span>Ngày phê duyệt chính thức</span>
                <input type="date" value={eApprovalForm.date} onChange={(e) => setEApprovalForm({ ...eApprovalForm, date: e.target.value })} />
              </label>
              <label className="field">
                <span>Cán bộ / Đơn vị xác nhận</span>
                <input value={eApprovalForm.signer} onChange={(e) => setEApprovalForm({ ...eApprovalForm, signer: e.target.value })} placeholder="PMD - Ban Quản lý Dự án" />
              </label>
              <label className="field field-wide">
                <span>Trích yếu / Quyết định phê duyệt</span>
                <textarea rows={3} value={eApprovalForm.note} onChange={(e) => setEApprovalForm({ ...eApprovalForm, note: e.target.value })} placeholder="Ghi chú nội dung phê duyệt, số quyết định của Ban Tổng Giám đốc..." />
              </label>
            </div>
            {eApprovalError && <div className="form-error" role="alert">{eApprovalError}</div>}
            <footer className="modal-actions-only">
              <button type="button" className="secondary-button" onClick={() => setShowEApprovalModal(false)}>Hủy</button>
              <button className="primary-button" type="submit">Xác nhận & Chốt Master Timeline</button>
            </footer>
          </form>
        </div>
      )}

      {showProgressModal && editingProgressTask && (
        <div className="modal-backdrop" onMouseDown={() => setShowProgressModal(false)}>
          <form className="project-modal" style={{ maxWidth: "520px" }} onSubmit={saveProgress} onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="status-badge">CẬP NHẬT TIẾN ĐỘ THỰC TẾ</span>
                <h2>{editingProgressTask.code} · {editingProgressTask.name}</h2>
                <p>Kế hoạch: {formatDate(editingProgressTask.startDate)} → {formatDate(editingProgressTask.endDate)} ({editingProgressTask.duration} ngày)</p>
              </div>
              <button type="button" onClick={() => setShowProgressModal(false)}>Đóng</button>
            </header>
            <div className="form-grid">
              <div className="field-wide" style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#102d4b" }}>% Hoàn thành thực tế</span>
                  <b style={{ fontSize: "18px", color: progressForm.progress === 100 ? "#2ea44f" : "#102d4b" }}>{progressForm.progress}%</b>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={progressForm.progress}
                  onChange={(e) => setProgressForm({ ...progressForm, progress: Number(e.target.value) })}
                  style={{ width: "100%", accentColor: progressForm.progress === 100 ? "#2ea44f" : "#168c72", cursor: "pointer" }}
                />
                <div style={{ display: "flex", gap: "6px", marginTop: "10px", justifyContent: "space-between" }}>
                  {[0, 25, 50, 75, 100].map((val) => (
                    <button
                      key={val}
                      type="button"
                      className="secondary-button"
                      style={{ height: "26px", padding: "0 8px", fontSize: "10.5px", background: progressForm.progress === val ? "#102d4b" : "#fff", color: progressForm.progress === val ? "#fff" : "#334e68" }}
                      onClick={() => setProgressForm({ ...progressForm, progress: val, actualEndDate: val === 100 ? (progressForm.actualEndDate || today) : progressForm.actualEndDate })}
                    >
                      {val === 100 ? "✓ 100% Hoàn thành" : `${val}%`}
                    </button>
                  ))}
                </div>
              </div>

              <label className="field">
                <span>Ngày bắt đầu thực tế</span>
                <input type="date" value={progressForm.actualStartDate} onChange={(e) => setProgressForm({ ...progressForm, actualStartDate: e.target.value })} />
              </label>
              <label className="field">
                <span>Ngày hoàn thành thực tế</span>
                <input type="date" value={progressForm.actualEndDate} onChange={(e) => setProgressForm({ ...progressForm, actualEndDate: e.target.value })} />
              </label>
              <label className="field field-wide">
                <span>Ghi chú tiến độ / Bằng chứng nghiệm thu</span>
                <textarea rows={3} value={progressForm.note} onChange={(e) => setProgressForm({ ...progressForm, note: e.target.value })} placeholder="Nhập lý do chậm trễ, biên bản nghiệm thu, link hồ sơ đính kèm..." />
              </label>
            </div>
            <footer className="modal-actions-only">
              <button type="button" className="secondary-button" onClick={() => setShowProgressModal(false)}>Hủy</button>
              <button className="primary-button" type="submit">Lưu tiến độ thực tế</button>
            </footer>
          </form>
        </div>
      )}

      {showCreate && (
        <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}>
          <form className="project-modal create-project-modal" onSubmit={createProject} onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <nav className="create-tabs" aria-label="Các bước tạo Master Timeline">
                {([
                  [1, "Thông tin dự án"],
                  [2, "Cấu hình và khởi tạo"],
                ] as const).map(([step, label]) => (
                  <div key={step} className={createStep === step ? "active" : createStep > step ? "done" : ""} aria-current={createStep === step ? "step" : undefined}>
                    <b>{createStep > step ? "✓" : step}</b>{label}
                  </div>
                ))}
              </nav>
              <button type="button" onClick={() => setShowCreate(false)}>Đóng</button>
            </header>

            <div className="form-grid" key={createStep}>
              {createStep === 1 && <section className="create-slide field-wide" aria-label="Thông tin dự án">
              <div className="create-section-title">1. Nhận diện Master Timeline</div>
              <label className="field field-wide">
                <span>Tên dự án *</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Ví dụ: Aqua City - Đảo Phượng Hoàng"
                />
              </label>

              <label className="field">
                <span>Mã dự án *</span>
                <input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="Ví dụ: NVL-AQH-2026"
                />
              </label>

              <label className="field">
                <span>Phiên bản Master Timeline</span>
                <input
                  value={form.version ?? "v1.0"}
                  onChange={(event) => setForm({ ...form, version: event.target.value })}
                  placeholder="Ví dụ: v1.0"
                />
              </label>

              <div className="create-section-title">2. Phân loại và phạm vi quản lý</div>
              <label className="field">
                <span>Vùng quản lý *</span>
                <select
                  value={form.region || "Vùng Hồ Chí Minh 1"}
                  onChange={(event) => setForm({ ...form, region: event.target.value })}
                >
                  <option value="Vùng Đồng Nai 1">Vùng Đồng Nai 1</option>
                  <option value="Vùng Phan Thiết 1">Vùng Phan Thiết 1</option>
                  <option value="Vùng Hồ Chí Minh 1">Vùng Hồ Chí Minh 1</option>
                  <option value="Vùng Hồ Tràm 1">Vùng Hồ Tràm 1</option>
                </select>
              </label>

              <label className="field">
                <span>Nhóm dự án</span>
                <select
                  value={form.group}
                  onChange={(event) => setForm({ ...form, group: event.target.value })}
                >
                  <option>Nhóm 1 (Đang nghiên cứu)</option>
                  <option>Nhóm 2 (Đã mua đang thiết kế)</option>
                  <option>Nhóm 3 (Đang xây dựng)</option>
                  <option>Nhóm 4 (Đã bàn giao khách hàng)</option>
                  <option>Nhóm 5 (Thoái vốn)</option>
                </select>
              </label>

              <label className="field">
                <span>Khu vực / Phân khu</span>
                <input value={form.area || ""} onChange={(event) => setForm({ ...form, area: event.target.value })} placeholder="Ví dụ: Phân khu Phoenix" />
              </label>

              <label className="field field-wide">
                <span>Chủ đầu tư (Pháp nhân)</span>
                <input
                  value={form.investor || ""}
                  onChange={(event) => setForm({ ...form, investor: event.target.value })}
                  placeholder="Ví dụ: Tập đoàn Novaland / Công ty TNHH BĐS Đà Lạt Valley"
                />
              </label>

              <label className="field field-wide">
                <span>Địa điểm dự án</span>
                <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ví dụ: Biên Hòa, Đồng Nai" />
              </label>

              </section>}

              {createStep === 2 && <section className="create-slide field-wide" aria-label="Cấu hình và khởi tạo">
                <div className="create-section-title">Tham số dự án</div>
                <label className="field field-wide">
                  <span>1. Loại hình dự án & Sản phẩm</span>
                  <select value={form.parameters.loaiHinhDuAn} onChange={(event) => {
                    const value = event.target.value as ProjectParameters["loaiHinhDuAn"];
                    setForm((current) => ({ ...current, type: value, parameters: { ...current.parameters, loaiHinhDuAn: value } }));
                  }}>
                    <option>Chung cư cao tầng</option><option>Thấp tầng/Biệt thự</option><option>Khu đô thị phức hợp</option><option>Khách sạn/Nghỉ dưỡng</option>
                  </select>
                </label>
                <div className="parameter-pair field-wide">
                  <label className="field"><span>2. Diện tích đất</span><div className="input-with-unit"><input type="number" min="1" value={form.parameters.dienTichDat} onChange={(event) => updateProjectParameter("dienTichDat", Number(event.target.value))} /><select value={form.parameters.donViDienTichDat} onChange={(event) => updateProjectParameter("donViDienTichDat", event.target.value as ProjectParameters["donViDienTichDat"])}><option>m²</option><option>ha</option></select></div></label>
                  <label className="field"><span>Tổng diện tích sàn GFA (m²)</span><input type="number" min="1" step="1" value={form.parameters.gfa} onChange={(event) => updateProjectParameter("gfa", Number(event.target.value))} /></label>
                </div>
                <label className="field"><span>3. Số phân kỳ / Giai đoạn</span><input type="number" min="1" max="20" value={form.parameters.soPhanKy} onChange={(event) => updateProjectParameter("soPhanKy", Number(event.target.value))} /></label>
                {form.parameters.loaiHinhDuAn === "Thấp tầng/Biệt thự" ? (
                  <label className="field"><span>4. Số căn thấp tầng</span><input type="number" min="1" max="10000" value={form.parameters.soCanThapTang} onChange={(event) => updateProjectParameter("soCanThapTang", Number(event.target.value))} /></label>
                ) : <>
                  <label className="field"><span>4. Số Tháp / Block / Phân khu</span><input type="number" min="1" max="26" value={form.parameters.soThapBlock} onChange={(event) => updateProjectParameter("soThapBlock", Number(event.target.value))} /></label>
                  <label className="field"><span>5. Số tầng hầm</span><select value={form.parameters.soTangHam} onChange={(event) => updateProjectParameter("soTangHam", Number(event.target.value) as ProjectParameters["soTangHam"])}><option value={0}>0 hầm</option><option value={1}>1 hầm</option><option value={2}>2 hầm</option><option value={3}>3+ hầm</option></select></label>
                  <label className="field"><span>6. Số tầng nổi cao nhất</span><input type="number" min="1" max="120" value={form.parameters.soTangNoi} onChange={(event) => updateProjectParameter("soTangNoi", Number(event.target.value))} /></label>
                </>}
                <div className="create-section-title">6 mốc chính của dự án</div>
                <label className="field">
                  <span>1. Ngày bắt đầu</span>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
                    aria-label="1. Ngày bắt đầu"
                    required
                  />
                </label>
                {CORE_MILESTONE_CODES.map((code, index) => {
                  const milestone = KEY_MILESTONES.find((item) => item.code === code)!;
                  return <label className="field" key={code}>
                    <span>{index + 2}. {milestone.name}</span>
                    <input type="date" value={form.milestoneDates[code] ?? ""} onChange={(event) => setForm((current) => ({ ...current, milestoneDates: { ...current.milestoneDates, [code]: event.target.value } }))} aria-label={`${code} · ${milestone.name}`} />
                  </label>;
                })}
              <details className="create-options field-wide">
              <summary>Nhập từ Microsoft Project</summary>
              <div className="field field-wide">
                <div className="file-upload-box">
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#334155" }}>Tệp .xml (tùy chọn) {xmlData && <em style={{ color: "#167461", fontStyle: "normal" }}>· ✓ {xmlData.customTasks.length} công việc</em>}</span>
                  <input type="file" accept=".xml" onChange={handleXMLUpload} className="file-input-styled" />
                </div>
              </div>
              </details>
              <details className="create-options field-wide">
              <summary>{parameterPreview.tasks.length} công việc · Xem tiến độ dự kiến</summary>
              <div className="parameter-summary field-wide">
                <div><b>{parameterPreview.tasks.length}</b><span>Task sau khởi tạo</span></div>
                <div><b>+{parameterPreview.generatedTaskCount}</b><span>Task được sinh thêm</span></div>
                <div><b>-{parameterPreview.removedTaskCount}</b><span>Task được lược bỏ</span></div>
                <div><b>{parameterPreview.recalculatedTaskCount}</b><span>Duration tính lại</span></div>
              </div>
              <div className="impact-list field-wide">
                {parameterPreview.impacts.filter((impact) => !["PARAM_HIEN_TRANG_DAT", "PARAM_MOC_PHAP_LY_DAU", "PARAM_NGHIA_VU_TAI_CHINH"].includes(impact.parameter)).map((impact) => <article key={impact.parameter} title={impact.detail}><div><b>{impact.title}</b></div><span>{impact.affectedTasks} task</span></article>)}
              </div>
              <div className="create-section-title">Tiến độ mẫu</div>
              <div className="milestone-input-list field-wide">
                <div className="milestone-preview-card">
                  <span><b>1. Ngày bắt đầu</b><em>Khởi tạo</em></span>
                  <strong>{formatDate(form.startDate)}</strong>
                </div>
                {CORE_MILESTONE_CODES.map((code, index) => {
                  const milestone = KEY_MILESTONES.find((item) => item.code === code)!;
                  return <div className="milestone-preview-card" key={code}><span><b>{index + 2}. {milestone.name}</b><em>{milestonePreview.milestoneSources[code] === "manual" ? "Đã nhập" : "Giả định"}</em></span><strong>{formatDate(milestonePreview.milestoneDates[code])}</strong></div>;
                })}
              </div>
              </details>
              </section>}
            </div>

            {formError && <div className="form-error" role="alert">{formError}</div>}

            <footer>
              {createStep === 1 ? <button key="cancel" type="button" className="secondary-button" onClick={() => setShowCreate(false)}>Hủy</button> : <button key="back" type="button" className="secondary-button" onClick={() => { setFormError(""); setCreateStep(1); }}>Quay lại</button>}
              {/* key riêng để React không tái sử dụng nút "Tiếp tục" thành nút submit ngay trong cùng cú click. */}
              {createStep === 1 ? <button key="continue" className="primary-button" type="button" onClick={(event) => { event.preventDefault(); continueCreateProject(); }}>Tiếp tục</button> : <button key="submit" className="primary-button" type="submit" style={{ background: "#73b52d", borderColor: "#64a024" }}>Tạo Master Timeline</button>}
            </footer>
          </form>
        </div>
      )}

      {showTaskModal && <div className="modal-backdrop" onMouseDown={() => { setShowTaskModal(false); setInsertAnchor(null); }}>
        <form className="project-modal task-modal" onSubmit={addCatalogTask} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>{insertAnchor ? `THÊM TẠI WBS ${insertAnchor.code}` : "CẤU TRÚC MASTER TIMELINE"}</span><h2>Thêm công việc mới</h2><p>{insertAnchor ? `Mã và WBS cha đã được gợi ý theo vị trí “${insertAnchor.name}”.` : "Công việc được lưu vào danh mục dùng chung cho các dự án sau."}</p></div><button type="button" onClick={() => { setShowTaskModal(false); setInsertAnchor(null); }}>Đóng</button></header>
          <div className="form-grid">
            <label className="field"><span>Nhóm / Đơn vị *</span><select value={taskForm.groupCode} onChange={(event) => setTaskForm({ ...taskForm, groupCode: event.target.value, parentCode: event.target.value, code: `${event.target.value}.` })}>{GROUPS.map((group) => <option key={group.code} value={group.code}>{group.code} · {group.short} · {group.name}</option>)}</select></label>
            <label className="field"><span>WBS cha</span><input value={taskForm.parentCode} onChange={(event) => setTaskForm({ ...taskForm, parentCode: event.target.value })} placeholder={taskForm.groupCode} /></label>
            <label className="field"><span>Mã WBS *</span><input autoFocus value={taskForm.code} onChange={(event) => setTaskForm({ ...taskForm, code: event.target.value })} placeholder={`${taskForm.groupCode}.99`} /></label>
            <label className="field"><span>Trạng thái</span><select value={taskForm.status} onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value as TaskForm["status"] })}><option>Đang thực hiện</option><option>Đóng</option><option>Hoàn thành</option></select></label>
            <label className="field field-wide"><span>Tên công việc *</span><input value={taskForm.name} onChange={(event) => setTaskForm({ ...taskForm, name: event.target.value })} placeholder="Nhập tên công việc" /></label>
            <label className="field"><span>Ngày bắt đầu *</span><input type="date" value={taskForm.startDate} max={taskForm.endDate} onChange={(event) => setTaskForm({ ...taskForm, startDate: event.target.value, endDate: event.target.value > taskForm.endDate ? event.target.value : taskForm.endDate })} /></label>
            <label className="field"><span>Ngày kết thúc *</span><input type="date" value={taskForm.endDate} min={taskForm.startDate} onChange={(event) => setTaskForm({ ...taskForm, endDate: event.target.value })} /></label>
            <label className="field field-readonly"><span>Thời lượng tự tính</span><input readOnly value={taskFormDuration > 0 ? `${taskFormDuration} ngày làm việc` : "Không có ngày làm việc"} /></label>
            {activeProject && taskForm.addToCurrent && <div className="field-wide"><DependencyPicker tasks={scheduled} selectedDependencies={taskForm.predecessorCodes.map((predecessorCode) => ({ predecessorCode, type: "FS", lagDays: 0 }))} successorCode={taskForm.code} onChange={(dependencies) => setTaskForm({ ...taskForm, predecessorCodes: dependencies.map((dependency) => dependency.predecessorCode) })} /></div>}
            {taskFormDependencyWarning && <div className="dependency-warning field-wide" role="alert"><b>Xung đột liên kết FS</b><span>{taskFormDependencyWarning}</span><button type="button" onClick={() => setTaskForm({ ...taskForm, startDate: taskFormSuggestedStartDate, endDate: dateAtWorkingOffset(taskFormSuggestedStartDate, Math.max(0, taskFormDuration - 1)) })}>Áp dụng ngày {formatDate(taskFormSuggestedStartDate)}</button></div>}
            {activeProject && <label className="check-line field-wide"><input type="checkbox" checked={taskForm.addToCurrent} onChange={(event) => setTaskForm({ ...taskForm, addToCurrent: event.target.checked, predecessorCodes: event.target.checked ? taskForm.predecessorCodes : [] })} /><span>Đồng thời thêm vào dự án <b>{activeProject.code}</b></span></label>}
          </div>
          {formError && <div className="form-error" role="alert">{formError}</div>}
          <footer><div><b>1</b><span> task mới · {taskFormDuration} ngày làm việc</span></div><button type="button" className="secondary-button" onClick={() => { setShowTaskModal(false); setInsertAnchor(null); }}>Hủy</button><button className="primary-button" type="submit">{insertAnchor ? "Thêm tại vị trí" : "Thêm vào danh mục"}</button></footer>
        </form>
      </div>}

      {showDelete && activeProject && (
        <div className="modal-backdrop" onMouseDown={() => setShowDelete(false)}>
          <section className="confirm-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="confirm-modal-icon">
              <IconTrash />
            </div>
            <h2>Xác nhận xóa dự án?</h2>
            <p>
              Toàn bộ chỉnh sửa WBS và dữ liệu tiến độ của dự án này trên hệ thống sẽ bị xóa vĩnh viễn.
            </p>
            <div className="confirm-modal-project-badge">
              <b>{activeProject.code}</b> — {activeProject.name}
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-modal-cancel"
                onClick={() => setShowDelete(false)}
              >
                Hủy bỏ (Giữ lại)
              </button>
              <button
                type="button"
                className="confirm-modal-delete"
                onClick={deleteProject}
              >
                Xóa dự án
              </button>
            </div>
          </section>
        </div>
      )}

      {projectToDelete && (
        <div className="modal-backdrop" onMouseDown={() => setProjectToDelete(null)}>
          <section className="confirm-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="confirm-modal-icon">
              <IconTrash />
            </div>
            <h2>Xác nhận xóa dự án?</h2>
            <p>
              Bạn có chắc chắn muốn xóa dự án này? Toàn bộ cây công việc WBS và tiến độ Master Timeline liên quan sẽ bị xóa khỏi hệ thống.
            </p>
            <div className="confirm-modal-project-badge">
              <b>{projectToDelete.code}</b> — {projectToDelete.name}
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-modal-cancel"
                onClick={() => setProjectToDelete(null)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="confirm-modal-delete"
                onClick={() => deleteProjectById(projectToDelete.id)}
              >
                Xóa dự án
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><b>Hoàn tất</b><span>{toast}</span></div>}
    </main>
  );
}

