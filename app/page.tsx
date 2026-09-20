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
  scheduleStatus?: "in_progress" | "completed";
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
  { code: "9.8", short: "IDD", name: "Phòng Thiết kế Nội bộ", role: "indirect", scope: "9 phòng ban" },
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
const SORTED_TEMPLATE = [...TEMPLATE].sort((a, b) => (GROUP_ORDER[a.groupCode] ?? 99) - (GROUP_ORDER[b.groupCode] ?? 99) || a.code.localeCompare(b.code, undefined, { numeric: true }));
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
  area: "",
  region: "Đồng Nai 1",
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
    scheduleStatus: "completed",
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
    scheduleStatus: "in_progress",
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
    scheduleStatus: "in_progress",
    approvalStatus: "draft",
    isOfficialApproved: false,
    officialVersion: "v1.0",
    designTaskStatus: "dang_lap",
    fsStatus: "dang_tinh_toan",
    startDate: "2026-07-01",
    targetDate: "2027-12-31",
  }
];

function isScheduleCompleted(project?: Partial<Project> | null): boolean {
  if (!project) return false;
  if (project.scheduleStatus === "completed") return true;
  if (project.scheduleStatus === "in_progress") return false;
  return Boolean(project.isOfficialApproved || project.approvalStatus === "approved");
}

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
    taskDependencies: project.taskDependencies && Object.keys(project.taskDependencies).length > 50
      ? project.taskDependencies
      : defaultDependenciesForCodes(includedTaskCodes),
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
    scheduleStatus: project.scheduleStatus ?? (isOfficial || project.approvalStatus === "approved" ? "completed" : "in_progress"),
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
  if (!start || !end) return 0;
  const [startYear, startMonth, startDay] = start.slice(0, 10).split("-").map(Number);
  const [endYear, endMonth, endDay] = end.slice(0, 10).split("-").map(Number);
  if (isNaN(startYear) || isNaN(endYear)) return 0;
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

function interpolateDate(start: string, end: string, fraction: number): string {
  if (!start || !end) return start || end || "";
  const startMs = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const endMs = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  if (isNaN(startMs) || isNaN(endMs)) return start;
  const targetMs = startMs + (endMs - startMs) * Math.max(0, Math.min(1, fraction));
  return new Date(targetMs).toISOString().slice(0, 10);
}

function getProjectLifecycleWindows(startDate: string, targetDate: string, milestoneDates?: MilestoneDates) {
  const pStart = startDate || today;
  const pEnd = targetDate && targetDate > pStart ? targetDate : dateAtOffset(pStart, 365);

  const mGroundbreaking = (milestoneDates?.["MILE_PCD_01"] && milestoneDates["MILE_PCD_01"] > pStart && milestoneDates["MILE_PCD_01"] < pEnd)
    ? milestoneDates["MILE_PCD_01"]
    : interpolateDate(pStart, pEnd, 0.28);

  const mSales = (milestoneDates?.["MILE_COM_02"] && milestoneDates["MILE_COM_02"] > pStart && milestoneDates["MILE_COM_02"] < pEnd)
    ? milestoneDates["MILE_COM_02"]
    : interpolateDate(pStart, pEnd, 0.42);

  const mFinish = interpolateDate(mGroundbreaking, pEnd, 0.82);

  const mHandover = (milestoneDates?.["MILE_OM_02"] && milestoneDates["MILE_OM_02"] > mFinish && milestoneDates["MILE_OM_02"] < pEnd)
    ? milestoneDates["MILE_OM_02"]
    : interpolateDate(mFinish, pEnd, 0.65);

  const windows: Record<string, [string, string]> = {
    "4.0": [pStart, pEnd],
    "4.1": [pStart, mHandover],
    "4.2": [pStart, mGroundbreaking],
    "4.3": [mGroundbreaking, mFinish],
    "4.4": [mFinish, pEnd],
    "9.1": [pStart, mGroundbreaking],
    "9.2": [pStart, pEnd],
    "9.3": [mSales, pEnd],
    "9.4": [interpolateDate(pStart, mSales, 0.5), mFinish],
    "9.5": [interpolateDate(pStart, mGroundbreaking, 0.4), mFinish],
    "9.6": [interpolateDate(pStart, mGroundbreaking, 0.3), mFinish],
    "9.7": [pStart, pEnd],
    "9.8": [pStart, mGroundbreaking],
    "9.9": [pStart, mGroundbreaking],
  };

  return { pStart, pEnd, mGroundbreaking, mSales, mFinish, mHandover, windows };
}

function generateCalibratedTaskEdits(project: Project): Record<string, TaskEdit> {
  const { pStart, pEnd, windows } = getProjectLifecycleWindows(project.startDate, project.targetDate, project.milestoneDates);
  const totalProjectWorkingDays = Math.max(10, workingDaysBetween(pStart, pEnd));
  const timeScale = Math.min(1.2, Math.max(0.15, totalProjectWorkingDays / 600));

  const allTasks = allProjectTasks(project);
  const edits: Record<string, TaskEdit> = { ...(project.taskEdits || {}) };

  const leafTasks = allTasks.filter((task) => {
    const isParent = task.summary || allTasks.some((other) => other.code !== task.code && other.code.startsWith(`${task.code}.`));
    return !isParent;
  });

  const byGroup = new Map<string, typeof leafTasks>();
  leafTasks.forEach((task) => {
    byGroup.set(task.groupCode, [...(byGroup.get(task.groupCode) ?? []), task]);
  });

  byGroup.forEach((groupTasks, groupCode) => {
    const [wStart, wEnd] = windows[groupCode] ?? [pStart, pEnd];
    const wWorkingDays = Math.max(5, workingDaysBetween(wStart, wEnd));
    const gCount = Math.max(1, groupTasks.length);

    groupTasks.forEach((task, index) => {
      if (task.workGroup === "Báo cáo định kỳ") return;

      const existing = edits[task.code];
      const isKeyMilestone = /\.MILE_(?:PLP|PCD|COM|OM)_\d+$/.test(task.code);

      if (existing?.startDate && existing?.endDate) {
        let clampedStart = existing.startDate < pStart ? pStart : existing.startDate;
        let clampedEnd = existing.endDate > pEnd ? pEnd : existing.endDate;
        if (clampedEnd < clampedStart) clampedEnd = clampedStart;
        edits[task.code] = {
          ...existing,
          startDate: clampedStart,
          endDate: clampedEnd,
          duration: isKeyMilestone ? 0 : Math.max(1, workingDaysBetween(clampedStart, clampedEnd)),
        };
        return;
      }

      const offsetFraction = index / gCount;
      const offsetWorkingDays = Math.floor(offsetFraction * Math.max(0, wWorkingDays - 4) * 0.85);
      let taskStart = dateAtWorkingOffset(wStart, offsetWorkingDays);
      if (taskStart < pStart) taskStart = pStart;
      if (taskStart >= pEnd) taskStart = dateAtOffset(pEnd, -3);

      let taskEnd = taskStart;
      let duration = 0;

      if (isKeyMilestone) {
        duration = 0;
        taskEnd = taskStart;
      } else {
        const rawDur = task.defaultDuration > 0 ? task.defaultDuration : 10;
        const scaledDur = Math.max(1, Math.round(rawDur * timeScale));
        const tentativeEnd = dateAtWorkingOffset(taskStart, scaledDur - 1);
        taskEnd = tentativeEnd <= wEnd ? tentativeEnd : wEnd;
        if (taskEnd > pEnd) taskEnd = pEnd;
        if (taskEnd < taskStart) taskEnd = taskStart;
        duration = Math.max(1, workingDaysBetween(taskStart, taskEnd));
      }

      edits[task.code] = {
        ...(existing || {}),
        startDate: taskStart,
        endDate: taskEnd,
        duration,
      };
    });
  });

  return edits;
}

function taskStatusClass(status: NonNullable<TaskEdit["status"]>) {
  if (status === "Hoàn thành") return "confirmed";
  if (status === "Đang thực hiện") return "working";
  return "closed";
}

function allProjectTasks(project: Project) {
  if (!project.customTasks || project.customTasks.length === 0) {
    return SORTED_TEMPLATE;
  }
  const customCodes = new Set(project.customTasks.map((task) => task.code));
  return [...SORTED_TEMPLATE.filter((task) => !customCodes.has(task.code)), ...project.customTasks].sort((a, b) => (GROUP_ORDER[a.groupCode] ?? 99) - (GROUP_ORDER[b.groupCode] ?? 99) || a.code.localeCompare(b.code, undefined, { numeric: true }));
}

interface ScheduleCacheEntry {
  date: string;
  startDate: string;
  targetDate: string;
  editCount: number;
  customTaskCount: number;
  result: ScheduledTask[];
}
const scheduleCache = new WeakMap<Project, ScheduleCacheEntry>();

function scheduleTasks(project: Project): ScheduledTask[] {
  const today = new Date().toISOString().slice(0, 10);
  const editCount = Object.keys(project.taskEdits || {}).length;
  const customTaskCount = project.customTasks?.length || 0;
  const cached = scheduleCache.get(project);
  if (
    cached &&
    cached.date === today &&
    cached.startDate === project.startDate &&
    cached.targetDate === project.targetDate &&
    cached.editCount === editCount &&
    cached.customTaskCount === customTaskCount
  ) {
    return cached.result;
  }

  const selected = GROUPS.filter((group) => project.selectedGroups.includes(group.code));
  const source = allProjectTasks(project);
  const totalDays = daysBetween(project.startDate, project.targetDate);
  const { pStart, pEnd, windows } = getProjectLifecycleWindows(project.startDate, project.targetDate, project.milestoneDates);
  const totalProjectWorkingDays = Math.max(10, workingDaysBetween(pStart, pEnd));
  const timeScale = Math.min(1.2, Math.max(0.15, totalProjectWorkingDays / 600));

  // Pre-calculate parent codes and non-summary group info in O(N)
  const sourceParentCodes = new Set<string>();
  const nonSummaryByGroup = new Map<string, number>();
  const indexInGroupByCode = new Map<string, number>();

  for (const item of source) {
    if (item.summary) {
      sourceParentCodes.add(item.code);
    }
    let dot = item.code.lastIndexOf(".");
    let prefix = item.code;
    while (dot > 0) {
      prefix = prefix.slice(0, dot);
      sourceParentCodes.add(prefix);
      dot = prefix.lastIndexOf(".");
    }

    if (!item.summary) {
      const currentCount = nonSummaryByGroup.get(item.groupCode) ?? 0;
      indexInGroupByCode.set(item.code, currentCount);
      nonSummaryByGroup.set(item.groupCode, currentCount + 1);
    }
  }

  const includedCodes = new Set(project.includedTaskCodes);
  const tasks = source.filter((task) => includedCodes.has(task.code)).map((task) => {
    const isParent = task.summary || sourceParentCodes.has(task.code);
    const isBaoCao = task.workGroup === "Báo cáo định kỳ";
    const edit = project.taskEdits[task.code] ?? {};
    const isKeyMilestone = /\.MILE_(?:PLP|PCD|COM|OM)_\d+$/.test(task.code);

    let startDate = "";
    let endDate = "";
    let duration = 0;

    if (isParent) {
      // Công việc cấp cha: sẽ tổng hợp từ các công việc con bên trong
      startDate = "";
      endDate = "";
      duration = 0;
    } else if (isBaoCao) {
      // Công việc mà Loại công việc là "Báo cáo định kỳ" thì khi khởi tạo sẽ không có Thời gian thực hiện / Ngày bắt đầu / Ngày kết thúc
      if (edit.startDate && edit.endDate) {
        startDate = edit.startDate;
        endDate = edit.endDate;
        duration = edit.duration ?? (edit.startDate && edit.endDate ? Math.max(1, workingDaysBetween(edit.startDate, edit.endDate)) : 0);
      } else {
        startDate = "";
        endDate = "";
        duration = 0;
      }
    } else {
      // Chỉ những công việc mà Loại công việc là "Tracking công việc" (hoặc công việc lá thực hiện) thì mới có thông tin
      if (edit.startDate && edit.endDate) {
        startDate = edit.startDate;
        endDate = edit.endDate;
        duration = isKeyMilestone ? 0 : (edit.duration ?? Math.max(1, workingDaysBetween(startDate, endDate)));
      } else {
        const [wStart, wEnd] = windows[task.groupCode] ?? [pStart, pEnd];
        const groupCount = nonSummaryByGroup.get(task.groupCode) ?? 1;
        const indexInGroup = indexInGroupByCode.get(task.code) ?? 0;
        const wWorkingDays = Math.max(5, workingDaysBetween(wStart, wEnd));
        const offsetWorkingDays = Math.floor((indexInGroup / Math.max(1, groupCount)) * Math.max(0, wWorkingDays - 4) * 0.85);

        startDate = edit.startDate ?? dateAtWorkingOffset(wStart, offsetWorkingDays);
        if (startDate < pStart) startDate = pStart;
        if (startDate >= pEnd) startDate = dateAtOffset(pEnd, -3);

        if (isKeyMilestone) {
          duration = 0;
          endDate = startDate;
        } else {
          const rawDur = task.defaultDuration > 0 ? task.defaultDuration : 10;
          const scaledDur = Math.max(1, Math.round(rawDur * timeScale));
          const tentativeEnd = dateAtWorkingOffset(startDate, scaledDur - 1);
          endDate = tentativeEnd <= wEnd ? tentativeEnd : wEnd;
          if (endDate > pEnd) endDate = pEnd;
          if (endDate < startDate) endDate = startDate;
          duration = Math.max(1, workingDaysBetween(startDate, endDate));
        }
      }

      // STRICT CLAMPING: Gói gọn tuyệt đối trong [project.startDate, project.targetDate]
      if (startDate < project.startDate) startDate = project.startDate;
      if (endDate > project.targetDate) {
        endDate = project.targetDate;
        if (!isKeyMilestone) {
          duration = Math.max(1, workingDaysBetween(startDate, endDate));
        }
      }
      if (endDate < startDate) endDate = startDate;
    }

    const hasDates = Boolean(startDate && endDate && (duration > 0 || isKeyMilestone));
    const startOffset = hasDates ? Math.max(0, rawDaysBetween(project.startDate, startDate)) : 0;

    const actualProgress = edit.actualProgress !== undefined ? edit.actualProgress : (edit.status === "Hoàn thành" ? 100 : (edit.status === "Đang thực hiện" ? 30 : 0));
    const actualStartDate = edit.actualStartDate ?? (actualProgress > 0 && startDate ? startDate : undefined);
    const actualEndDate = edit.actualEndDate ?? (actualProgress === 100 && endDate ? endDate : undefined);

    let actualStatus: "Chưa bắt đầu" | "Đang thực hiện" | "Hoàn thành" | "Trễ hạn" = "Chưa bắt đầu";
    if (actualProgress === 100 || edit.status === "Hoàn thành") {
      actualStatus = "Hoàn thành";
    } else if (hasDates && endDate < today && actualProgress < 100) {
      actualStatus = "Trễ hạn";
    } else if (actualProgress > 0 || (hasDates && startDate <= today && endDate >= today)) {
      actualStatus = "Đang thực hiện";
    }

    const leftPercent = hasDates ? Math.min(98, (startOffset / totalDays) * 100) : 0;
    const maxAllowedWidth = Math.max(0, 100 - leftPercent);
    const rawWidth = hasDates ? (duration / totalDays) * 100 : 0;
    const widthPercent = hasDates ? Math.max(0.7, Math.min(maxAllowedWidth, rawWidth)) : 0;

    return {
      ...task,
      startDate,
      endDate,
      duration,
      left: leftPercent,
      width: widthPercent,
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

  // Pre-index descendants by parent prefix in O(N)
  const descendantsByParent = new Map<string, typeof tasks>();
  for (const candidate of tasks) {
    let dot = candidate.code.lastIndexOf(".");
    let prefix = candidate.code;
    while (dot > 0) {
      prefix = prefix.slice(0, dot);
      let list = descendantsByParent.get(prefix);
      if (!list) {
        list = [];
        descendantsByParent.set(prefix, list);
      }
      list.push(candidate);
      dot = prefix.lastIndexOf(".");
    }
  }

  const rolledUp = tasks.map((task) => {
    const descendants = descendantsByParent.get(task.code);
    const isParent = task.summary || Boolean(descendants && descendants.length > 0);
    if (!isParent || !descendants || !descendants.length) return task;

    // Tổng hợp ngày của các công việc con bên trong (chỉ lấy các công việc con có ngày hợp lệ)
    const datedDescendants = descendants.filter((c) => Boolean(c.startDate && c.endDate));
    const nonSummaryDated = datedDescendants.filter((c) => !c.summary);

    if (datedDescendants.length > 0) {
      const startDate = datedDescendants.reduce(
        (earliest, candidate) => (!earliest || candidate.startDate < earliest ? candidate.startDate : earliest),
        datedDescendants[0].startDate
      );
      const endDate = datedDescendants.reduce(
        (latest, candidate) => (!latest || candidate.endDate > latest ? candidate.endDate : latest),
        datedDescendants[0].endDate
      );
      const duration = Math.max(1, workingDaysBetween(startDate, endDate));
      const actualProgress = nonSummaryDated.length
        ? Math.round(nonSummaryDated.reduce((sum, c) => sum + c.actualProgress, 0) / nonSummaryDated.length)
        : task.actualProgress;
      let actualStatus = task.actualStatus;
      if (actualProgress === 100) actualStatus = "Hoàn thành";
      else if (endDate < today && actualProgress < 100) actualStatus = "Trễ hạn";
      else if (actualProgress > 0) actualStatus = "Đang thực hiện";

      return {
        ...task,
        summary: true,
        startDate,
        endDate,
        duration,
        actualProgress,
        actualStatus,
      };
    }

    // Nếu không có công việc con nào có ngày (ví dụ chỉ có Báo cáo định kỳ chưa có ngày)
    return {
      ...task,
      summary: true,
      startDate: "",
      endDate: "",
      duration: 0,
      actualProgress: 0,
      actualStatus: "Chưa bắt đầu",
    };
  });

  const byCode = new Map(rolledUp.map((task) => [task.code, task]));

  const finalTasks = rolledUp.map((task) => {
    const missingCodes: string[] = [];
    const requirements = task.predecessors.flatMap((dependency) => {
      const predecessor = byCode.get(dependency.predecessorCode);
      if (!predecessor) {
        missingCodes.push(dependency.predecessorCode);
        return [];
      }
      if (!predecessor.startDate || !predecessor.endDate || !task.startDate) {
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
    const hasDates = Boolean(task.startDate && task.endDate && (task.duration > 0 || /\.MILE_/.test(task.code)));
    const startOffset = hasDates ? Math.max(0, rawDaysBetween(project.startDate, task.startDate)) : 0;
    return {
      ...task,
      left: hasDates ? Math.min(98, (startOffset / totalDays) * 100) : 0,
      width: hasDates ? Math.max(0.7, Math.min(100, (Math.max(1, rawDaysBetween(task.startDate, task.endDate) + 1) / totalDays) * 100)) : 0,
      dependencyConflict: conflict || undefined,
      suggestedStartDate: suggestedStartDate || undefined,
    };
  });

  scheduleCache.set(project, {
    date: today,
    startDate: project.startDate,
    targetDate: project.targetDate,
    editCount,
    customTaskCount,
    result: finalTasks,
  });

  return finalTasks;
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

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
  const isCompleted = project.approvalStatus === "approved" || Boolean(project.isOfficialApproved);
  return isCompleted ? "ĐÃ HOÀN THIỆN" : "ĐANG HOÀN THIỆN";
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
      ${task.startDate && task.endDate ? `<Start>${task.startDate}T08:00:00</Start><Finish>${task.endDate}T${isKeyMilestone ? "08:00:00" : "17:00:00"}</Finish><Duration>PT${task.duration * 8}H0M0S</Duration>` : `<Duration>PT0H0M0S</Duration>`}<DurationFormat>7</DurationFormat>
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
  const [initArea, setInitArea] = useState("Đồng Nai 1");
  const [initRegion, setInitRegion] = useState("Đồng Nai 1");
  const [initProjectType, setInitProjectType] = useState("Nhà ở thấp tầng");
  const [initStartDate, setInitStartDate] = useState(today);
  const [initGroundbreakingDate, setInitGroundbreakingDate] = useState("");
  const [initSalesStartDate, setInitSalesStartDate] = useState("");
  const [initHandoverDate, setInitHandoverDate] = useState("");
  const [initEndDate, setInitEndDate] = useState("2028-12-31");
  const [initTemplateSearch, setInitTemplateSearch] = useState("");
  const [initSelectedApprovedProjectId, setInitSelectedApprovedProjectId] = useState<string>("proj-aqua-city-phoenix");
  const [initSelectedVersion, setInitSelectedVersion] = useState<string>("v1.0");
  const [initNewVersionCode, setInitNewVersionCode] = useState<string>("v1.1");
  const [initUpdateReason, setInitUpdateReason] = useState<string>("Cập nhật tiến độ thực tế các mốc thi công và điều chỉnh pháp lý");
  const [initSelectedDeptCode, setInitSelectedDeptCode] = useState<string>("9.1");
  const [initWbsCollapsed, setInitWbsCollapsed] = useState<Set<string>>(new Set());
  const [initWbsSearch, setInitWbsSearch] = useState<string>("");
  const [initWbsLevel, setInitWbsLevel] = useState<string>("all");
  const [initUpdateSelectedDeptCode, setInitUpdateSelectedDeptCode] = useState<string>("9.1");
  const [initUpdateWbsCollapsed, setInitUpdateWbsCollapsed] = useState<Set<string>>(new Set());
  const [initUpdateWbsSearch, setInitUpdateWbsSearch] = useState<string>("");
  const [initUpdateWbsLevel, setInitUpdateWbsLevel] = useState<string>("all");
  const [workspaceDeptFilter, setWorkspaceDeptFilter] = useState<string>("all");
  const [workspaceLevelFilter, setWorkspaceLevelFilter] = useState<string>("all");
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [pdfExportLevel, setPdfExportLevel] = useState<string>("all");
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
  const [homeRegionFilter, setHomeRegionFilter] = useState("all");
  const [homeProjectFilter, setHomeProjectFilter] = useState("all");
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
  const [settingsOpen, setSettingsOpen] = useState(true);
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

  const { approvedAverageProgress, approvedDoneTasks, approvedLateTasks } = useMemo(() => {
    if (!officialApprovedProjects.length) {
      return { approvedAverageProgress: 0, approvedDoneTasks: 0, approvedLateTasks: 0 };
    }
    let totalProgress = 0;
    let taskCount = 0;
    let doneTasks = 0;
    let lateTasks = 0;

    for (const p of officialApprovedProjects) {
      const tasks = scheduleTasks(p);
      for (const t of tasks) {
        if (t.summary) continue;
        taskCount++;
        totalProgress += t.actualProgress;
        if (t.actualStatus === "Hoàn thành") doneTasks++;
        else if (t.actualStatus === "Trễ hạn") lateTasks++;
      }
    }

    return {
      approvedAverageProgress: taskCount ? Math.round(totalProgress / taskCount) : 0,
      approvedDoneTasks: doneTasks,
      approvedLateTasks: lateTasks,
    };
  }, [officialApprovedProjects]);

  /* Chỉ hồ sơ đã qua thẩm định mới đủ điều kiện trình E-Approval (SOP B8). */
  const pendingEApprovalCount = useMemo(() => {
    return projects.filter((p) => p.approvalStatus === "appraised" && !p.isOfficialApproved).length;
  }, [projects]);

  const confirmEligibleProjects = useMemo(() => {
    return projects.filter((project) => isScheduleCompleted(project));
  }, [projects]);

  const visibleConfirmProjects = useMemo(() => {
    const query = confirmSearch.trim().toLocaleLowerCase("vi");
    return confirmEligibleProjects.filter((project) => {
      const matchesQuery = !query || `${project.code} ${project.name} ${project.location} ${project.eApprovalCode ?? ""}`.toLocaleLowerCase("vi").includes(query);
      const isApproved = Boolean(project.isOfficialApproved && (project.eApprovalUrl || project.eApprovalCode));
      const matchesFilter = confirmFilter === "all"
        ? true
        : confirmFilter === "pending"
          ? !isApproved
          : isApproved;
      return matchesQuery && matchesFilter;
    });
  }, [confirmEligibleProjects, confirmSearch, confirmFilter]);

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
  const isLowRiseCreation = ["Nhà ở thấp tầng", "Biệt thự nghỉ dưỡng", "Thấp tầng/Biệt thự"].includes(form.parameters.loaiHinhDuAn);
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
  const applyInitWbsLevel = (lvl: string | number) => {
    if (lvl === "all") {
      setInitWbsCollapsed(new Set());
      setInitWbsLevel("all");
    } else {
      const num = typeof lvl === "string" ? Number(lvl) : lvl;
      if (Number.isFinite(num) && num >= 1) {
        const toCollapse = new Set(
          fullCatalog
            .filter((task) => catalogParentCodes.has(task.code) && task.level >= num)
            .map((task) => task.code)
        );
        setInitWbsCollapsed(toCollapse);
        setInitWbsLevel(String(num));
      }
    }
  };
  const visibleCatalogRows = useMemo(() => {
    if (catalogSearch.trim()) return catalogRows;
    return catalogRows.filter((task) => ![...catalogCollapsed].some((code) => task.code.startsWith(`${code}.`)));
  }, [catalogRows, catalogSearch, catalogCollapsed]);
  const initWbsTasks = useMemo(() => {
    if (initSelectedDeptCode === "all") return fullCatalog;
    return fullCatalog.filter((task) => task.groupCode === initSelectedDeptCode);
  }, [fullCatalog, initSelectedDeptCode]);
  const visibleInitWbsTasks = useMemo(() => {
    const q = initWbsSearch.trim().toLocaleLowerCase("vi");
    return initWbsTasks.filter((task) => {
      if (q) {
        return (
          task.code.toLowerCase().includes(q) ||
          task.name.toLocaleLowerCase("vi").includes(q) ||
          (task.workGroup ?? "").toLocaleLowerCase("vi").includes(q)
        );
      }
      return ![...initWbsCollapsed].some((code) => task.code.startsWith(`${code}.`));
    });
  }, [initWbsTasks, initWbsSearch, initWbsCollapsed]);

  const applyInitUpdateWbsLevel = (lvl: string | number) => {
    if (lvl === "all") {
      setInitUpdateWbsCollapsed(new Set());
      setInitUpdateWbsLevel("all");
    } else {
      const num = typeof lvl === "string" ? Number(lvl) : lvl;
      if (Number.isFinite(num) && num >= 1) {
        const toCollapse = new Set(
          fullCatalog
            .filter((task) => catalogParentCodes.has(task.code) && task.level >= num)
            .map((task) => task.code)
        );
        setInitUpdateWbsCollapsed(toCollapse);
        setInitUpdateWbsLevel(String(num));
      }
    }
  };

  const targetProjectForUpdate = useMemo(() => {
    return (
      projects.find((p) => p.id === initSelectedApprovedProjectId) ||
      projects.find((p) => p.isOfficialApproved) ||
      projects[0]
    );
  }, [projects, initSelectedApprovedProjectId]);

  const targetScheduledTasks = useMemo(() => {
    if (!targetProjectForUpdate) return fullCatalog;
    const s = scheduleTasks(targetProjectForUpdate);
    return s.length > 0 ? s : fullCatalog;
  }, [targetProjectForUpdate, fullCatalog]);

  const targetProjectTasks = targetScheduledTasks;

  const initUpdateWbsTasks = useMemo(() => {
    if (initUpdateSelectedDeptCode === "all") return targetScheduledTasks;
    return targetScheduledTasks.filter((task) => task.groupCode === initUpdateSelectedDeptCode);
  }, [targetScheduledTasks, initUpdateSelectedDeptCode]);

  const visibleInitUpdateWbsTasks = useMemo(() => {
    const q = initUpdateWbsSearch.trim().toLocaleLowerCase("vi");
    return initUpdateWbsTasks.filter((task) => {
      if (q) {
        return (
          task.code.toLowerCase().includes(q) ||
          task.name.toLocaleLowerCase("vi").includes(q) ||
          (task.workGroup ?? "").toLocaleLowerCase("vi").includes(q)
        );
      }
      return ![...initUpdateWbsCollapsed].some((code) => task.code.startsWith(`${code}.`));
    });
  }, [initUpdateWbsTasks, initUpdateWbsSearch, initUpdateWbsCollapsed]);

  const applyWorkspaceLevel = (lvl: number | "all") => {
    setWorkspaceLevelFilter(String(lvl));
    if (lvl === "all") {
      setCollapsed(new Set());
    } else {
      const toCollapse = new Set<string>();
      scheduled.forEach((t) => {
        if (t.summary && t.level >= lvl) {
          toCollapse.add(t.code);
        }
      });
      setCollapsed(toCollapse);
    }
  };

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi");
    return scheduled.filter((task) => {
      if (workspaceDeptFilter !== "all" && task.groupCode !== workspaceDeptFilter) return false;
      if (workspaceLevelFilter !== "all" && task.level > Number(workspaceLevelFilter)) return false;
      if (query) return `${task.code} ${task.name} ${GROUP_BY_CODE[task.groupCode]?.name ?? ""}`.toLocaleLowerCase("vi").includes(query);
      return ![...collapsed].some((code) => task.code.startsWith(`${code}.`));
    });
  }, [scheduled, search, collapsed, workspaceDeptFilter, workspaceLevelFilter]);

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
      const allTasks = activeProject ? [...fullCatalog, ...allProjectTasks(activeProject)] : fullCatalog;
      const siblingNumbers = allTasks.filter((task) => task.parentCode === parentCode).map((task) => Number(task.code.split(".").at(-1))).filter(Number.isFinite);
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
    if (!form.region?.trim()) return setFormError("Vui lòng chọn Vùng dự án.");
    if (!form.startDate) return setFormError("Vui lòng nhập Ngày bắt đầu dự án.");
    if (!form.targetDate) return setFormError("Vui lòng nhập Ngày kết thúc hoàn toàn dự án.");
    if (form.targetDate <= form.startDate) return setFormError("Ngày kết thúc dự án phải sau Ngày bắt đầu dự án.");
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
      level: Math.max(1, code.split(".").length - 1),
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
      setCollapsed((current) => {
        const next = new Set(current);
        if (task.parentCode) next.delete(task.parentCode);
        return next;
      });
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

  const applyDefaultDependencies = () => {
    if (!activeProject || !isPlanEditable(activeProject)) return;
    const newDeps = defaultDependenciesForCodes(activeProject.includedTaskCodes);
    const linkCount = Object.values(newDeps).reduce((sum, list) => sum + list.length, 0);
    setProjects((current) => current.map((p) => p.id === activeProject.id ? { ...p, taskDependencies: newDeps } : p));
    notify(`Đã cập nhật ${linkCount} liên kết MTL chuẩn (9-4) cho dự án ${activeProject.code}`);
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

  const exportSchedulePdf = (exportLevel: string = pdfExportLevel) => {
    if (!activeProject) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      notify("Vui lòng cho phép mở cửa sổ popup để xuất file PDF");
      return;
    }

    const tasksToPrint = scheduled.filter((task) => {
      if (exportLevel === "all") return true;
      return task.level <= Number(exportLevel);
    });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BẢNG TIẾN ĐỘ MASTER TIMELINE - ${activeProject.name}</title>
  <style>
    @page {
      size: A3 landscape;
      margin: 12mm 10mm;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      table { page-break-inside: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 15px;
      font-size: 11px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .logo-box {
      font-size: 16px;
      font-weight: 900;
      letter-spacing: 1px;
      color: #1e3a8a;
    }
    .logo-sub {
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    .title-box {
      text-align: center;
      flex: 1;
      padding: 0 20px;
    }
    .title-box h1 {
      font-size: 18px;
      margin: 0 0 4px;
      text-transform: uppercase;
      color: #0f172a;
      letter-spacing: 0.5px;
    }
    .title-box h2 {
      font-size: 14px;
      font-weight: 700;
      color: #2563eb;
      margin: 0;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 14px;
      font-size: 11px;
    }
    .meta-item { display: flex; flex-direction: column; }
    .meta-item span { color: #64748b; font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .meta-item b { color: #0f172a; font-size: 12px; margin-top: 2px; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 8px;
      text-align: left;
    }
    th {
      background: #1e293b;
      color: #ffffff;
      font-weight: 700;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    tr.level-1 {
      background: #e2e8f0;
      font-weight: 800;
      color: #0f172a;
    }
    tr.level-2 {
      background: #f1f5f9;
      font-weight: 700;
      color: #1e293b;
    }
    tr.level-3 {
      background: #f8fafc;
      font-weight: 600;
    }
    tr.summary {
      font-weight: 700;
    }
    .wbs-col { width: 130px; font-family: monospace; font-weight: 700; }
    .dur-col { width: 90px; text-align: right; }
    .date-col { width: 85px; text-align: center; }
    .note-col { width: 140px; }
    .link-col { width: 110px; }
    .signatures {
      margin-top: 28px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      text-align: center;
      page-break-inside: avoid;
    }
    .sig-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      height: 110px;
      justify-content: space-between;
    }
    .sig-title {
      font-weight: 700;
      text-transform: uppercase;
      font-size: 11px;
    }
    .sig-role {
      font-size: 9.5px;
      color: #64748b;
      font-style: italic;
    }
    .sig-name {
      font-weight: 700;
      font-size: 11px;
      border-top: 1px dashed #94a3b8;
      padding-top: 4px;
      width: 180px;
    }
    .btn-print-bar {
      position: sticky;
      top: 0;
      background: #0f172a;
      color: #fff;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: -15px -15px 15px -15px;
      z-index: 100;
    }
    .btn-print {
      background: #16a34a;
      color: white;
      border: none;
      padding: 8px 18px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="btn-print-bar no-print">
    <div>
      <b>Hồ sơ Master Timeline trình duyệt:</b> ${activeProject.name} (${tasksToPrint.length} công việc)
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn-print" onclick="window.print()">🖨️ In / Tải file PDF ngay</button>
      <button style="background: #475569; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer;" onclick="window.close()">Đóng</button>
    </div>
  </div>

  <div class="header">
    <div>
      <div class="logo-box">NOVALAND GROUP</div>
      <div class="logo-sub">PMD · BAN ĐIỀU HÀNH DỰ ÁN</div>
    </div>
    <div class="title-box">
      <h1>KẾ HOẠCH TIẾN ĐỘ MASTER TIMELINE (MTL)</h1>
      <h2>${activeProject.name}</h2>
    </div>
    <div style="text-align: right; font-size: 10px; color: #475569;">
      <div>Mã dự án: <b>${activeProject.code}</b></div>
      <div>Phiên bản: <b>${activeProject.officialVersion || "v1.0"} (Trình duyệt)</b></div>
      <div>Ngày xuất: <b>${formatDate(today)}</b></div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><span>Chủ đầu tư</span><b>${activeProject.investor || "Tập đoàn Novaland"}</b></div>
    <div class="meta-item"><span>Loại hình & Khu vực</span><b>${activeProject.type} · ${activeProject.location || activeProject.area || "Việt Nam"}</b></div>
    <div class="meta-item"><span>Thời gian thực hiện</span><b>${formatDate(activeProject.startDate)} → ${formatDate(activeProject.targetDate)}</b></div>
    <div class="meta-item"><span>Quy mô WBS</span><b>${tasksToPrint.length} công việc · 14 Ban/Phòng (9-4)</b></div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="wbs-col">MÃ WBS</th>
        <th>HẠNG MỤC CÔNG VIỆC</th>
        <th class="dur-col">THỜI GIAN</th>
        <th class="date-col">BẮT ĐẦU</th>
        <th class="date-col">KẾT THÚC</th>
        <th class="note-col">GHI CHÚ</th>
        <th class="link-col">LIÊN KẾT</th>
      </tr>
    </thead>
    <tbody>
      ${tasksToPrint.map((t) => {
        const indent = (t.level - 1) * 14;
        const taskNote = activeProject.taskEdits[t.code]?.note || activeProject.taskEdits[t.code]?.actualNote || "";
        const rowClass = t.level === 1 ? "level-1" : t.level === 2 ? "level-2" : t.level === 3 ? "level-3" : t.summary ? "summary" : "";
        const links = (t.predecessors || []).map((p) => p.predecessorCode + (p.lagDays ? "+" + p.lagDays + "d" : "")).join(", ");
        return `
          <tr class="${rowClass}">
            <td class="wbs-col" style="padding-left: ${indent + 8}px;">${t.code}</td>
            <td>${t.name}</td>
            <td class="dur-col">${t.duration && t.duration > 0 ? `${t.duration} ngày` : "—"}</td>
            <td class="date-col">${t.startDate ? formatDate(t.startDate) : "—"}</td>
            <td class="date-col">${t.endDate ? formatDate(t.endDate) : "—"}</td>
            <td class="note-col">${taskNote}</td>
            <td class="link-col">${links}</td>
          </tr>
        `;
      }).join("")}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-box">
      <div class="sig-title">LẬP TIẾN ĐỘ</div>
      <div class="sig-name"></div>
    </div>
    <div class="sig-box">
      <div class="sig-title">XEM XÉT</div>
      <div class="sig-name"></div>
    </div>
    <div class="sig-box">
      <div class="sig-title">PHÊ DUYỆT</div>
      <div class="sig-name"></div>
    </div>
  </div>
</body>
</html>`;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
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

  if (!hydrated) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">
          <span className="loading-mark-code">PMD</span>
          <span className="loading-mark-title">Project Management</span>
        </div>
        <p>Đang chuẩn bị không gian dự án…</p>
      </main>
    );
  }

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
        /* ================= HOME EXECUTIVE COMMAND CENTER (FOR GIÁM ĐỐC BĐHDA) ================= */
        .home-dashboard-view {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          height: 100vh;
          overflow-y: auto;
          background: #f1f5f9;
          color: #0f172a;
          box-sizing: border-box;
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
          position: sticky;
          top: 0;
          z-index: 20;
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
        .home-role-badge-box {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 20px;
        }
        .home-role-avatar-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.2);
        }
        .home-role-title-text {
          font-size: 12px;
          font-weight: 700;
          color: #166534;
        }
        .home-date-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          font-size: 11.5px;
          color: #64748b;
          font-weight: 600;
        }

        /* Container */
        .exec-dashboard-body {
          flex: 1;
          padding: 14px 20px 24px;
          max-width: 1600px;
          width: 100%;
          margin: 0 auto;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* 4 Executive KPI Ribbon */
        .exec-kpi-ribbon {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        @media (max-width: 1024px) {
          .exec-kpi-ribbon {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .exec-kpi-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 12px 16px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          transition: all 0.15s ease;
        }
        .exec-kpi-card:hover {
          border-color: #cbd5e1;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
        }
        .exec-kpi-card.highlight {
          border-left: 4px solid #16a34a;
        }
        .exec-kpi-card.warning {
          border-left: 4px solid #ea580c;
        }
        .exec-kpi-card.danger {
          border-left: 4px solid #ef4444;
        }
        .exec-kpi-card.blue {
          border-left: 4px solid #0284c7;
        }
        .exec-kpi-left {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }
        .exec-kpi-label {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          color: #64748b;
        }
        .exec-kpi-num-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .exec-kpi-big-num {
          font-size: 24px;
          font-weight: 800;
          color: #0f172a;
          line-height: 1;
        }
        .exec-kpi-tag {
          font-size: 10.5px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 4px;
          white-space: nowrap;
        }
        .exec-kpi-tag.green {
          background: #ecfdf5;
          color: #16a34a;
          border: 1px solid #bbf7d0;
        }
        .exec-kpi-tag.orange {
          background: #fff7ed;
          color: #ea580c;
          border: 1px solid #fed7aa;
        }
        .exec-kpi-tag.red {
          background: #fef2f2;
          color: #ef4444;
          border: 1px solid #fecaca;
        }
        .exec-kpi-tag.blue {
          background: #f0f9ff;
          color: #0284c7;
          border: 1px solid #bae6fd;
        }
        .exec-kpi-sub {
          font-size: 11px;
          color: #64748b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .exec-kpi-action-btn {
          font-size: 11px;
          font-weight: 700;
          padding: 6px 11px;
          border-radius: 6px;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
          border: none;
          flex: none;
        }
        .exec-kpi-action-btn.primary {
          background: #16a34a;
          color: #ffffff;
        }
        .exec-kpi-action-btn.primary:hover {
          background: #15803d;
        }
        .exec-kpi-action-btn.danger-outline {
          background: #ffffff;
          color: #dc2626;
          border: 1px solid #fca5a5;
        }
        .exec-kpi-action-btn.danger-outline:hover {
          background: #fef2f2;
        }

        /* SECTION: 3 KEY PROJECTS HEALTH */
        /* SECTION: TÌNH TRẠNG DỰ ÁN (CHỈ DỰ ÁN ĐÃ DUYỆT MTL) */
        .exec-portfolio-box {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 14px 18px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
        }
        .exec-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
          gap: 12px;
          flex-wrap: wrap;
        }
        .exec-section-title {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .exec-section-sub {
          font-size: 11.5px;
          color: #64748b;
          font-weight: 500;
          margin-left: 4px;
        }
        .exec-filters-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .exec-filter-group {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .exec-filter-label {
          font-size: 11px;
          font-weight: 700;
          color: #64748b;
          text-transform: uppercase;
        }
        .exec-filter-select {
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          font-size: 11.5px;
          font-weight: 600;
          cursor: pointer;
          outline: none;
          height: 28px;
          transition: all 0.15s ease;
        }
        .exec-filter-select:hover {
          border-color: #94a3b8;
        }
        .exec-filter-select:focus {
          border-color: #16a34a;
          box-shadow: 0 0 0 2px rgba(22, 163, 74, 0.15);
        }
        .exec-portfolio-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
          gap: 12px;
        }
        @media (max-width: 900px) {
          .exec-portfolio-grid {
            grid-template-columns: 1fr;
          }
        }
        .exec-proj-mtl-box {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .exec-proj-mtl-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .exec-proj-mtl-title {
          font-size: 11.5px;
          font-weight: 700;
          color: #334155;
        }
        .exec-proj-mtl-percent {
          font-size: 16px;
          font-weight: 800;
          color: #16a34a;
        }
        .exec-proj-mtl-note {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 10.5px;
          color: #64748b;
        }
        .exec-empty-box {
          text-align: center;
          padding: 24px 16px;
          background: #f8fafc;
          border: 1px dashed #cbd5e1;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          align-items: center;
          justify-content: center;
          width: 100%;
          box-sizing: border-box;
        }
        .exec-empty-box b {
          font-size: 12.5px;
          color: #475569;
        }
        .exec-empty-box span {
          font-size: 11px;
          color: #94a3b8;
        }
        .exec-proj-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 10px;
          transition: all 0.15s ease;
        }
        .exec-proj-card:hover {
          background: #ffffff;
          border-color: #cbd5e1;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
        }
        .exec-proj-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
        }
        .exec-proj-code {
          font-size: 11px;
          font-weight: 700;
          color: #2563eb;
          letter-spacing: 0.2px;
        }
        .exec-proj-name {
          font-size: 13px;
          font-weight: 700;
          color: #0f172a;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .exec-proj-region {
          font-size: 10.5px;
          color: #64748b;
        }
        .exec-proj-progress-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .exec-proj-bar-track {
          flex: 1;
          height: 6px;
          background: #e2e8f0;
          border-radius: 3px;
          overflow: hidden;
        }
        .exec-proj-bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.3s ease;
        }
        .exec-proj-bar-fill.green { background: #16a34a; }
        .exec-proj-bar-fill.orange { background: #ea580c; }
        .exec-proj-bar-fill.blue { background: #0284c7; }
        .exec-proj-percent {
          font-size: 12.5px;
          font-weight: 800;
          color: #0f172a;
          min-width: 36px;
          text-align: right;
        }
        .exec-proj-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding-top: 8px;
          border-top: 1px dashed #e2e8f0;
        }
        .exec-proj-status-tag {
          font-size: 10.5px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 4px;
        }
        .exec-proj-status-tag.approved {
          background: #ecfdf5;
          color: #16a34a;
          border: 1px solid #bbf7d0;
        }
        .exec-proj-status-tag.in-progress {
          background: #eff6ff;
          color: #1d4ed8;
          border: 1px solid #bfdbfe;
        }
        .exec-proj-status-tag.pending-eapp {
          background: #fffbeb;
          color: #b45309;
          border: 1px solid #fde68a;
        }
        .exec-proj-btn {
          font-size: 11px;
          font-weight: 700;
          padding: 4px 9px;
          border-radius: 5px;
          cursor: pointer;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #334155;
          transition: all 0.15s ease;
          white-space: nowrap;
        }
        .exec-proj-btn:hover {
          background: #f1f5f9;
          border-color: #94a3b8;
        }
        .exec-proj-btn.primary {
          background: #16a34a;
          border-color: #15803d;
          color: #ffffff;
        }
        .exec-proj-btn.primary:hover {
          background: #15803d;
        }

        /* SECTION: LOWER SPLIT GRID (Matrix 2x3 + Action & Escalation) */
        .exec-lower-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
          gap: 14px;
          align-items: stretch;
        }
        @media (max-width: 1150px) {
          .exec-lower-grid {
            grid-template-columns: 1fr;
          }
        }

        /* Left: Operations Matrix 2x3 */
        .exec-matrix-box {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 14px 18px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
        }
        .exec-matrix-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          flex: 1;
        }
        @media (max-width: 600px) {
          .exec-matrix-grid {
            grid-template-columns: 1fr;
          }
        }
        .exec-matrix-card {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .exec-matrix-card:hover {
          background: #ffffff;
          border-color: #cbd5e1;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.03);
          transform: translateY(-1px);
        }
        .exec-matrix-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .exec-matrix-code {
          font-size: 10px;
          font-weight: 800;
          padding: 2px 6px;
          border-radius: 4px;
          color: #ffffff;
        }
        .exec-matrix-code.blue { background: #2563eb; }
        .exec-matrix-code.orange { background: #ea580c; }
        .exec-matrix-title {
          font-size: 11.5px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .exec-matrix-rate {
          font-size: 12px;
          font-weight: 800;
        }
        .exec-matrix-rate.green { color: #16a34a; }
        .exec-matrix-rate.orange { color: #ea580c; }
        .exec-matrix-track {
          width: 100%;
          height: 5px;
          background: #e2e8f0;
          border-radius: 3px;
          overflow: hidden;
        }
        .exec-matrix-fill {
          height: 100%;
          border-radius: 3px;
        }
        .exec-matrix-fill.green { background: #16a34a; }
        .exec-matrix-fill.orange { background: #ea580c; }
        .exec-matrix-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 10.5px;
          color: #64748b;
        }
        .exec-matrix-status {
          font-weight: 700;
        }
        .exec-matrix-status.green { color: #16a34a; }
        .exec-matrix-status.orange { color: #ea580c; }

        /* Right: Director's Action & Escalation Hub */
        .exec-hub-box {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .exec-action-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 12px 16px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .exec-action-card.escalation {
          border-color: #fee2e2;
        }
        .exec-hub-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 6px;
          border-bottom: 1px solid #f1f5f9;
        }
        .exec-hub-title {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .exec-hub-title.blue { color: #0284c7; }
        .exec-hub-title.red { color: #ef4444; }
        .exec-hub-badge {
          font-size: 10.5px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 12px;
        }
        .exec-hub-badge.blue {
          background: #e0f2fe;
          color: #0284c7;
        }
        .exec-hub-badge.red {
          background: #fee2e2;
          color: #dc2626;
        }
        .exec-task-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 6px;
          background: #f8fafc;
          border: 1px solid #f1f5f9;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .exec-task-row:hover {
          background: #ffffff;
          border-color: #e2e8f0;
        }
        .exec-task-row.is-done {
          opacity: 0.65;
        }
        .exec-task-check {
          width: 16px;
          height: 16px;
          border-radius: 4px;
          border: 1.5px solid #cbd5e1;
          display: grid;
          place-items: center;
          background: #ffffff;
          color: #ffffff;
          flex: none;
        }
        .exec-task-check.checked {
          background: #16a34a;
          border-color: #16a34a;
        }
        .exec-task-text {
          font-size: 11.5px;
          font-weight: 600;
          color: #1e293b;
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .exec-task-tag {
          font-size: 10px;
          font-weight: 700;
          color: #64748b;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          padding: 2px 6px;
          border-radius: 4px;
          flex: none;
        }

        /* Escalation Item */
        .exec-escala-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 6px;
          background: #fffafa;
          border: 1px solid #fee2e2;
          transition: all 0.15s ease;
        }
        .exec-escala-row:hover {
          border-color: #fca5a5;
        }
        .exec-escala-left {
          min-width: 0;
          flex: 1;
        }
        .exec-escala-title {
          font-size: 11px;
          font-weight: 700;
          color: #1e293b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .exec-escala-sub {
          font-size: 10px;
          color: #64748b;
          margin-top: 1px;
        }
        .exec-escala-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: none;
        }
        .exec-escala-days {
          background: #ef4444;
          color: #ffffff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          white-space: nowrap;
        }
        .exec-escala-btn {
          background: #dc2626;
          color: #ffffff;
          border: none;
          font-size: 10.5px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .exec-escala-btn:hover {
          background: #b91c1c;
        }

        /* Executive Team Leads Strip */
        .exec-team-strip {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 10px;
          padding: 10px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .exec-team-lead-item {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .exec-team-lead-avatar {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: #102a45;
          color: #ffffff;
          display: grid;
          place-items: center;
          font-size: 10px;
          font-weight: 800;
          flex: none;
        }
        .exec-team-lead-info {
          min-width: 0;
          flex: 1;
        }
        .exec-team-lead-role {
          font-size: 10.5px;
          font-weight: 700;
          color: #0f172a;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .exec-team-lead-kpi {
          font-size: 10px;
          font-weight: 800;
          color: #16a34a;
        }
        .exec-team-lead-kpi.orange {
          color: #ea580c;
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
          grid-template-columns: 310px 330px minmax(520px, 1fr);
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
        .init-tree-ctrl-btn {
          background: #f1f5f9 !important;
          border: 1px solid #cbd5e1 !important;
          border-radius: 4px !important;
          padding: 3px 8px !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          color: #334155 !important;
          cursor: pointer !important;
          transition: all 0.12s ease !important;
          white-space: nowrap !important;
        }
        .init-tree-ctrl-btn:hover {
          background: #e2e8f0 !important;
          color: #0f172a !important;
        }
        .init-wbs-table {
          display: flex !important;
          flex-direction: column !important;
          width: 100% !important;
        }
        .init-wbs-head {
          display: grid !important;
          grid-template-columns: 175px 1fr 170px 85px !important;
          align-items: center !important;
          gap: 10px !important;
          padding: 10px 14px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #e2e8f0 !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          color: #64748b !important;
          letter-spacing: 0.4px !important;
          text-transform: uppercase !important;
          position: sticky !important;
          top: 0 !important;
          z-index: 4 !important;
        }
        .init-wbs-row {
          display: grid !important;
          grid-template-columns: 175px 1fr 170px 85px !important;
          align-items: center !important;
          gap: 10px !important;
          padding: 8px 14px !important;
          border-bottom: 1px solid #f1f5f9 !important;
          font-size: 12px !important;
          color: #1e293b !important;
          transition: background 0.12s ease !important;
        }
        .init-wbs-row:hover {
          background: #f8fafc !important;
        }
        .init-wbs-cell {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          min-width: 0 !important;
          overflow: hidden !important;
        }
        .init-name-cell {
          line-height: 1.45 !important;
          word-break: break-word !important;
        }
        .init-wbs-scroll-container {
          scrollbar-width: thin !important;
          scrollbar-color: #94a3b8 #f1f5f9 !important;
        }
        .init-wbs-scroll-container::-webkit-scrollbar {
          width: 8px !important;
          height: 8px !important;
        }
        .init-wbs-scroll-container::-webkit-scrollbar-track {
          background: #f1f5f9 !important;
          border-radius: 4px !important;
        }
        .init-wbs-scroll-container::-webkit-scrollbar-thumb {
          background: #cbd5e1 !important;
          border-radius: 4px !important;
        }
        .init-wbs-scroll-container::-webkit-scrollbar-thumb:hover {
          background: #94a3b8 !important;
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
        .confirm-approval-table {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          overflow-x: auto !important;
          box-sizing: border-box !important;
        }
        .refined-ui .workspace .confirm-approval-table :is(.project-table-head,.project-table-row),
        .confirm-approval-table .project-table-head,
        .confirm-approval-table .project-table-row {
          min-width: 1080px !important;
          width: 100% !important;
          box-sizing: border-box !important;
          grid-template-columns: 110px minmax(200px, 1.8fr) 130px 140px minmax(200px, 1.4fr) 110px 190px !important;
          padding: 12px 18px !important;
          gap: 14px !important;
          align-items: center !important;
        }
        .confirm-approval-table .project-action-cell {
          justify-content: flex-start !important;
          gap: 6px !important;
          display: flex !important;
          align-items: center !important;
        }
        .confirm-approval-table .eapp-link-badge {
          max-width: 100% !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          white-space: nowrap !important;
        }
        /* ================= PROJECTS OVERVIEW TABLE ================= */
        .projects-overview-table {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          overflow-x: hidden !important;
          box-sizing: border-box !important;
        }
        .projects-overview-table .project-table-head,
        .projects-overview-table .project-table-row {
          min-width: 0 !important;
          width: 100% !important;
          box-sizing: border-box !important;
          grid-template-columns: minmax(150px, 1.3fr) minmax(240px, 2.2fr) minmax(130px, 1fr) minmax(150px, 1.2fr) minmax(130px, 1fr) !important;
          padding: 12px 20px !important;
          gap: 16px !important;
        }
        .projects-overview-table .project-table-head span:nth-child(4),
        .projects-overview-table .project-table-head span:last-child {
          text-align: center !important;
        }
        .projects-overview-table .project-action-cell {
          justify-content: center !important;
          gap: 6px !important;
          display: flex !important;
          align-items: center !important;
        }
        .projects-overview-table .action-btn {
          width: 32px !important;
          height: 32px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          border-radius: 6px !important;
          border: 1px solid #e2e8f0 !important;
          background: #ffffff !important;
          cursor: pointer !important;
          transition: all 0.15s ease !important;
          padding: 0 !important;
          flex-shrink: 0 !important;
        }
        .projects-overview-table .action-btn svg {
          width: 15px !important;
          height: 15px !important;
        }
        .projects-overview-table .action-btn.view-btn {
          border-color: #e2e8f0 !important;
          background: #f8fafc !important;
          color: #475569 !important;
        }
        .projects-overview-table .action-btn.view-btn:hover {
          border-color: #0284c7 !important;
          background: #f0f9ff !important;
          color: #0284c7 !important;
        }
        .projects-overview-table .action-btn.complete-btn {
          border-color: #bbf7d0 !important;
          background: #f0fdf4 !important;
          color: #16a34a !important;
        }
        .projects-overview-table .action-btn.complete-btn:hover {
          border-color: #16a34a !important;
          background: #dcfce7 !important;
          color: #15803d !important;
        }
        .projects-overview-table .action-btn.delete-btn {
          border-color: #fecdd3 !important;
          background: #fff1f2 !important;
          color: #e11d48 !important;
        }
        .projects-overview-table .action-btn.delete-btn:hover {
          border-color: #e11d48 !important;
          background: #ffe4e6 !important;
          color: #be123c !important;
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
              <button className={view === "init_template" ? "active" : ""} onClick={() => setView("init_template")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconSparkles />
                <span>Khởi tạo tiến độ</span>
              </button>
              <button
                className={view === "projects" || view === "workspace" ? "active" : ""}
                onClick={() => {
                  setView("projects");
                }}
                tabIndex={lapMtlSectionOpen ? 0 : -1}
              >
                <IconTimeline />
                <span>Hoàn thiện tiến độ</span>
              </button>
              <button className={view === "confirm_approval" ? "active" : ""} onClick={() => setView("confirm_approval")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconFileCheck />
                <span>Xác nhận phê duyệt</span>
              </button>
            </nav>
          </>;
        })()}

        {/* Module 2: LẬP NHIỆM VỤ THIẾT KẾ — trực tiếp không xổ dropdown */}
        <button
          type="button"
          className={`sidebar-section-toggle ${view === "design_task" ? "active" : ""}`}
          onClick={() => setView("design_task")}
          title="Lập Nhiệm Vụ Thiết Kế"
          style={view === "design_task" ? { background: "#23b26d", color: "#ffffff", borderRadius: "8px", fontWeight: 700 } : undefined}
        >
          <div className="section-toggle-left">
            <IconDesignTask />
            <span>Lập Nhiệm Vụ Thiết Kế</span>
          </div>
        </button>

        {/* Module 3: LẬP FS THỰC THI (FS-Ver2) — trực tiếp không xổ dropdown */}
        <button
          type="button"
          className={`sidebar-section-toggle ${view === "fs_ver2" ? "active" : ""}`}
          onClick={() => setView("fs_ver2")}
          title="Lập FS Thực Thi (FS-Ver2)"
          style={view === "fs_ver2" ? { background: "#23b26d", color: "#ffffff", borderRadius: "8px", fontWeight: 700 } : undefined}
        >
          <div className="section-toggle-left">
            <IconFS />
            <span>Lập FS Thực Thi (FS-Ver2)</span>
          </div>
        </button>

        {/* Module 4: THEO DÕI DỰ ÁN */}
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

        {/* Module 5: CÀI ĐẶT — ở dưới cùng */}
        {(() => {
          const isSectionOpen = settingsOpen;
          return <>
            <button
              type="button"
              className={`sidebar-section-toggle ${isSectionOpen ? "open" : ""}`}
              onClick={() => {
                if (sidebarCollapsed) {
                  setView("catalog");
                } else {
                  setSettingsOpen((current) => !current);
                  setView("catalog");
                }
              }}
              aria-expanded={isSectionOpen}
              title="Cài đặt"
            >
              <div className="section-toggle-left">
                <IconSettings />
                <span>Cài đặt</span>
              </div>
              <IconChevronDown />
            </button>
            <nav className={`sidebar-nav sidebar-collapsible ${isSectionOpen ? "" : "collapsed"}`} aria-label="Điều hướng Cài đặt" aria-hidden={!isSectionOpen}>
              <button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")} tabIndex={isSectionOpen ? 0 : -1}>
                <IconList />
                <span>Cấu trúc Master Timeline</span>
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
                  <span>Novaland</span>
                </div>
                <span className="home-breadcrumb-sep">&gt;</span>
                <span className="home-breadcrumb-title">
                  BẢNG ĐIỀU HÀNH BĐHDA
                </span>
              </div>

              {/* Period Switcher */}
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
                <div className="home-date-pill">
                  <IconCalendar />
                  <span>{formatDate(overviewToday)}</span>
                </div>
                <div className="home-role-badge-box">
                  <span className="home-role-avatar-dot" />
                  <span className="home-role-title-text">Giám đốc Ban điều hành dự án</span>
                </div>
              </div>
            </header>

            {(() => {
              const pAqua = projects.find((p) => p.id === "proj-aqua-city") || projects[0];
              const pNova = projects.find((p) => p.id === "proj-novaworld-phanthiet") || projects[1];
              const pTgm = projects.find((p) => p.id === "proj-the-grand-manhattan") || projects[2];

              const bdhdaOperationsList = [
                {
                  code: "NV-01",
                  name: "Lập & Kiểm soát MTL",
                  progress: 92,
                  target: 90,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "projects" as const,
                },
                {
                  code: "NV-02",
                  name: "Phê duyệt NVTK & KT",
                  progress: 86,
                  target: 80,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "design_task" as const,
                },
                {
                  code: "NV-03",
                  name: "Thẩm định FS-Ver2",
                  progress: 82,
                  target: 80,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "fs_ver2" as const,
                },
                {
                  code: "NV-04",
                  name: "Pháp lý & GPXD",
                  progress: 90,
                  target: 85,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "overview" as const,
                },
                {
                  code: "NV-05",
                  name: "Giám sát Hiện trường",
                  progress: 85,
                  target: 80,
                  status: "passed",
                  statusText: "Đạt chuẩn",
                  actionView: "overview" as const,
                },
                {
                  code: "NV-06",
                  name: "Hoàn công & Bàn giao",
                  progress: 76,
                  target: 80,
                  status: "improve",
                  statusText: "Cần đẩy nhanh",
                  actionView: "overview" as const,
                },
              ];

              const approvedMtlProjects = projects.filter(
                (p) => Boolean(p.isOfficialApproved || (p.approvalStatus === "approved" && p.eApprovalCode))
              );

              const availableRegions = Array.from(new Set(approvedMtlProjects.map((p) => p.region).filter(Boolean))) as string[];

              const availableProjectsForSelect = approvedMtlProjects.filter(
                (p) => homeRegionFilter === "all" || p.region === homeRegionFilter
              );

              const visibleHomeProjects = approvedMtlProjects.filter((p) => {
                const matchesRegion = homeRegionFilter === "all" || p.region === homeRegionFilter;
                const matchesProject = homeProjectFilter === "all" || p.id === homeProjectFilter;
                return matchesRegion && matchesProject;
              });

              const overdueAlerts = [
                {
                  id: "od-1",
                  title: "Thẩm duyệt nghiệm thu PCCC Tháp B & C",
                  project: "NovaWorld Phan Thiết",
                  daysLate: 40,
                  dept: "Ban QLDA & Pháp lý",
                },
                {
                  id: "od-2",
                  title: "Nghiệm thu cọc khoan nhồi Phân khu 2",
                  project: "Aqua City",
                  daysLate: 38,
                  dept: "Ban QLDA Hiện trường",
                },
                {
                  id: "od-3",
                  title: "Đối chiếu chi phí tư vấn & ký nháy NVTK",
                  project: "Sunrise Riverside",
                  daysLate: 30,
                  dept: "Phòng Quản lý Thiết kế",
                },
              ];

              const teamLeads = [
                { role: "PGĐ Vùng HCM", kpi: 92.0, avatar: "HCM" },
                { role: "TPCC Phan Thiết", kpi: 88.5, avatar: "PT" },
                { role: "TP QLDA MTL", kpi: 78.0, avatar: "MTL", orange: true },
                { role: "Admin Quản trị", kpi: 96.0, avatar: "ITT" },
              ];

              const score = homePeriod === "6m" ? 88.0 : homePeriod === "q3" ? 85.5 : 89.2;
              const directorTasks = todayTasksList.slice(0, 3);
              const doneDirectorTasks = directorTasks.filter((t) => t.done).length;

              return (
                <div className="exec-dashboard-body">
                  {/* 1. Executive KPI Ribbon */}
                  <div className="exec-kpi-ribbon">
                    <div className="exec-kpi-card highlight">
                      <div className="exec-kpi-left">
                        <span className="exec-kpi-label">Hiệu suất BĐHDA</span>
                        <div className="exec-kpi-num-row">
                          <span className="exec-kpi-big-num">{score.toFixed(1).replace(".", ",")}%</span>
                          <span className="exec-kpi-tag green">Đạt chuẩn (≥80%)</span>
                        </div>
                        <span className="exec-kpi-sub">Đúng hạn: 92.5d · Bù: +3.5d</span>
                      </div>
                      <IconAward />
                    </div>

                    <div className="exec-kpi-card blue">
                      <div className="exec-kpi-left">
                        <span className="exec-kpi-label">Dự án Đã Duyệt MTL</span>
                        <div className="exec-kpi-num-row">
                          <span className="exec-kpi-big-num">{approvedMtlProjects.length} / {projects.length}</span>
                          <span className="exec-kpi-tag blue">Đúng hạn 92%</span>
                        </div>
                        <span className="exec-kpi-sub">
                          {approvedMtlProjects.map((p) => p.code).join(" · ") || "Chưa có dự án duyệt"}
                        </span>
                      </div>
                      <IconBuilding />
                    </div>

                    <div className="exec-kpi-card warning">
                      <div className="exec-kpi-left">
                        <span className="exec-kpi-label">Hồ sơ Chờ Giám Đốc Duyệt</span>
                        <div className="exec-kpi-num-row">
                          <span className="exec-kpi-big-num">1</span>
                          <span className="exec-kpi-tag orange">Chờ E-Approval</span>
                        </div>
                        <span className="exec-kpi-sub">The Grand Manhattan (v1.0)</span>
                      </div>
                      <button
                        type="button"
                        className="exec-kpi-action-btn primary"
                        onClick={() => {
                          if (pTgm) openEApprovalModal(pTgm);
                          else setView("confirm_approval");
                        }}
                      >
                        Duyệt ngay →
                      </button>
                    </div>

                    <div className="exec-kpi-card danger">
                      <div className="exec-kpi-left">
                        <span className="exec-kpi-label">Cảnh báo Mốc Trọng yếu</span>
                        <div className="exec-kpi-num-row">
                          <span className="exec-kpi-big-num">3</span>
                          <span className="exec-kpi-tag red">Cần đôn đốc</span>
                        </div>
                        <span className="exec-kpi-sub">PCCC (40d) · Cọc nhồi (38d)</span>
                      </div>
                      <button
                        type="button"
                        className="exec-kpi-action-btn danger-outline"
                        onClick={() => setToast("Đã gửi văn bản đôn đốc khẩn cấp tới các Ban QLDA")}
                      >
                        Đôn đốc tất cả
                      </button>
                    </div>
                  </div>

                  {/* 2. TÌNH TRẠNG DỰ ÁN (CHỈ DỰ ÁN ĐÃ DUYỆT MASTER TIMELINE 9-4) */}
                  <div className="exec-portfolio-box">
                    <div className="exec-section-header">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="exec-section-title">
                          <IconBuilding /> Tình trạng dự án
                        </span>
                        <span className="exec-section-sub">
                          (Tiến độ triển khai theo MTL chuẩn 9-4 · {visibleHomeProjects.length} dự án đã duyệt)
                        </span>
                      </div>

                      {/* Bộ lọc Vùng / Dự án */}
                      <div className="exec-filters-wrap">
                        <div className="exec-filter-group">
                          <span className="exec-filter-label">Vùng:</span>
                          <select
                            value={homeRegionFilter}
                            onChange={(e) => {
                              setHomeRegionFilter(e.target.value);
                              setHomeProjectFilter("all");
                            }}
                            className="exec-filter-select"
                            aria-label="Lọc theo Vùng"
                          >
                            <option value="all">Tất cả vùng ({availableRegions.length})</option>
                            {availableRegions.map((region) => (
                              <option key={region} value={region}>{region}</option>
                            ))}
                          </select>
                        </div>
                        <div className="exec-filter-group">
                          <span className="exec-filter-label">Dự án:</span>
                          <select
                            value={homeProjectFilter}
                            onChange={(e) => setHomeProjectFilter(e.target.value)}
                            className="exec-filter-select"
                            aria-label="Lọc theo Dự án"
                          >
                            <option value="all">Tất cả dự án ({availableProjectsForSelect.length})</option>
                            {availableProjectsForSelect.map((p) => (
                              <option key={p.id} value={p.id}>[{p.code}] {p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    {visibleHomeProjects.length > 0 ? (
                      <div className="exec-portfolio-grid">
                        {visibleHomeProjects.map((p) => {
                          const tasks = scheduleTasks(p);
                          let totalProgress = 0;
                          let nonSummaryCount = 0;
                          for (const t of tasks) {
                            if (!t.summary) {
                              nonSummaryCount++;
                              totalProgress += (t.actualProgress ?? 0);
                            }
                          }
                          const calculated = nonSummaryCount ? Math.round(totalProgress / nonSummaryCount) : 0;
                          const progressVal = calculated > 0
                            ? calculated
                            : (p.id === "proj-aqua-city-phoenix" ? 92 : (p.id === "proj-the-grand-manhattan" ? 78 : 85));

                          return (
                            <div className="exec-proj-card" key={p.id}>
                              <div className="exec-proj-top">
                                <div>
                                  <span className="exec-proj-code">{p.code}</span>
                                  <div className="exec-proj-name" title={p.name}>{p.name}</div>
                                  <span className="exec-proj-region">{p.region || p.location}</span>
                                </div>
                                <span className="exec-proj-status-tag approved">
                                  ✓ MTL 9-4 ĐÃ DUYỆT
                                </span>
                              </div>

                              {/* Tình trạng triển khai theo MTL 9-4 đạt bao nhiêu % */}
                              <div className="exec-proj-mtl-box">
                                <div className="exec-proj-mtl-row">
                                  <span className="exec-proj-mtl-title">Tiến độ triển khai theo MTL (9-4):</span>
                                  <span className="exec-proj-mtl-percent">{progressVal}%</span>
                                </div>
                                <div className="exec-proj-bar-track" style={{ height: 8, borderRadius: 4 }}>
                                  <div
                                    className="exec-proj-bar-fill green"
                                    style={{ width: `${progressVal}%`, borderRadius: 4 }}
                                  />
                                </div>
                                <div className="exec-proj-mtl-note">
                                  <span>{progressVal >= 80 ? "✓ Đang đạt tiến độ kế hoạch MTL 9-4" : "⚠ Cần bám sát và đôn đốc các mốc"}</span>
                                  <span>Mục tiêu: 100%</span>
                                </div>
                              </div>

                              <div className="exec-proj-bottom">
                                <span style={{ fontSize: "11px", color: "#64748b" }}>
                                  Bản MTL: <b>{p.officialVersion || "v1.0"}</b>
                                </span>
                                <div style={{ display: "flex", gap: "6px" }}>
                                  <button
                                    type="button"
                                    className="exec-proj-btn primary"
                                    onClick={() => {
                                      setActiveId(p.id);
                                      setView("workspace");
                                    }}
                                  >
                                    Xem chi tiết MTL ↗
                                  </button>
                                  <button
                                    type="button"
                                    className="exec-proj-btn"
                                    onClick={() => {
                                      setOverviewProject(p.id);
                                      setView("overview");
                                    }}
                                  >
                                    Tiến độ
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="exec-empty-box">
                        <IconBuilding />
                        <b>Chưa có dự án nào thỏa điều kiện lọc</b>
                        <span>Chỉ các dự án đã được phê duyệt Master Timeline mới được hiển thị tại đây.</span>
                      </div>
                    )}
                  </div>

                  {/* 3. Lower Grid: Operations Matrix & Action Hub */}
                  <div className="exec-lower-grid">
                    {/* Left: 6 BĐHDA Operations Matrix */}
                    <div className="exec-matrix-box">
                      <div className="exec-section-header">
                        <span className="exec-section-title">
                          <IconBriefcase /> 6 Chỉ Tiêu Nghiệp Vụ BĐHDA
                        </span>
                        <span className="exec-section-sub">Chỉ tiêu chuẩn hóa ≥ 80%</span>
                      </div>

                      <div className="exec-matrix-grid">
                        {bdhdaOperationsList.map((op) => (
                          <div
                            className="exec-matrix-card"
                            key={op.code}
                            onClick={() => setView(op.actionView)}
                            title={`Nhấn để mở phân hệ ${op.name}`}
                          >
                            <div className="exec-matrix-header">
                              <span className={`exec-matrix-code ${op.status === "improve" ? "orange" : "blue"}`}>
                                {op.code}
                              </span>
                              <span className="exec-matrix-title">{op.name}</span>
                              <span className={`exec-matrix-rate ${op.status === "improve" ? "orange" : "green"}`}>
                                {op.progress}%
                              </span>
                            </div>

                            <div className="exec-matrix-track">
                              <div
                                className={`exec-matrix-fill ${op.status === "improve" ? "orange" : "green"}`}
                                style={{ width: `${op.progress}%` }}
                              />
                            </div>

                            <div className="exec-matrix-foot">
                              <span>Mục tiêu: {op.target}%</span>
                              <span className={`exec-matrix-status ${op.status === "improve" ? "orange" : "green"}`}>
                                {op.statusText} →
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: Executive Action & Escalation Hub */}
                    <div className="exec-hub-box">
                      {/* Card 1: Today's Priorities */}
                      <div className="exec-action-card">
                        <div className="exec-hub-head">
                          <span className="exec-hub-title blue">
                            <IconClock /> Việc Trọng Tâm Cần Xử Lý Hôm Nay
                          </span>
                          <span className="exec-hub-badge blue">
                            {doneDirectorTasks}/{directorTasks.length} Hoàn thành
                          </span>
                        </div>

                        {directorTasks.map((task) => (
                          <div
                            className={`exec-task-row ${task.done ? "is-done" : ""}`}
                            key={task.id}
                            onClick={() => {
                              setTodayTasksList((prev) =>
                                prev.map((item) => (item.id === task.id ? { ...item, done: !item.done } : item))
                              );
                            }}
                          >
                            <div className={`exec-task-check ${task.done ? "checked" : ""}`}>
                              {task.done && (
                                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>
                            <span className="exec-task-text" title={task.title}>
                              {task.title}
                            </span>
                            <span className="exec-task-tag">{task.project || task.time}</span>
                          </div>
                        ))}
                      </div>

                      {/* Card 2: Escalation Alerts */}
                      <div className="exec-action-card escalation">
                        <div className="exec-hub-head">
                          <span className="exec-hub-title red">
                            <IconAlertTriangle /> Điểm Nóng Cần Chỉ Đạo Khẩn
                          </span>
                          <span className="exec-hub-badge red">
                            {overdueAlerts.length} Điểm nóng
                          </span>
                        </div>

                        {overdueAlerts.map((item) => (
                          <div className="exec-escala-row" key={item.id}>
                            <div className="exec-escala-left">
                              <div className="exec-escala-title" title={item.title}>
                                {item.title}
                              </div>
                              <div className="exec-escala-sub">
                                {item.project} · {item.dept}
                              </div>
                            </div>
                            <div className="exec-escala-right">
                              <span className="exec-escala-days">Trễ {item.daysLate}d</span>
                              <button
                                type="button"
                                className="exec-escala-btn"
                                onClick={() => setToast(`Đã gửi lệnh đôn đốc khẩn cấp tới ${item.dept} cho dự án ${item.project}`)}
                              >
                                Đôn đốc
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Direct Reports Strip */}
                      <div className="exec-team-strip">
                        {teamLeads.map((lead) => (
                          <div className="exec-team-lead-item" key={lead.role}>
                            <div className="exec-team-lead-avatar">{lead.avatar}</div>
                            <div className="exec-team-lead-info">
                              <div className="exec-team-lead-role" title={lead.role}>{lead.role}</div>
                              <span className={`exec-team-lead-kpi ${lead.orange ? "orange" : ""}`}>
                                KPI {lead.kpi.toFixed(1)}
                              </span>
                            </div>
                          </div>
                        ))}
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
                <h1>Hoàn thiện tiến độ</h1>
              </div>
            </header>
            <section className="project-index" style={{ padding: "20px 24px" }}>
              {projects.length > 0 ? (
                <div className="project-table projects-overview-table" aria-label="Danh sách dự án Hoàn thiện tiến độ">
                  <div className="project-table-head">
                    <span>Vùng dự án</span>
                    <span>Tên dự án</span>
                    <span>Mã dự án</span>
                    <span>Trạng thái</span>
                    <span>Hành động</span>
                  </div>
                  <div className="project-table-body">
                    {projects.map((project) => {
                      const isCompleted = isScheduleCompleted(project);
                      return (
                        <div key={project.id} className="project-table-row" onClick={() => openProject(project)}>
                          <span className="project-region-cell">{project.region || project.location || project.area || "Đồng Nai 1"}</span>
                          <span className="project-name-cell">
                            <b>{project.name}</b>
                          </span>
                          <span className="project-code">{project.code}</span>
                          <span style={{ display: "flex", justifyContent: "center" }}>
                            <span
                              className={`status-badge ${isCompleted ? "status-completed" : "status-in-progress"}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "5px 12px",
                                borderRadius: "6px",
                                fontWeight: 700,
                                fontSize: "11px",
                                border: isCompleted ? "1px solid #86efac" : "1px solid #bae6fd",
                                background: isCompleted ? "#dcfce7" : "#e0f2fe",
                                color: isCompleted ? "#15803d" : "#0284c7",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isCompleted ? "Đã hoàn thiện" : "Đang hoàn thiện"}
                            </span>
                          </span>
                          <span className="project-action-cell" onClick={(event) => event.stopPropagation()}>
                            <button
                              type="button"
                              className="action-btn view-btn"
                              title="Chỉnh sửa tiến độ"
                              aria-label="Chỉnh sửa tiến độ"
                              onClick={() => openProject(project)}
                            >
                              <IconEye />
                            </button>
                            <button
                              type="button"
                              className="action-btn complete-btn"
                              title="Xác nhận hoàn thiện tiến độ & xuất hồ sơ"
                              aria-label="Xác nhận hoàn thiện"
                              onClick={() => {
                                setActiveId(project.id);
                                setShowCompleteModal(true);
                              }}
                            >
                              <IconCheck />
                            </button>
                            <button
                              type="button"
                              className="action-btn delete-btn"
                              title="Xóa dự án"
                              aria-label="Xóa dự án"
                              onClick={() => setProjectToDelete(project)}
                            >
                              <IconTrash />
                            </button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="project-index-empty">
                  <b>Chưa có dự án nào</b>
                  <span>Khởi tạo tiến độ dự án mới để bắt đầu hoàn thiện tiến độ.</span>
                  <button className="primary-button" onClick={() => setView("init_template")}>Khởi tạo tiến độ</button>
                </div>
              )}
            </section>
          </>
        ) : view === "catalog" ? (
          <>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    className="topbar-toggle-sidebar-btn"
                    onClick={() => setSidebarCollapsed((prev) => !prev)}
                    title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                    aria-label="Chuyển đổi thanh điều hướng"
                  >
                    <IconMenu />
                  </button>
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>Cài đặt</div>
                    <h1 style={{ margin: 0 }}>Cấu trúc Master Timeline</h1>
                  </div>
                </div>
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
                <button
                  type="button"
                  className="topbar-toggle-sidebar-btn"
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                  aria-label="Chuyển đổi thanh điều hướng"
                >
                  <IconMenu />
                </button>
                <h1>Xác nhận phê duyệt</h1>
              </div>
            </header>
            <section className="project-index">

              {/* Filter Tabs */}
              <div className="table-filters" style={{ margin: "14px 24px 14px", border: "none" }}>
                <div className="gms-function-tabs" style={{ margin: 0 }}>
                  <button className={confirmFilter === "all" ? "active" : ""} onClick={() => { setConfirmFilter("all"); setConfirmPage(1); }}>
                    Tất cả dự án <b>{confirmEligibleProjects.length}</b>
                  </button>
                  <button className={confirmFilter === "pending" ? "active" : ""} onClick={() => { setConfirmFilter("pending"); setConfirmPage(1); }}>
                    Chưa xác nhận <b>{confirmEligibleProjects.filter((p) => !(p.isOfficialApproved && (p.eApprovalUrl || p.eApprovalCode))).length}</b>
                  </button>
                  <button className={confirmFilter === "approved" ? "active" : ""} onClick={() => { setConfirmFilter("approved"); setConfirmPage(1); }}>
                    Đã phê duyệt <b>{confirmEligibleProjects.filter((p) => Boolean(p.isOfficialApproved && (p.eApprovalUrl || p.eApprovalCode))).length}</b>
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
                    {pagedConfirmProjects.map((project) => {
                      const isApprovedWithEApp = Boolean(project.isOfficialApproved && (project.eApprovalUrl || project.eApprovalCode));
                      return (
                      <div key={project.id} className="project-table-row">
                        <span className="project-code">{project.code}</span>
                        <span className="project-name-cell">
                          <b>{project.name}</b>
                        </span>
                        <span className="project-region-cell">{project.region || project.area || "—"}</span>
                        <span>
                          {isApprovedWithEApp ? (
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
                          {!isApprovedWithEApp ? (
                            <button
                              type="button"
                              className="primary-button"
                              style={{ height: "30px", fontSize: "11px", fontWeight: 700, padding: "0 10px", background: "#16a34a", borderColor: "#15803d", whiteSpace: "nowrap" }}
                              onClick={() => openEApprovalModal(project)}
                            >
                              Xác nhận phê duyệt
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{ height: "30px", fontSize: "11px", fontWeight: 600, padding: "0 10px", whiteSpace: "nowrap" }}
                              title="Chỉnh sửa thông tin E-Approval"
                              onClick={() => openEApprovalModal(project)}
                            >
                              Xác nhận phê duyệt
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
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="project-index-empty">
                  <b>Chưa có dự án nào chuyển sang Xác nhận phê duyệt</b>
                  <span>Chỉ các dự án đã có trạng thái "Đã hoàn thiện" tại mục Hoàn thiện tiến độ mới xuất hiện tại đây.</span>
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
                      let sum = 0;
                      let nonSummaryCount = 0;
                      let lateCount = 0;
                      for (const t of tasks) {
                        if (!t.summary) {
                          nonSummaryCount++;
                          sum += t.actualProgress;
                          if (t.actualStatus === "Trễ hạn") lateCount++;
                        }
                      }
                      const progress = nonSummaryCount ? Math.round(sum / nonSummaryCount) : 0;
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
          <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#f8fafc" }}>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    className="topbar-toggle-sidebar-btn"
                    onClick={() => setSidebarCollapsed((prev) => !prev)}
                    title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                    aria-label="Chuyển đổi thanh điều hướng"
                  >
                    <IconMenu />
                  </button>
                  <h1 style={{ margin: 0 }}>Lập Nhiệm Vụ Thiết Kế</h1>
                </div>
              </div>
              <div className="page-top-actions">
                <button type="button" className="secondary-button" onClick={() => setView("projects")}>← Quay lại MTL</button>
              </div>
            </header>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
              <div style={{
                maxWidth: "480px",
                width: "100%",
                background: "#ffffff",
                borderRadius: "16px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)",
                padding: "48px 32px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center"
              }}>
                <div style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  background: "#eff6ff",
                  border: "2px solid #bfdbfe",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "32px",
                  marginBottom: "20px"
                }}>
                  🚧
                </div>
                <span style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  borderRadius: "20px",
                  background: "#fef3c7",
                  color: "#92400e",
                  fontSize: "12px",
                  fontWeight: 700,
                  marginBottom: "12px",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase"
                }}>
                  Tính năng đang phát triển
                </span>
                <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 10px" }}>
                  Đang xây dựng
                </h2>
                <p style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6, margin: "0 0 28px", maxWidth: "380px" }}>
                  Phân hệ quản lý hồ sơ và quy trình phê duyệt Nhiệm vụ thiết kế (NVTK) hiện đang được xây dựng và sẽ sớm ra mắt trong các phiên bản tiếp theo.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setView("projects")}
                  style={{
                    padding: "10px 24px",
                    fontSize: "13px",
                    fontWeight: 700,
                    borderRadius: "8px",
                    background: "#2563eb",
                    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.2)"
                  }}
                >
                  ← Về Hoàn thiện tiến độ
                </button>
              </div>
            </div>
          </div>
        ) : view === "fs_ver2" ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", background: "#f8fafc" }}>
            <header className="page-top-header">
              <div className="page-top-title-group">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    type="button"
                    className="topbar-toggle-sidebar-btn"
                    onClick={() => setSidebarCollapsed((prev) => !prev)}
                    title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                    aria-label="Chuyển đổi thanh điều hướng"
                  >
                    <IconMenu />
                  </button>
                  <h1 style={{ margin: 0 }}>Lập FS Thực Thi (FS-Ver2)</h1>
                </div>
              </div>
              <div className="page-top-actions">
                <button type="button" className="secondary-button" onClick={() => setView("projects")}>← Quay lại MTL</button>
              </div>
            </header>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px" }}>
              <div style={{
                maxWidth: "480px",
                width: "100%",
                background: "#ffffff",
                borderRadius: "16px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)",
                padding: "48px 32px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center"
              }}>
                <div style={{
                  width: "72px",
                  height: "72px",
                  borderRadius: "50%",
                  background: "#f0fdf4",
                  border: "2px solid #bbf7d0",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "32px",
                  marginBottom: "20px"
                }}>
                  🚧
                </div>
                <span style={{
                  display: "inline-block",
                  padding: "4px 12px",
                  borderRadius: "20px",
                  background: "#fef3c7",
                  color: "#92400e",
                  fontSize: "12px",
                  fontWeight: 700,
                  marginBottom: "12px",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase"
                }}>
                  Tính năng đang phát triển
                </span>
                <h2 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: "0 0 10px" }}>
                  Đang xây dựng
                </h2>
                <p style={{ fontSize: "14px", color: "#64748b", lineHeight: 1.6, margin: "0 0 28px", maxWidth: "380px" }}>
                  Phân hệ lập kế hoạch và phân tích tính khả thi dự án (FS-Ver2) hiện đang được xây dựng và sẽ sớm ra mắt trong các phiên bản tiếp theo.
                </p>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setView("projects")}
                  style={{
                    padding: "10px 24px",
                    fontSize: "13px",
                    fontWeight: 700,
                    borderRadius: "8px",
                    background: "#16a34a",
                    boxShadow: "0 4px 12px rgba(22, 163, 74, 0.2)"
                  }}
                >
                  ← Về Hoàn thiện tiến độ
                </button>
              </div>
            </div>
          </div>
        ) : view === "init_template" ? (
          <div className="init-template-view">
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
                <h1>Khởi tạo tiến độ</h1>
              </div>

              {/* Mode Switcher Tabs */}
              <div className="init-mode-switcher" role="tablist" style={{ margin: 0 }}>
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
            </header>

            {/* Main Body */}
            <div className="init-template-body" style={{ padding: "16px 24px 20px" }}>

              {initMode === "from_template" ? (
                /* ================= MODE 1: KHỞI TẠO MỚI TỪ MẪU CHUẨN ================= */
                <>
                  <div className="init-template-grid">
                    {/* Column 1: Thông tin dự án mới */}
                    <div className="init-col-card" style={{ height: "calc(100vh - 230px)", minHeight: "560px", display: "flex", flexDirection: "column", overflowY: "auto" }}>
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
                            <option value="Nhà ở thấp tầng">Nhà ở thấp tầng</option>
                            <option value="Chung cư cao tầng">Chung cư cao tầng</option>
                            <option value="Khách sạn">Khách sạn</option>
                            <option value="Biệt thự nghỉ dưỡng">Biệt thự nghỉ dưỡng</option>
                            <option value="Công viên nước">Công viên nước</option>
                          </select>
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Vùng dự án</label>
                          <select
                            className="init-field-select"
                            value={initRegion}
                            onChange={(e) => {
                              setInitRegion(e.target.value);
                              setInitArea(e.target.value);
                            }}
                          >
                            <option value="Đồng Nai 1">Đồng Nai 1</option>
                            <option value="Tp HCM 1">Tp HCM 1</option>
                            <option value="Hồ Tràm 1">Hồ Tràm 1</option>
                            <option value="Phan Thiết 1">Phan Thiết 1</option>
                          </select>
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">
                            Ngày bắt đầu dự án <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <input
                            type="date"
                            className="init-field-input"
                            value={initStartDate}
                            onChange={(e) => setInitStartDate(e.target.value)}
                            required
                          />
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Ngày mục tiêu khởi công</label>
                          <input
                            type="date"
                            className="init-field-input"
                            value={initGroundbreakingDate}
                            onChange={(e) => setInitGroundbreakingDate(e.target.value)}
                          />
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Ngày mục tiêu mở bán</label>
                          <input
                            type="date"
                            className="init-field-input"
                            value={initSalesStartDate}
                            onChange={(e) => setInitSalesStartDate(e.target.value)}
                          />
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">Ngày mục tiêu bàn giao</label>
                          <input
                            type="date"
                            className="init-field-input"
                            value={initHandoverDate}
                            onChange={(e) => setInitHandoverDate(e.target.value)}
                          />
                        </div>

                        <div className="init-field">
                          <label className="init-field-label">
                            Ngày kết thúc hoàn toàn dự án <span style={{ color: "#ef4444" }}>*</span>
                          </label>
                          <input
                            type="date"
                            className="init-field-input"
                            value={initEndDate}
                            onChange={(e) => setInitEndDate(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Cấu trúc Master Timeline (9-4) */}
                    <div className="init-col-card" style={{ height: "calc(100vh - 230px)", minHeight: "560px", display: "flex", flexDirection: "column" }}>
                      <div className="init-col-head">
                        <span className="init-num-badge">2</span>
                        <span className="init-col-title">Cấu trúc Master Timeline (9-4)</span>
                      </div>

                      <div style={{ fontSize: "11px", color: "#64748b", marginBottom: 8, lineHeight: "1.4" }}>
                        Nhấn vào từng ban/phòng bên dưới để xem phân rã WBS ở bảng bên phải:
                      </div>

                      <div className="init-wbs-scroll-container" style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
                        {[
                          { code: "9.1", short: "HRC", name: "Ban Nhân sự", desc: "Quản lý nguồn nhân lực, tuyển dụng, đào tạo & HRBP", count: "57 task", type: "khoi9" },
                          { code: "9.2", short: "FAC", name: "Ban Tài chính Kế toán", desc: "FS, CF, P/L, quản trị vốn, dòng tiền Capex/Opex", count: "160 task", type: "khoi9" },
                          { code: "9.3", short: "SAC", name: "Ban Kinh doanh", desc: "Kế hoạch sản phẩm, bán hàng B2C, khai thác thương mại", count: "44 task", type: "khoi9" },
                          { code: "9.4", short: "MAC", name: "Ban Marketing", desc: "Chiến lược MKT, sự kiện mở bán, nội dung & digital", count: "145 task", type: "khoi9" },
                          { code: "9.5", short: "PTC", name: "Ban Cung ứng Đấu thầu", desc: "Cung ứng VLXD/MEP, tổ chức đấu thầu & thanh quyết toán", count: "128 task", type: "khoi9" },
                          { code: "9.6", short: "QSB", name: "Phòng Khối lượng và Ngân sách", desc: "Suất đầu tư, ngân sách xây dựng, kiểm soát khối lượng BoQ", count: "43 task", type: "khoi9" },
                          { code: "9.7", short: "SED", name: "Phòng An ninh", desc: "Phương án an ninh nội bộ, bảo vệ dự án, giám sát an toàn", count: "30 task", type: "khoi9" },
                          { code: "9.8", short: "IDD", name: "Phòng Thiết kế Nội bộ", desc: "Thiết kế quy hoạch, ý tưởng kiến trúc, nội thất & cảnh quan", count: "169 task", type: "khoi9" },
                          { code: "9.9", short: "CSC", name: "Trung tâm Bồi thường GPMB", desc: "Kế hoạch đền bù, thỏa thuận bồi thường & giải phóng MB", count: "7 task", type: "khoi9" },
                          { code: "4.0", short: "PMD", name: "Phòng Điều hành Dự án", desc: "Chủ trì lập, tích hợp & điều phối tổng tiến độ MTL", count: "7 task", type: "khoi4" },
                          { code: "4.1", short: "PLP", name: "Phòng Thủ tục Pháp lý Dự án", desc: "Chủ trương ĐT, quy hoạch 1/500, đất đai, GPXD, nghiệm thu", count: "99 task", type: "khoi4" },
                          { code: "4.2", short: "DMD", name: "Phòng Quản lý Thiết kế", desc: "Nhiệm vụ thiết kế, TKCS, TKBVTC, thẩm duyệt PCCC", count: "120 task", type: "khoi4" },
                          { code: "4.3", short: "PCD", name: "Phòng Quản lý Xây dựng, An toàn & MT", desc: "Mặt bằng, cọc móng, kết cấu ngầm/thân, MEP, hạ tầng", count: "74 task", type: "khoi4" },
                          { code: "4.4", short: "OM", name: "Phòng Quản lý Vận hành Dự án", desc: "Phí QLVH, pre-opening vận hành, nghiệm thu bàn giao", count: "17 task", type: "khoi4" },
                        ].map((g) => {
                          const isSelected = initSelectedDeptCode === g.code;
                          const isKhoi9 = g.type === "khoi9";
                          return (
                            <div
                              key={g.code}
                              onClick={() => setInitSelectedDeptCode(g.code)}
                              style={{
                                background: isSelected
                                  ? (isKhoi9 ? "#eff6ff" : "#f0fdf4")
                                  : (isKhoi9 ? "#f8fafc" : "#f0fdf4"),
                                border: isSelected
                                  ? (isKhoi9 ? "2px solid #2563eb" : "2px solid #16a34a")
                                  : (isKhoi9 ? "1px solid #e2e8f0" : "1px solid #bbf7d0"),
                                borderRadius: 6,
                                padding: "6px 8px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8,
                                cursor: "pointer",
                                transition: "all 0.12s ease",
                              }}
                              title={`Bấm để xem công việc phân rã của ${g.short} – ${g.name}`}
                            >
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{
                                  fontSize: "11.5px",
                                  fontWeight: 700,
                                  color: isSelected
                                    ? (isKhoi9 ? "#1d4ed8" : "#15803d")
                                    : (isKhoi9 ? "#0f172a" : "#14532d"),
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 5,
                                }}>
                                  <span style={{ color: isKhoi9 ? "#2563eb" : "#15803d" }}>{g.code}</span>
                                  <span>{g.short} – {g.name}</span>
                                  {isSelected && (
                                    <span style={{
                                      fontSize: "9.5px",
                                      fontWeight: 800,
                                      color: "#ffffff",
                                      background: isKhoi9 ? "#2563eb" : "#16a34a",
                                      padding: "1px 5px",
                                      borderRadius: 3,
                                      marginLeft: "auto",
                                    }}>
                                      Đang chọn
                                    </span>
                                  )}
                                </div>
                                <div style={{
                                  fontSize: "10px",
                                  color: isSelected
                                    ? (isKhoi9 ? "#2563eb" : "#16a34a")
                                    : (isKhoi9 ? "#64748b" : "#475569"),
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}>
                                  {g.desc}
                                </div>
                              </div>
                              <span style={{
                                fontSize: "10.5px",
                                fontWeight: 700,
                                color: isSelected
                                  ? "#ffffff"
                                  : (isKhoi9 ? "#2563eb" : "#166534"),
                                background: isSelected
                                  ? (isKhoi9 ? "#2563eb" : "#16a34a")
                                  : (isKhoi9 ? "#eff6ff" : "#ffffff"),
                                border: `1px solid ${isKhoi9 ? "#bfdbfe" : "#86efac"}`,
                                padding: "2px 6px",
                                borderRadius: 4,
                                flex: "none",
                              }}>
                                {g.count}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Column 3: Chi tiết công việc */}
                    <div className="init-col-card" style={{ minWidth: 0, height: "calc(100vh - 230px)", minHeight: "560px", display: "flex", flexDirection: "column" }}>
                      <div className="init-col-head" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <span className="init-num-badge">3</span>
                        <span className="init-col-title">Chi tiết công việc</span>
                        {(() => {
                          const allDepts = [
                            { code: "9.1", short: "HRC", name: "Ban Nhân sự" },
                            { code: "9.2", short: "FAC", name: "Ban Tài chính Kế toán" },
                            { code: "9.3", short: "SAC", name: "Ban Kinh doanh" },
                            { code: "9.4", short: "MAC", name: "Ban Marketing" },
                            { code: "9.5", short: "PTC", name: "Ban Cung ứng Đấu thầu" },
                            { code: "9.6", short: "QSB", name: "Phòng Khối lượng và Ngân sách" },
                            { code: "9.7", short: "SED", name: "Phòng An ninh" },
                            { code: "9.8", short: "IDD", name: "Phòng Thiết kế Nội bộ" },
                            { code: "9.9", short: "CSC", name: "Trung tâm Bồi thường GPMB" },
                            { code: "4.0", short: "PMD", name: "Phòng Điều hành Dự án" },
                            { code: "4.1", short: "PLP", name: "Phòng Thủ tục Pháp lý Dự án" },
                            { code: "4.2", short: "DMD", name: "Phòng Quản lý Thiết kế" },
                            { code: "4.3", short: "PCD", name: "Phòng Quản lý Xây dựng, An toàn & MT" },
                            { code: "4.4", short: "OM", name: "Phòng Quản lý Vận hành Dự án" },
                          ];
                          const activeDept = allDepts.find((d) => d.code === initSelectedDeptCode);
                          if (activeDept) {
                            const isKhoi9 = activeDept.code.startsWith("9.");
                            return (
                              <span style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                color: isKhoi9 ? "#1d4ed8" : "#166534",
                                background: isKhoi9 ? "#dbeafe" : "#dcfce7",
                                border: `1px solid ${isKhoi9 ? "#bfdbfe" : "#bbf7d0"}`,
                                padding: "2px 8px",
                                borderRadius: 4,
                              }}>
                                {activeDept.code} · {activeDept.name} ({initWbsTasks.length} task)
                              </span>
                            );
                          }
                          return (
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
                              Toàn bộ 14 ban/phòng ({fullCatalog.length} task)
                            </span>
                          );
                        })()}

                        <label
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#475569",
                            background: "#f8fafc",
                            border: "1px solid #cbd5e1",
                            borderRadius: "5px",
                            padding: "2px 6px 2px 8px",
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ whiteSpace: "nowrap" }}>Cấp công việc</span>
                          <select
                            value={initWbsLevel}
                            onChange={(e) => applyInitWbsLevel(e.target.value === "all" ? "all" : Number(e.target.value))}
                            style={{
                              height: "24px",
                              padding: "0 6px",
                              fontSize: "11px",
                              fontWeight: 600,
                              color: "#0f172a",
                              background: "#ffffff",
                              border: "1px solid #cbd5e1",
                              borderRadius: "4px",
                              outline: "none",
                              cursor: "pointer",
                            }}
                            title="Hiển thị theo cấp công việc"
                          >
                            <option value="all">Tất cả cấp</option>
                            <option value="1">Cấp 1</option>
                            <option value="2">Cấp 2</option>
                            <option value="3">Cấp 3</option>
                            <option value="4">Cấp 4</option>
                            <option value="5">Cấp 5</option>
                            {initWbsLevel === "custom" && <option value="custom">Tùy biến</option>}
                          </select>
                        </label>
                        {initSelectedDeptCode !== "all" ? (
                          <button
                            type="button"
                            className="init-tree-ctrl-btn"
                            onClick={() => setInitSelectedDeptCode("all")}
                            style={{ background: "#e0e7ff", color: "#3730a3", borderColor: "#c7d2fe" }}
                            title="Hiển thị toàn bộ công việc của tất cả 14 ban/phòng"
                          >
                            Tất cả
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="init-tree-ctrl-btn"
                            onClick={() => setInitSelectedDeptCode("9.1")}
                            style={{ background: "#dbeafe", color: "#1e40af", borderColor: "#bfdbfe" }}
                            title="Quay lại lọc theo ban/phòng"
                          >
                            Theo ban/phòng
                          </button>
                        )}
                      </div>

                      {/* Search bar inside Column 3 */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <input
                          type="text"
                          className="init-field-input"
                          style={{ height: "30px", fontSize: "11.5px", padding: "4px 10px" }}
                          placeholder="Tìm kiếm công việc theo mã WBS hoặc tên..."
                          value={initWbsSearch}
                          onChange={(e) => setInitWbsSearch(e.target.value)}
                        />
                        <span style={{ fontSize: "11px", color: "#64748b", whiteSpace: "nowrap", flex: "none" }}>
                          Hiển thị <strong>{visibleInitWbsTasks.length}</strong> công việc
                        </span>
                      </div>

                      {/* The WBS Decomposed Table matching user screenshot */}
                      <div
                        className="init-wbs-scroll-container"
                        style={{
                          flex: 1,
                          minHeight: 0,
                          overflowY: "auto",
                          overflowX: "auto",
                          border: "1px solid #e2e8f0",
                          borderRadius: 8,
                          background: "#ffffff",
                        }}
                      >
                        <div className="init-wbs-table" style={{ minWidth: 580 }}>
                          <div className="init-wbs-head">
                            <span>WBS</span>
                            <span>HẠNG MỤC CÔNG VIỆC</span>
                            <span>LOẠI CÔNG VIỆC</span>
                            <span>TRẠNG THÁI</span>
                          </div>
                          <div className="init-wbs-body">
                            {visibleInitWbsTasks.map((task) => {
                              const hasChildren = catalogParentCodes.has(task.code);
                              const isCollapsed = initWbsCollapsed.has(task.code);
                              const isEnabled = enabledCatalogCodes.has(task.code);
                              return (
                                <div
                                  key={task.code}
                                  className={`init-wbs-row ${isEnabled ? "auto-enabled" : ""}`}
                                >
                                  {/* WBS Cell */}
                                  <div
                                    className="init-wbs-cell"
                                    style={{
                                      paddingLeft: `${Math.max(0, (task.level - 1) * 14)}px`,
                                    }}
                                  >
                                    {hasChildren ? (
                                      <button
                                        type="button"
                                        className="catalog-tree-toggle"
                                        aria-expanded={!isCollapsed}
                                        aria-label={isCollapsed ? `Mở rộng ${task.code}` : `Thu gọn ${task.code}`}
                                        title={isCollapsed ? "Mở rộng" : "Thu gọn"}
                                        onClick={() => {
                                          setInitWbsLevel("custom");
                                          setInitWbsCollapsed((current) => {
                                            const next = new Set(current);
                                            if (isCollapsed) next.delete(task.code);
                                            else next.add(task.code);
                                            return next;
                                          });
                                        }}
                                      >
                                        {isCollapsed ? "+" : "−"}
                                      </button>
                                    ) : (
                                      <i className="catalog-tree-spacer" aria-hidden="true" />
                                    )}
                                    <b className="catalog-wbs-code" title={task.code}>
                                      {task.code}
                                    </b>
                                  </div>

                                  {/* Hạng mục công việc Cell */}
                                  <div
                                    className="init-name-cell"
                                    style={{
                                      fontWeight: task.level === 1 ? 800 : task.level === 2 ? 700 : task.level === 3 ? 700 : 500,
                                      fontSize: task.level === 1 ? "13px" : task.level === 2 ? "12.5px" : "12px",
                                      textTransform: task.level <= 2 ? "uppercase" : "none",
                                      color: task.level === 1 ? "#0f172a" : task.level === 2 ? "#1e293b" : "#334155",
                                    }}
                                    title={task.name}
                                  >
                                    {task.name}
                                  </div>

                                  {/* Loại công việc Cell */}
                                  <div>
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
                                  </div>

                                  {/* Trạng thái Cell */}
                                  <div>
                                    <label className="auto-generate-check">
                                      <input
                                        type="checkbox"
                                        checked={isEnabled}
                                        onChange={() => toggleCatalogTask(task)}
                                        aria-label={`Trạng thái ${task.code}`}
                                      />
                                      <i />
                                      <b>{isEnabled ? "Có" : "Không"}</b>
                                    </label>
                                  </div>
                                </div>
                              );
                            })}
                            {!visibleInitWbsTasks.length && (
                              <div style={{ padding: "32px 16px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                                Không có công việc nào phù hợp với bộ lọc hoặc tìm kiếm.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bottom Notification & Action Bar */}
                  <div className="init-bottom-bar">
                    <div className="init-info-pill">
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#16a34a" }}>ℹ</span>
                      <span>Hệ thống tự động cân chỉnh thời lượng (duration) của toàn bộ công việc để gói gọn tổng thể trong 2 mốc Ngày bắt đầu và Ngày kết thúc.</span>
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
                          if (!initStartDate || !initEndDate) {
                            alert("Vui lòng nhập Ngày bắt đầu dự án và Ngày kết thúc hoàn toàn dự án.");
                            return;
                          }
                          if (initEndDate <= initStartDate) {
                            alert("Ngày kết thúc hoàn toàn dự án phải sau Ngày bắt đầu dự án.");
                            return;
                          }
                          const newId = `project-${Date.now()}`;
                          const allGroupCodes = GROUPS.map((g) => g.code);
                          const allTaskCodes = fullCatalog.map((t) => t.code);
                          const milestoneDates: MilestoneDates = {};
                          if (initGroundbreakingDate) milestoneDates["MILE_PCD_01"] = initGroundbreakingDate;
                          if (initSalesStartDate) milestoneDates["MILE_COM_02"] = initSalesStartDate;
                          if (initHandoverDate) milestoneDates["MILE_OM_02"] = initHandoverDate;

                          const newProjDraft: Project = {
                            id: newId,
                            name: initProjectName.trim() || "Dự án mới",
                            code: initProjectCode.trim() || `PRJ-${Date.now().toString().slice(-4)}`,
                            type: initProjectType || "Nhà ở thấp tầng",
                            investor: initInvestor || "Tập đoàn Novaland",
                            location: initRegion || "Đồng Nai 1",
                            area: initRegion || "Đồng Nai 1",
                            region: initRegion || "Đồng Nai 1",
                            startDate: initStartDate,
                            targetDate: initEndDate,
                            parameters: {
                              ...DEFAULT_PROJECT_PARAMETERS,
                              loaiHinhDuAn: (["Nhà ở thấp tầng", "Chung cư cao tầng", "Khách sạn", "Biệt thự nghỉ dưỡng", "Công viên nước"].includes(initProjectType)
                                ? initProjectType
                                : "Nhà ở thấp tầng") as ProjectParameters["loaiHinhDuAn"],
                            },
                            parameterImpacts: [],
                            milestoneDates,
                            selectedGroups: allGroupCodes,
                            createdAt: new Date().toISOString(),
                            taskEdits: {},
                            taskDependencies: defaultDependenciesForCodes(allTaskCodes),
                            customTasks: [],
                            includedTaskCodes: allTaskCodes,
                            departmentApprovals: normalizeDepartmentApprovals(allGroupCodes),
                            approvalStatus: "draft",
                            officialVersion: "v1.0",
                          };

                          const calibratedEdits = generateCalibratedTaskEdits(newProjDraft);
                          const newProj: Project = {
                            ...newProjDraft,
                            taskEdits: calibratedEdits,
                          };

                          setProjects((prev) => [newProj, ...prev]);
                          setActiveId(newId);
                          setSelectedCode("");
                          setWorkspaceDeptFilter("all");
                          setWorkspaceLevelFilter("all");
                          setView("workspace");
                          notify(`Đã khởi tạo thành công tiến độ cho "${newProj.name}"! Toàn bộ công việc đã được cân chỉnh thời lượng gói gọn từ ${formatDate(initStartDate)} đến ${formatDate(initEndDate)}.`);
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
                          <div className="init-col-card" style={{ height: "calc(100vh - 230px)", minHeight: "560px", display: "flex", flexDirection: "column", overflowY: "auto" }}>
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
                                  <span className="approved-version-pill" style={{ background: "#2563eb" }}>
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

                              {/* Hồ sơ phê duyệt trước đó tóm tắt */}
                              <div className="version-meta-box" style={{ marginTop: 4 }}>
                                <div style={{ fontSize: "11.5px", fontWeight: 700, color: "#1e3a8a", marginBottom: 4, display: "flex", alignItems: "center", gap: 5 }}>
                                  <span>📋</span> Hồ sơ Version đã duyệt trước đó:
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Mã dự án:</span>
                                  <span className="version-meta-val" style={{ color: "#2563eb" }}>{targetProject?.code}</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Số quyết định:</span>
                                  <span className="version-meta-val">{approvalCode}</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Ngày ký duyệt:</span>
                                  <span className="version-meta-val">{formatDate(approvalDate)}</span>
                                </div>
                                <div className="version-meta-row">
                                  <span className="version-meta-label">Quy mô WBS kế thừa:</span>
                                  <span className="version-meta-val" style={{ color: "#16a34a" }}>14 Ban/Phòng · {targetScheduledTasks.length} task</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Column 2: Cấu trúc Master Timeline (9-4) */}
                          <div className="init-col-card" style={{ height: "calc(100vh - 230px)", minHeight: "560px", display: "flex", flexDirection: "column" }}>
                            <div className="init-col-head">
                              <span className="init-num-badge" style={{ background: "#2563eb" }}>2</span>
                              <span className="init-col-title">Cấu trúc Master Timeline (9-4)</span>
                            </div>

                            <div style={{ fontSize: "11px", color: "#64748b", marginBottom: 8, lineHeight: "1.4" }}>
                              Nhấn vào từng ban/phòng bên dưới để xem phân rã WBS kế thừa ở bảng bên phải:
                            </div>

                            <div className="init-wbs-scroll-container" style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
                              {[
                                { code: "9.1", short: "HRC", name: "Ban Nhân sự", desc: "Quản lý nguồn nhân lực, tuyển dụng, đào tạo & HRBP", type: "khoi9" },
                                { code: "9.2", short: "FAC", name: "Ban Tài chính Kế toán", desc: "FS, CF, P/L, quản trị vốn, dòng tiền Capex/Opex", type: "khoi9" },
                                { code: "9.3", short: "SAC", name: "Ban Kinh doanh", desc: "Kế hoạch sản phẩm, bán hàng B2C, khai thác thương mại", type: "khoi9" },
                                { code: "9.4", short: "MAC", name: "Ban Marketing", desc: "Chiến lược MKT, sự kiện mở bán, nội dung & digital", type: "khoi9" },
                                { code: "9.5", short: "PTC", name: "Ban Cung ứng Đấu thầu", desc: "Cung ứng VLXD/MEP, tổ chức đấu thầu & thanh quyết toán", type: "khoi9" },
                                { code: "9.6", short: "QSB", name: "Phòng Khối lượng và Ngân sách", desc: "Suất đầu tư, ngân sách xây dựng, kiểm soát khối lượng BoQ", type: "khoi9" },
                                { code: "9.7", short: "SED", name: "Phòng An ninh", desc: "Phương án an ninh nội bộ, bảo vệ dự án, giám sát an toàn", type: "khoi9" },
                                { code: "9.8", short: "IDD", name: "Phòng Thiết kế Nội bộ", desc: "Thiết kế quy hoạch, ý tưởng kiến trúc, nội thất & cảnh quan", type: "khoi9" },
                                { code: "9.9", short: "CSC", name: "Trung tâm Bồi thường GPMB", desc: "Kế hoạch đền bù, thỏa thuận bồi thường & giải phóng MB", type: "khoi9" },
                                { code: "4.0", short: "PMD", name: "Phòng Điều hành Dự án", desc: "Chủ trì lập, tích hợp & điều phối tổng tiến độ MTL", type: "khoi4" },
                                { code: "4.1", short: "PLP", name: "Phòng Thủ tục Pháp lý Dự án", desc: "Chủ trương ĐT, quy hoạch 1/500, đất đai, GPXD, nghiệm thu", type: "khoi4" },
                                { code: "4.2", short: "DMD", name: "Phòng Quản lý Thiết kế", desc: "Nhiệm vụ thiết kế, TKCS, TKBVTC, thẩm duyệt PCCC", type: "khoi4" },
                                { code: "4.3", short: "PCD", name: "Phòng Quản lý Xây dựng, An toàn & MT", desc: "Mặt bằng, cọc móng, kết cấu ngầm/thân, MEP, hạ tầng", type: "khoi4" },
                                { code: "4.4", short: "OM", name: "Phòng Quản lý Vận hành Dự án", desc: "Phí QLVH, pre-opening vận hành, nghiệm thu bàn giao", type: "khoi4" },
                              ].map((g) => {
                                const isSelected = initUpdateSelectedDeptCode === g.code;
                                const isKhoi9 = g.type === "khoi9";
                                const deptTaskCount = targetScheduledTasks.filter((t) => t.groupCode === g.code).length;
                                return (
                                  <div
                                    key={g.code}
                                    onClick={() => setInitUpdateSelectedDeptCode(g.code)}
                                    style={{
                                      background: isSelected
                                        ? (isKhoi9 ? "#eff6ff" : "#f0fdf4")
                                        : (isKhoi9 ? "#f8fafc" : "#f0fdf4"),
                                      border: isSelected
                                        ? (isKhoi9 ? "2px solid #2563eb" : "2px solid #16a34a")
                                        : (isKhoi9 ? "1px solid #e2e8f0" : "1px solid #bbf7d0"),
                                      borderRadius: 6,
                                      padding: "6px 8px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 8,
                                      cursor: "pointer",
                                      transition: "all 0.12s ease",
                                    }}
                                    title={`Bấm để xem công việc kế thừa của ${g.short} – ${g.name}`}
                                  >
                                    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                                      <div style={{
                                        fontSize: "12px",
                                        fontWeight: 700,
                                        color: isSelected
                                          ? (isKhoi9 ? "#1d4ed8" : "#166534")
                                          : "#1e293b",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 5,
                                      }}>
                                        <b style={{ color: isKhoi9 ? "#2563eb" : "#16a34a" }}>{g.code}</b>
                                        <span>{g.short}</span>
                                        <span style={{ fontWeight: 500, color: "#64748b" }}>– {g.name}</span>
                                      </div>
                                      <div style={{ fontSize: "10.5px", color: "#64748b", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                                        {g.desc}
                                      </div>
                                    </div>
                                    <span style={{
                                      fontSize: "10.5px",
                                      fontWeight: 700,
                                      color: isSelected
                                        ? "#ffffff"
                                        : (isKhoi9 ? "#2563eb" : "#166534"),
                                      background: isSelected
                                        ? (isKhoi9 ? "#2563eb" : "#16a34a")
                                        : (isKhoi9 ? "#eff6ff" : "#ffffff"),
                                      border: `1px solid ${isKhoi9 ? "#bfdbfe" : "#86efac"}`,
                                      padding: "2px 6px",
                                      borderRadius: 4,
                                      flex: "none",
                                    }}>
                                      {deptTaskCount} task
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Column 3: Chi tiết công việc kế thừa */}
                          <div className="init-col-card" style={{ minWidth: 0, height: "calc(100vh - 230px)", minHeight: "560px", display: "flex", flexDirection: "column" }}>
                            <div className="init-col-head" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                              <span className="init-num-badge" style={{ background: "#2563eb" }}>3</span>
                              <span className="init-col-title">Chi tiết công việc</span>
                              {(() => {
                                const allDepts = [
                                  { code: "9.1", short: "HRC", name: "Ban Nhân sự" },
                                  { code: "9.2", short: "FAC", name: "Ban Tài chính Kế toán" },
                                  { code: "9.3", short: "SAC", name: "Ban Kinh doanh" },
                                  { code: "9.4", short: "MAC", name: "Ban Marketing" },
                                  { code: "9.5", short: "PTC", name: "Ban Cung ứng Đấu thầu" },
                                  { code: "9.6", short: "QSB", name: "Phòng Khối lượng và Ngân sách" },
                                  { code: "9.7", short: "SED", name: "Phòng An ninh" },
                                  { code: "9.8", short: "IDD", name: "Phòng Thiết kế Nội bộ" },
                                  { code: "9.9", short: "CSC", name: "Trung tâm Bồi thường GPMB" },
                                  { code: "4.0", short: "PMD", name: "Phòng Điều hành Dự án" },
                                  { code: "4.1", short: "PLP", name: "Phòng Thủ tục Pháp lý Dự án" },
                                  { code: "4.2", short: "DMD", name: "Phòng Quản lý Thiết kế" },
                                  { code: "4.3", short: "PCD", name: "Phòng Quản lý Xây dựng, An toàn & MT" },
                                  { code: "4.4", short: "OM", name: "Phòng Quản lý Vận hành Dự án" },
                                ];
                                const activeDept = allDepts.find((d) => d.code === initUpdateSelectedDeptCode);
                                if (activeDept) {
                                  const isKhoi9 = activeDept.code.startsWith("9.");
                                  return (
                                    <span style={{
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      color: isKhoi9 ? "#1d4ed8" : "#166534",
                                      background: isKhoi9 ? "#dbeafe" : "#dcfce7",
                                      border: `1px solid ${isKhoi9 ? "#bfdbfe" : "#bbf7d0"}`,
                                      padding: "2px 8px",
                                      borderRadius: 4,
                                    }}>
                                      {activeDept.code} · {activeDept.name} ({initUpdateWbsTasks.length} task)
                                    </span>
                                  );
                                }
                                return (
                                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#475569", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
                                    Toàn bộ 14 ban/phòng ({targetScheduledTasks.length} task)
                                  </span>
                                );
                              })()}

                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: "#475569",
                                  background: "#f8fafc",
                                  border: "1px solid #cbd5e1",
                                  borderRadius: "5px",
                                  padding: "2px 6px 2px 8px",
                                  cursor: "pointer",
                                }}
                              >
                                <span style={{ whiteSpace: "nowrap" }}>Cấp công việc</span>
                                <select
                                  value={initUpdateWbsLevel}
                                  onChange={(e) => applyInitUpdateWbsLevel(e.target.value === "all" ? "all" : Number(e.target.value))}
                                  style={{
                                    height: "24px",
                                    padding: "0 6px",
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    color: "#0f172a",
                                    background: "#ffffff",
                                    border: "1px solid #cbd5e1",
                                    borderRadius: "4px",
                                    outline: "none",
                                    cursor: "pointer",
                                  }}
                                  title="Hiển thị theo cấp công việc"
                                >
                                  <option value="all">Tất cả cấp</option>
                                  <option value="1">Cấp 1</option>
                                  <option value="2">Cấp 2</option>
                                  <option value="3">Cấp 3</option>
                                  <option value="4">Cấp 4</option>
                                  <option value="5">Cấp 5</option>
                                  {initUpdateWbsLevel === "custom" && <option value="custom">Tùy biến</option>}
                                </select>
                              </label>
                              {initUpdateSelectedDeptCode !== "all" ? (
                                <button
                                  type="button"
                                  className="init-tree-ctrl-btn"
                                  onClick={() => setInitUpdateSelectedDeptCode("all")}
                                  style={{ background: "#e0e7ff", color: "#3730a3", borderColor: "#c7d2fe" }}
                                  title="Hiển thị toàn bộ công việc kế thừa của tất cả 14 ban/phòng"
                                >
                                  Tất cả
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="init-tree-ctrl-btn"
                                  onClick={() => setInitUpdateSelectedDeptCode("9.1")}
                                  style={{ background: "#dbeafe", color: "#1e40af", borderColor: "#bfdbfe" }}
                                  title="Quay lại lọc theo ban/phòng"
                                >
                                  Theo ban/phòng
                                </button>
                              )}
                            </div>

                            {/* Search bar inside Column 3 */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <input
                                type="text"
                                className="init-field-input"
                                style={{ height: "30px", fontSize: "11.5px", padding: "4px 10px" }}
                                placeholder="Tìm kiếm công việc theo mã WBS hoặc tên..."
                                value={initUpdateWbsSearch}
                                onChange={(e) => setInitUpdateWbsSearch(e.target.value)}
                              />
                              <span style={{ fontSize: "11px", color: "#64748b", whiteSpace: "nowrap", flex: "none" }}>
                                Hiển thị <strong>{visibleInitUpdateWbsTasks.length}</strong> công việc
                              </span>
                            </div>

                            {/* The WBS Decomposed Table */}
                            <div
                              className="init-wbs-scroll-container"
                              style={{
                                flex: 1,
                                minHeight: 0,
                                overflowY: "auto",
                                overflowX: "auto",
                                border: "1px solid #e2e8f0",
                                borderRadius: 8,
                                background: "#ffffff",
                              }}
                            >
                              <div className="init-wbs-table" style={{ minWidth: 580 }}>
                                <div className="init-wbs-head">
                                  <span>WBS</span>
                                  <span>HẠNG MỤC CÔNG VIỆC</span>
                                  <span>LOẠI CÔNG VIỆC</span>
                                  <span>TRẠNG THÁI</span>
                                </div>
                                <div className="init-wbs-body">
                                  {visibleInitUpdateWbsTasks.map((task) => {
                                    const hasChildren = catalogParentCodes.has(task.code);
                                    const isCollapsed = initUpdateWbsCollapsed.has(task.code);
                                    return (
                                      <div
                                        key={task.code}
                                        className="init-wbs-row auto-enabled"
                                      >
                                        {/* WBS Cell */}
                                        <div
                                          className="init-wbs-cell"
                                          style={{
                                            paddingLeft: `${Math.max(0, (task.level - 1) * 14)}px`,
                                          }}
                                        >
                                          {hasChildren ? (
                                            <button
                                              type="button"
                                              className="catalog-tree-toggle"
                                              aria-expanded={!isCollapsed}
                                              aria-label={isCollapsed ? `Mở rộng ${task.code}` : `Thu gọn ${task.code}`}
                                              title={isCollapsed ? "Mở rộng" : "Thu gọn"}
                                              onClick={() => {
                                                setInitUpdateWbsLevel("custom");
                                                setInitUpdateWbsCollapsed((current) => {
                                                  const next = new Set(current);
                                                  if (isCollapsed) next.delete(task.code);
                                                  else next.add(task.code);
                                                  return next;
                                                });
                                              }}
                                            >
                                              {isCollapsed ? "+" : "−"}
                                            </button>
                                          ) : (
                                            <i className="catalog-tree-spacer" aria-hidden="true" />
                                          )}
                                          <b className="catalog-wbs-code" title={task.code}>
                                            {task.code}
                                          </b>
                                        </div>

                                        {/* Hạng mục công việc Cell */}
                                        <div
                                          className="init-name-cell"
                                          style={{
                                            fontWeight: task.level === 1 ? 800 : task.level === 2 ? 700 : task.level === 3 ? 700 : 500,
                                            fontSize: task.level === 1 ? "13px" : task.level === 2 ? "12.5px" : "12px",
                                            textTransform: task.level <= 2 ? "uppercase" : "none",
                                            color: task.level === 1 ? "#0f172a" : task.level === 2 ? "#1e293b" : "#334155",
                                          }}
                                          title={task.name}
                                        >
                                          {task.name}
                                        </div>

                                        {/* Loại công việc Cell */}
                                        <div>
                                          <span style={{ fontSize: "11px", color: "#475569", fontWeight: 600 }}>
                                            {task.workGroup || "Phối hợp"}
                                          </span>
                                        </div>

                                        {/* Trạng thái Cell */}
                                        <div>
                                          <span
                                            className="status-badge"
                                            style={{
                                              background: "#eff6ff",
                                              color: "#1d4ed8",
                                              border: "1px solid #bfdbfe",
                                              fontSize: "10.5px",
                                              padding: "2px 6px",
                                            }}
                                          >
                                            Kế thừa
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {!visibleInitUpdateWbsTasks.length && (
                                    <div style={{ padding: "30px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                                      Không tìm thấy công việc nào phù hợp với bộ lọc hoặc từ khóa tìm kiếm.
                                    </div>
                                  )}
                                </div>
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
                                setSelectedCode("");
                                setWorkspaceDeptFilter("all");
                                setWorkspaceLevelFilter("all");
                                setView("workspace");
                                notify(`Đã khởi tạo thành công bản cập nhật ${newVer} cho dự án "${targetProject.name}"! Chuyển tiếp sang Hoàn thiện tiến độ.`);
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
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="topbar-toggle-sidebar-btn"
                  onClick={() => setSidebarCollapsed((prev) => !prev)}
                  title={sidebarCollapsed ? "Mở rộng thanh điều hướng (Ctrl+B)" : "Thu nhỏ thanh điều hướng (Ctrl+B)"}
                  aria-label="Chuyển đổi thanh điều hướng"
                >
                  <IconMenu />
                </button>
                <span style={{ fontSize: "13px", fontWeight: 800, color: "#1e3a8a", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <IconTimeline /> Hoàn thiện tiến độ
                </span>
                <span style={{ color: "#cbd5e1" }}>|</span>
                <button className="breadcrumb-back" onClick={() => setView("projects")}>← Danh sách dự án</button>
                <button
                  className="breadcrumb-back"
                  onClick={() => setView("init_template")}
                  style={{ color: "#16a34a", borderColor: "#bbf7d0", background: "#f0fdf4" }}
                >
                  + Khởi tạo tiến độ mới
                </button>
                {projects.length > 1 && (
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: "11px", fontWeight: 600, color: "#64748b" }}>
                    <span>Dự án:</span>
                    <select
                      value={activeProject.id}
                      onChange={(e) => {
                        setActiveId(e.target.value);
                        setSelectedCode("");
                      }}
                      style={{
                        height: "28px",
                        padding: "0 6px",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        borderRadius: "5px",
                        border: "1px solid #cbd5e1",
                        background: "#ffffff",
                        color: "#0f172a",
                        cursor: "pointer",
                        maxWidth: "200px",
                      }}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="top-actions">
                <span className="saved-state"><i />Đã lưu trên thiết bị</span>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ height: "30px", fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  onClick={applyDefaultDependencies}
                  disabled={activeProject.baselineLocked}
                  title="Cập nhật toàn bộ 788 liên kết chuẩn từ file MTL 9-4 vào dự án hiện tại"
                >
                  <span>🔗 Đồng bộ liên kết chuẩn</span>
                </button>
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
              </div>
            </header>

            <section className="project-header" style={{ padding: "14px 20px" }}>
              <div className="project-header-left">
                <div className="project-title-row">
                  <h1 style={{ fontSize: "20px", fontWeight: 800, margin: 0, color: "#0f172a" }}>{activeProject.name}</h1>
                </div>
              </div>
              <div className="top-stat-cards workspace-stat-cards">
                <div className="top-stat-card">
                  <span>CÔNG VIỆC</span>
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

            <section className="toolbar" aria-label="Công cụ danh sách MTL" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <div className="scope-tabs" style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={workspaceDeptFilter === "all" ? "active" : ""}
                  onClick={() => setWorkspaceDeptFilter("all")}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "6px",
                    border: "1px solid",
                    borderColor: workspaceDeptFilter === "all" ? "#2563eb" : "#cbd5e1",
                    background: workspaceDeptFilter === "all" ? "#eff6ff" : "#ffffff",
                    color: workspaceDeptFilter === "all" ? "#1d4ed8" : "#475569",
                    fontSize: "11.5px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Tất cả công việc ({scheduled.length})
                </button>
                <select
                  value={workspaceDeptFilter}
                  onChange={(e) => setWorkspaceDeptFilter(e.target.value)}
                  style={{
                    height: "28px",
                    padding: "0 8px",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#0f172a",
                    cursor: "pointer",
                  }}
                  title="Lọc theo ban/phòng phụ trách"
                >
                  <option value="all">-- Lọc theo Ban/Phòng (9-4) --</option>
                  <optgroup label="Khối 9 (Ban/Phòng Gián tiếp)">
                    {GROUPS.filter((g) => g.code.startsWith("9.")).map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.code} {g.short} – {g.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Khối 4 (Trực tiếp & Chủ trì)">
                    {GROUPS.filter((g) => g.code.startsWith("4.")).map((g) => (
                      <option key={g.code} value={g.code}>
                        {g.code} {g.short} – {g.name}
                      </option>
                    ))}
                  </optgroup>
                </select>

                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#475569",
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: "6px",
                    padding: "2px 6px 2px 8px",
                    cursor: "pointer",
                  }}
                >
                  <span>Cấp công việc:</span>
                  <select
                    value={workspaceLevelFilter}
                    onChange={(e) => applyWorkspaceLevel(e.target.value === "all" ? "all" : Number(e.target.value))}
                    style={{
                      height: "24px",
                      padding: "0 6px",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "#0f172a",
                      background: "#ffffff",
                      border: "1px solid #cbd5e1",
                      borderRadius: "4px",
                      outline: "none",
                      cursor: "pointer",
                    }}
                  >
                    <option value="all">Tất cả cấp</option>
                    <option value="1">Cấp 1</option>
                    <option value="2">Cấp 2</option>
                    <option value="3">Cấp 3</option>
                    <option value="4">Cấp 4</option>
                    <option value="5">Cấp 5</option>
                    <option value="6">Cấp 6</option>
                  </select>
                </label>
              </div>

              <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                <label className="search-field" style={{ margin: 0, minWidth: "200px" }}>
                  <span>Tìm</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Mã WBS hoặc tên công việc"
                  />
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setCollapsed(new Set());
                    setWorkspaceLevelFilter("all");
                  }}
                >
                  Mở tất cả
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    const toCollapse = new Set<string>();
                    scheduled.forEach((t) => {
                      if (t.summary && t.level >= 2) toCollapse.add(t.code);
                    });
                    setCollapsed(toCollapse);
                    setWorkspaceLevelFilter("1");
                  }}
                >
                  Thu gọn
                </button>
              </div>
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
                          {task.duration && task.duration > 0 ? (
                            <span className="duration-badge">{task.duration} ngày</span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </span>

                        {/* 4. Ngày bắt đầu */}
                        <span className="task-cell task-cell-date">
                          {task.startDate ? (
                            <b>{formatDate(task.startDate)}</b>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </span>

                        {/* 5. Ngày kết thúc */}
                        <span className="task-cell task-cell-date">
                          {task.endDate ? (
                            <b>{formatDate(task.endDate)}</b>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </span>

                        {/* 6. Ghi chú */}
                        <span
                          className="task-cell task-cell-note"
                          title={taskNote ? `${taskNote} (Bấm để chỉnh sửa)` : "Chưa có ghi chú (Bấm để thêm ghi chú)"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCode(task.code);
                          }}
                        >
                          {taskNote ? (
                            <span style={{ color: "#0f172a", fontWeight: 500 }}>{taskNote}</span>
                          ) : (
                            <span style={{ color: "#94a3b8", fontStyle: "italic", fontSize: "11px" }}>—</span>
                          )}
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
                  <header>
                    <span>CHI TIẾT & CHỈNH SỬA TIẾN ĐỘ</span>
                    <button aria-label="Đóng chi tiết" onClick={() => setSelectedCode("")}>Đóng</button>
                  </header>
                  <div className="detail-code">{selectedTask.code}</div>
                  <h2>{selectedTask.name}</h2>
                  <div className="detail-meta">
                    <span>{GROUP_BY_CODE[selectedTask.groupCode]?.short || selectedTask.groupCode} – {GROUP_BY_CODE[selectedTask.groupCode]?.name}</span>
                    <b>{selectedTask.summary ? "Nhóm công việc (Summary)" : "Công việc thực hiện"}</b>
                  </div>

                  <label className="field">
                    <span>PIC phụ trách</span>
                    <input
                      disabled={activeProject.baselineLocked}
                      value={selectedTask.pic}
                      onChange={(event) => updateTask(selectedTask.code, { pic: event.target.value })}
                      placeholder="Nhập tên nhân sự/đơn vị phụ trách"
                    />
                  </label>

                  <label className="field">
                    <span>Thời gian thực hiện (ngày làm việc)</span>
                    {selectedTask.summary ? (
                      <input
                        readOnly
                        value={selectedTask.duration ? `${selectedTask.duration} ngày (tính tự động từ công việc con)` : "— (chưa có công việc con có ngày)"}
                        style={{ background: "#f8fafc", color: "#64748b" }}
                      />
                    ) : (
                      <input
                        type="number"
                        min={1}
                        disabled={activeProject.baselineLocked}
                        value={selectedTask.duration || ""}
                        placeholder={selectedTask.workGroup === "Báo cáo định kỳ" ? "Không áp dụng (Báo cáo định kỳ)" : "Số ngày"}
                        onChange={(event) => {
                          const days = Math.max(1, Number(event.target.value) || 1);
                          const baseStart = selectedTask.startDate || activeProject.startDate;
                          const newEnd = dateAtWorkingOffset(baseStart, days - 1);
                          updateTask(selectedTask.code, { duration: days, startDate: baseStart, endDate: newEnd });
                        }}
                      />
                    )}
                  </label>

                  <label className="field">
                    <span>Ngày bắt đầu (Kế hoạch)</span>
                    <input
                      disabled={activeProject.baselineLocked || selectedTask.summary}
                      type="date"
                      value={selectedTask.startDate || ""}
                      max={selectedTask.endDate || undefined}
                      onChange={(event) => {
                        const newStart = event.target.value;
                        if (!newStart) return;
                        const dur = selectedTask.duration || 1;
                        const newEnd = dateAtWorkingOffset(newStart, dur - 1);
                        updateTask(selectedTask.code, { startDate: newStart, endDate: newEnd, duration: dur });
                      }}
                    />
                  </label>

                  <label className="field">
                    <span>Ngày kết thúc (Kế hoạch)</span>
                    <input
                      disabled={activeProject.baselineLocked || selectedTask.summary}
                      type="date"
                      value={selectedTask.endDate || ""}
                      min={selectedTask.startDate || undefined}
                      onChange={(event) => {
                        const newEnd = event.target.value;
                        if (!newEnd) return;
                        const start = selectedTask.startDate || activeProject.startDate;
                        updateTaskDates(selectedTask.code, start, newEnd);
                      }}
                    />
                  </label>

                  <label className="field">
                    <span>Ghi chú công việc</span>
                    <textarea
                      rows={3}
                      disabled={activeProject.baselineLocked}
                      value={activeProject.taskEdits[selectedTask.code]?.note ?? selectedTask.actualNote ?? ""}
                      onChange={(e) => updateTask(selectedTask.code, { note: e.target.value, actualNote: e.target.value })}
                      placeholder="Nhập ghi chú hoặc yêu cầu chi tiết cho công việc này..."
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: "1px solid #c9d6db",
                        fontSize: "12px",
                        resize: "vertical",
                        boxSizing: "border-box",
                        fontFamily: "inherit",
                      }}
                    />
                  </label>

                  <DependencyPicker
                    tasks={scheduled}
                    selectedDependencies={selectedTask.predecessors}
                    successorCode={selectedTask.code}
                    disabled={activeProject.baselineLocked || selectedTask.summary}
                    onChange={(dependencies) => updateTaskDependencies(selectedTask.code, dependencies)}
                  />

                  {selectedTask.dependencyConflict && (
                    <div className="dependency-warning" role="alert">
                      <b>Xung đột liên kết FS</b>
                      <span>{selectedTask.dependencyConflict}</span>
                      {selectedTask.suggestedStartDate && (
                        <button
                          type="button"
                          onClick={() => updateTaskDates(selectedTask.code, selectedTask.suggestedStartDate!, dateAtWorkingOffset(selectedTask.suggestedStartDate!, selectedTask.duration - 1))}
                        >
                          Áp dụng ngày {formatDate(selectedTask.suggestedStartDate)}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="detail-summary">
                    <div>
                      <span>Bắt đầu</span>
                      <b>{formatDate(selectedTask.startDate)}</b>
                    </div>
                    <div>
                      <span>Kết thúc</span>
                      <b>{formatDate(selectedTask.endDate)}</b>
                    </div>
                  </div>

                  <p className="detail-note">
                    {selectedTask.summary
                      ? "Ngày của nhóm công việc được tự động tổng hợp từ các công việc con."
                      : activeProject.isOfficialApproved
                      ? "Master Timeline chính thức đã khóa. Bấm 'Tạo bản điều chỉnh' nếu cần thay đổi kế hoạch cơ sở."
                      : "Mọi thay đổi thông tin và ngày tiến độ được tự động lưu trên thiết bị."}
                  </p>
                </aside>
              )}
            </div>
          </>
        )}
      </section>

      {contextMenu && contextTask && activeProject && <section className="task-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <header><span>{contextTask.code}</span><b>{contextTask.name}</b></header>
        <button disabled={activeProject.baselineLocked} onClick={() => { setContextMenu(null); openTaskCreator(true, contextTask, true); }}><i>+</i><span><b>Thêm công việc con</b><small>Tạo bên dưới {contextTask.code}</small></span></button>
        <button onClick={() => { setSelectedCode(contextTask.code); setContextMenu(null); }}><i>…</i><span><b>Chỉnh sửa chi tiết</b><small>Mở bảng thông tin bên phải</small></span></button>
        {!contextTask.summary && <button onClick={() => { setContextMenu(null); openProgressModal(contextTask); }}><i>%</i><span><b>Cập nhật tiến độ</b><small>Nhập % hoàn thành thực tế</small></span></button>}
        <button className="context-danger" disabled={activeProject.baselineLocked} onClick={() => { setContextMenu(null); removeTaskFromProject(contextTask); }}><i>×</i><span><b>Xóa khỏi dự án</b><small>{contextTask.summary ? "Bao gồm các công việc con" : "Không xóa khỏi danh mục mẫu"}</small></span></button>
      </section>}

      {showCompleteModal && activeProject && (
        <div className="modal-backdrop" onMouseDown={() => setShowCompleteModal(false)}>
          <div className="project-modal" style={{ maxWidth: "660px" }} onMouseDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="status-badge" style={{ background: "#dcfce7", color: "#15803d", borderColor: "#bbf7d0" }}>
                  XÁC NHẬN HOÀN THIỆN TIẾN ĐỘ
                </span>
                <h2>Hồ sơ Master Timeline trình duyệt</h2>
                <p>Kiểm tra thông tin tiến độ đã hoàn thiện và xuất bản in PDF khổ ngang phục vụ công tác trình phê duyệt cấp thẩm quyền.</p>
              </div>
              <button type="button" onClick={() => setShowCompleteModal(false)}>Đóng</button>
            </header>

            <div className="form-grid" style={{ gap: "14px" }}>
              <div className="field field-wide" style={{ background: "#f8fafc", padding: "14px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px" }}>
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: "11px", marginBottom: "2px" }}>Tên dự án</span>
                    <b style={{ color: "#0f172a", fontSize: "13px" }}>{activeProject.name}</b>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: "11px", marginBottom: "2px" }}>Mã dự án & Phiên bản</span>
                    <b style={{ color: "#0f172a" }}>{activeProject.code} · {activeProject.officialVersion || "v1.0"}</b>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: "11px", marginBottom: "2px" }}>Thời gian thực hiện</span>
                    <b style={{ color: "#0f172a" }}>{formatDate(activeProject.startDate)} → {formatDate(activeProject.targetDate)}</b>
                  </div>
                  <div>
                    <span style={{ color: "#64748b", display: "block", fontSize: "11px", marginBottom: "2px" }}>Quy mô cấu trúc WBS</span>
                    <b style={{ color: "#16a34a" }}>{scheduled.length} công việc · 14 Ban/Phòng (9-4)</b>
                  </div>
                </div>
              </div>

              <label className="field field-wide">
                <span style={{ fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>Cấp độ chi tiết WBS xuất PDF</span>
                <select
                  value={pdfExportLevel}
                  onChange={(e) => setPdfExportLevel(e.target.value as "all" | "1" | "2" | "3")}
                  style={{ height: "38px", fontSize: "12px" }}
                >
                  <option value="all">Toàn bộ chi tiết (Tất cả cấp độ WBS)</option>
                  <option value="1">Rút gọn Cấp 1 (Chỉ 14 Khối Ban/Phòng gián tiếp & trực tiếp)</option>
                  <option value="2">Cấp 1 & Cấp 2 (Nhóm công việc cốt lõi)</option>
                  <option value="3">Cấp 1, Cấp 2 & Cấp 3 (Hạng mục chi tiết, ẩn cấp 4)</option>
                </select>
              </label>

              <div className="field field-wide" style={{ border: "1px dashed #cbd5e1", borderRadius: "8px", padding: "12px", background: "#fafafa" }}>
                <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#334155", display: "block", marginBottom: "8px" }}>
                  📋 Khung chữ ký phê duyệt chuẩn đính kèm trong bản in PDF:
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", textAlign: "center", fontSize: "12px" }}>
                  <div style={{ background: "#ffffff", padding: "12px 8px", borderRadius: "6px", border: "1px solid #e2e8f0", fontWeight: 700, color: "#1e3a8a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    Lập tiến độ
                  </div>
                  <div style={{ background: "#ffffff", padding: "12px 8px", borderRadius: "6px", border: "1px solid #e2e8f0", fontWeight: 700, color: "#1e3a8a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    Xem xét
                  </div>
                  <div style={{ background: "#ffffff", padding: "12px 8px", borderRadius: "6px", border: "1px solid #e2e8f0", fontWeight: 700, color: "#1e3a8a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    Phê duyệt
                  </div>
                </div>
              </div>
            </div>

            <footer className="modal-actions-only" style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className="secondary-button"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                onClick={() => {
                  exportSchedulePdf(pdfExportLevel);
                }}
              >
                🖨️ Xuất file
              </button>
              {!isScheduleCompleted(activeProject) ? (
                <button
                  type="button"
                  className="primary-button"
                  style={{ background: "#16a34a", borderColor: "#15803d", display: "inline-flex", alignItems: "center", gap: 6 }}
                  onClick={() => {
                    setProjects((curr) =>
                      curr.map((p) =>
                        p.id === activeProject.id
                          ? {
                              ...p,
                              scheduleStatus: "completed",
                              approvalStatus: "approved",
                              approvedAt: p.approvedAt || new Date().toISOString(),
                            }
                          : p
                      )
                    );
                    setShowCompleteModal(false);
                    notify(`Đã xác nhận hoàn thiện tiến độ dự án "${activeProject.name}"! Dự án đã được chuyển sang mục Xác nhận phê duyệt.`);
                  }}
                >
                  ✓ Xác nhận
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  style={{ color: "#0284c7", borderColor: "#bae6fd", background: "#f0f9ff", display: "inline-flex", alignItems: "center", gap: 6 }}
                  onClick={() => {
                    setProjects((curr) =>
                      curr.map((p) =>
                        p.id === activeProject.id
                          ? {
                              ...p,
                              scheduleStatus: "in_progress",
                              approvalStatus: "draft",
                              isOfficialApproved: false,
                              approvedAt: undefined,
                            }
                          : p
                      )
                    );
                    setShowCompleteModal(false);
                    notify(`Đã chuyển dự án "${activeProject.name}" về trạng thái Đang hoàn thiện.`);
                  }}
                >
                  ↺ Mở lại Đang hoàn thiện
                </button>
              )}
            </footer>
          </div>
        </div>
      )}

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
                  {confirmEligibleProjects.map((p) => (
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
              <div className="create-section-title">1. Thông tin dự án mới</div>
              <label className="field field-wide">
                <span>Tên dự án mới *</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="Ví dụ: Aqua City - Phân khu Phoenix South"
                />
              </label>

              <label className="field">
                <span>Mã dự án *</span>
                <input
                  value={form.code}
                  onChange={(event) => setForm({ ...form, code: event.target.value })}
                  placeholder="Ví dụ: AQC-PS-2026"
                />
              </label>

              <label className="field">
                <span>Chủ đầu tư</span>
                <input
                  value={form.investor || ""}
                  onChange={(event) => setForm({ ...form, investor: event.target.value })}
                  placeholder="Ví dụ: Tập đoàn Novaland"
                />
              </label>

              <label className="field">
                <span>Loại hình dự án</span>
                <select
                  value={form.parameters.loaiHinhDuAn}
                  onChange={(event) => {
                    const value = event.target.value as ProjectParameters["loaiHinhDuAn"];
                    setForm((current) => ({ ...current, type: value, parameters: { ...current.parameters, loaiHinhDuAn: value } }));
                  }}
                >
                  <option value="Nhà ở thấp tầng">Nhà ở thấp tầng</option>
                  <option value="Chung cư cao tầng">Chung cư cao tầng</option>
                  <option value="Khách sạn">Khách sạn</option>
                  <option value="Biệt thự nghỉ dưỡng">Biệt thự nghỉ dưỡng</option>
                  <option value="Công viên nước">Công viên nước</option>
                </select>
              </label>

              <label className="field">
                <span>Vùng dự án *</span>
                <select
                  value={form.region || "Đồng Nai 1"}
                  onChange={(event) => setForm({ ...form, region: event.target.value })}
                >
                  <option value="Đồng Nai 1">Đồng Nai 1</option>
                  <option value="Tp HCM 1">Tp HCM 1</option>
                  <option value="Hồ Tràm 1">Hồ Tràm 1</option>
                  <option value="Phan Thiết 1">Phan Thiết 1</option>
                </select>
              </label>

              <div className="create-section-title" style={{ marginTop: 12 }}>2. Kế hoạch thời gian & Các mốc mục tiêu</div>
              <label className="field">
                <span>Ngày bắt đầu dự án *</span>
                <input
                  type="date"
                  required
                  value={form.startDate}
                  max={form.targetDate}
                  onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Ngày mục tiêu khởi công</span>
                <input
                  type="date"
                  value={form.milestoneDates["MILE_PCD_01"] ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, milestoneDates: { ...current.milestoneDates, MILE_PCD_01: event.target.value } }))}
                />
              </label>

              <label className="field">
                <span>Ngày mục tiêu mở bán</span>
                <input
                  type="date"
                  value={form.milestoneDates["MILE_COM_02"] ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, milestoneDates: { ...current.milestoneDates, MILE_COM_02: event.target.value } }))}
                />
              </label>

              <label className="field">
                <span>Ngày mục tiêu bàn giao</span>
                <input
                  type="date"
                  value={form.milestoneDates["MILE_OM_02"] ?? ""}
                  onChange={(event) => setForm((current) => ({ ...current, milestoneDates: { ...current.milestoneDates, MILE_OM_02: event.target.value } }))}
                />
              </label>

              <label className="field field-wide">
                <span>Ngày kết thúc hoàn toàn dự án *</span>
                <input
                  type="date"
                  required
                  value={form.targetDate}
                  min={form.startDate}
                  onChange={(event) => setForm((current) => ({ ...current, targetDate: event.target.value }))}
                />
              </label>

              <div className="create-section-title" style={{ marginTop: 12 }}>3. Phạm vi & Phân nhóm</div>
              <label className="field">
                <span>Phiên bản Master Timeline</span>
                <input
                  value={form.version ?? "v1.0"}
                  onChange={(event) => setForm({ ...form, version: event.target.value })}
                  placeholder="Ví dụ: v1.0"
                />
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
                <span>Phân khu / Địa điểm</span>
                <input value={form.area || ""} onChange={(event) => setForm({ ...form, area: event.target.value })} placeholder="Ví dụ: Phân khu Phoenix South" />
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
                    <option value="Nhà ở thấp tầng">Nhà ở thấp tầng</option>
                    <option value="Chung cư cao tầng">Chung cư cao tầng</option>
                    <option value="Khách sạn">Khách sạn</option>
                    <option value="Biệt thự nghỉ dưỡng">Biệt thự nghỉ dưỡng</option>
                    <option value="Công viên nước">Công viên nước</option>
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

