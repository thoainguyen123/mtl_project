"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import templateData from "./mtl-template.json";
import dependencyData from "./mtl-dependencies.json";
import { parseMSProjectXML, type ParsedProjectData } from "./xml-parser";

type TemplateTask = {
  id: number;
  code: string;
  parentCode: string | null;
  groupCode: string;
  name: string;
  level: number;
  summary: boolean;
  defaultDuration: number;
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

type ProjectForm = Pick<Project, "name" | "code" | "type" | "investor" | "location" | "startDate" | "targetDate" | "area" | "region" | "group">;

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
const CATALOG_ENABLED_KEY = "mtl-workspace-enabled-catalog-v1";

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
  investor: "Tập đoàn Novaland",
  group: "Nhóm 1 (Đang nghiên cứu)",
  type: "Khu đô thị sinh thái",
  location: "",
  startDate: today,
  targetDate: nextYear,
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
    approvalStatus: "gmd_review",
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
    designTaskStatus: "dang_lap",
    fsStatus: "dang_tinh_toan",
    startDate: "2026-07-01",
    targetDate: "2027-12-31",
  },
  {
    id: "proj-novaworld-hotram",
    code: "NVL-NVG-2026",
    name: "NovaWorld Ho Tram (Habana & Wonderland)",
    type: "Tổ hợp Du lịch Nghỉ dưỡng Cao cấp",
    investor: "Công ty CP BĐS Nova Lexington",
    location: "Xuyên Mộc, Bà Rịa - Vũng Tàu",
    area: "Bà Rịa - Vũng Tàu",
    region: "Vùng Hồ Tràm 1",
    group: "Nhóm 2 (Đã mua đang thiết kế)",
    approvalStatus: "submitted",
    designTaskStatus: "pbcm_gop_y",
    fsStatus: "cho_doi_chieu",
    startDate: "2026-08-01",
    targetDate: "2029-06-30",
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
  return DEFAULT_DEPENDENCIES.reduce<Record<string, TaskDependency[]>>((result, dependency) => {
    if (!included.has(dependency.successorCode) || !included.has(dependency.predecessorCode)) return result;
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
    const suggestedDuration = task.level === 1 ? Math.max(2, groupSpan - 2) : task.defaultDuration;
    const startDate = edit.startDate ?? dateAtOffset(project.startDate, suggestedOffset);
    const duration = edit.endDate
      ? Math.max(1, workingDaysBetween(startDate, edit.endDate))
      : Math.max(1, Number(edit.duration ?? suggestedDuration));
    const endDate = edit.endDate && edit.endDate >= startDate ? edit.endDate : dateAtWorkingOffset(startDate, duration - 1);
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
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13" width="7.5" height="7.5" rx="1.5" /></svg>;
}

function IconHome() {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
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
  return <div className="user-badge"><span className="avatar">PM</span><span className="user-badge-info"><strong>Project Manager</strong><small>Chủ trì lập MTL</small></span><i className="user-badge-caret">⌄</i></div>;
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
    const predecessorXml = task.predecessors.map((dependency) => uidByCode[dependency.predecessorCode] ? `
      <PredecessorLink><PredecessorUID>${uidByCode[dependency.predecessorCode]}</PredecessorUID><Type>${PROJECT_LINK_TYPE[dependency.type]}</Type><CrossProject>0</CrossProject><LinkLag>${dependency.lagDays * 4800}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>` : "").join("");
    return `
    <Task>
      <UID>${index + 1}</UID><ID>${index + 1}</ID><Name>${escapeXml(`${task.code} ${task.name}`)}</Name>
      <Type>1</Type><IsNull>0</IsNull><CreateDate>${created}</CreateDate><WBS>${escapeXml(task.code)}</WBS>
      <OutlineNumber>${escapeXml(task.code)}</OutlineNumber><OutlineLevel>${task.level}</OutlineLevel><Priority>500</Priority>
      <Start>${task.startDate}T08:00:00</Start><Finish>${task.endDate}T17:00:00</Finish>
      <Duration>PT${task.duration * 8}H0M0S</Duration><DurationFormat>7</DurationFormat>
      <Summary>${task.summary ? 1 : 0}</Summary><Milestone>0</Milestone><PercentComplete>${task.status === "Hoàn thành" ? 100 : 0}</PercentComplete>
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
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<"overview" | "projects" | "workspace" | "departments" | "gmd" | "gms" | "confirm_approval" | "approved_projects" | "catalog" | "design_task" | "fs_ver2">("projects");
  const [lapMtlOpen, setLapMtlOpen] = useState(true);
  const [designTaskOpen, setDesignTaskOpen] = useState(false);
  const [fsVer2Open, setFsVer2Open] = useState(false);
  const [overviewSource, setOverviewSource] = useState<"approved" | "all">("approved");
  const [overviewRegion, setOverviewRegion] = useState("all");
  const [overviewProject, setOverviewProject] = useState("all");
  const [overviewGroup, setOverviewGroup] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
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
  const [catalogSourceFilter, setCatalogSourceFilter] = useState<"all" | "custom" | "standard">("all");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(20);
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
        const initialList = (saved && saved.length > 0) ? saved : DEFAULT_INITIAL_PROJECTS;
        const normalized = initialList.map(normalizeProject);
        setProjects(normalized);
        setCustomCatalog(savedCustomCatalog);
        const catalogCodes = new Set([...TEMPLATE, ...savedCustomCatalog].map((task) => task.code));
        setEnabledCatalogCodes(new Set(savedEnabledCodes ? (JSON.parse(savedEnabledCodes) as string[]).filter((code) => catalogCodes.has(code)) : [...catalogCodes]));
        setActiveId(localStorage.getItem(ACTIVE_KEY) ?? normalized[0]?.id ?? "");
      } catch {
        const normalized = DEFAULT_INITIAL_PROJECTS.map(normalizeProject);
        setProjects(normalized);
        setCustomCatalog([]);
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
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
  }, [projects, activeId, customCatalog, enabledCatalogCodes, hydrated]);

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
  const fullCatalog = useMemo(() => [...TEMPLATE, ...customCatalog].sort((a, b) => (GROUP_ORDER[a.groupCode] ?? 99) - (GROUP_ORDER[b.groupCode] ?? 99) || a.code.localeCompare(b.code, undefined, { numeric: true })), [customCatalog]);
  const enabledCatalogCount = useMemo(() => fullCatalog.filter((task) => enabledCatalogCodes.has(task.code)).length, [fullCatalog, enabledCatalogCodes]);
  const catalogRows = useMemo(() => {
    const query = catalogSearch.trim().toLocaleLowerCase("vi");
    return fullCatalog.filter((task) => {
      const matchesQuery = !query || `${task.code} ${task.name} ${GROUP_BY_CODE[task.groupCode]?.name ?? ""}`.toLocaleLowerCase("vi").includes(query);
      const matchesGroup = catalogGroupFilter === "all" || task.groupCode === catalogGroupFilter;
      const matchesSource = catalogSourceFilter === "all" || (catalogSourceFilter === "custom" ? task.custom : !task.custom);
      return matchesQuery && matchesGroup && matchesSource;
    });
  }, [fullCatalog, catalogSearch, catalogGroupFilter, catalogSourceFilter]);
  const catalogPageCount = Math.max(1, Math.ceil(catalogRows.length / catalogPageSize));
  const pagedCatalogRows = useMemo(() => {
    const currentPage = Math.min(catalogPage, catalogPageCount);
    return catalogRows.slice((currentPage - 1) * catalogPageSize, currentPage * catalogPageSize);
  }, [catalogRows, catalogPage, catalogPageSize, catalogPageCount]);

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

  const openCreate = () => {
    setForm(emptyForm);
    setFormError("");
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

  const createProject = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.code.trim()) return setFormError("Vui lòng nhập tên và mã dự án.");
    if (form.targetDate < form.startDate) return setFormError("Ngày mục tiêu phải sau ngày bắt đầu.");
    
    let project: Project;
    if (xmlData) {
      const selectedGroups = ["9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "4.0", "4.1", "4.2", "4.3", "4.4"];
      project = {
        ...form,
        id: crypto.randomUUID(),
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        createdAt: new Date().toISOString(),
        taskEdits: xmlData.taskEdits,
        taskDependencies: xmlData.taskDependencies,
        selectedGroups: selectedGroups,
        customTasks: xmlData.customTasks,
        includedTaskCodes: xmlData.customTasks.map((t) => t.code),
        departmentApprovals: normalizeDepartmentApprovals(selectedGroups),
        approvalStatus: "draft",
      };
    } else {
      const enabledTasks = fullCatalog.filter((task) => enabledCatalogCodes.has(task.code));
      if (!enabledTasks.length) return setFormError("Danh mục chưa có công việc nào được bật Tự động sinh.");
      const selectedGroups = [...new Set(enabledTasks.map((task) => task.groupCode))];
      project = {
        ...form,
        id: crypto.randomUUID(),
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        createdAt: new Date().toISOString(),
        taskEdits: {},
        taskDependencies: defaultDependenciesForCodes(enabledTasks.map((task) => task.code)),
        selectedGroups,
        customTasks: customCatalog.filter((task) => enabledCatalogCodes.has(task.code)),
        includedTaskCodes: enabledTasks.map((task) => task.code),
        departmentApprovals: normalizeDepartmentApprovals(selectedGroups),
        approvalStatus: "draft",
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
    notify(taskForm.addToCurrent && activeProject ? "Đã thêm task vào danh mục và dự án hiện tại" : "Đã thêm task vào danh mục WBS");
  };

  const removeCatalogTask = (code: string) => {
    setCustomCatalog((current) => current.filter((task) => task.code !== code));
    setEnabledCatalogCodes((current) => { const next = new Set(current); next.delete(code); return next; });
    notify("Đã xóa task tùy chỉnh khỏi danh mục dùng cho dự án mới");
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

  const toggleAllCatalogTasks = () => {
    setEnabledCatalogCodes(enabledCatalogCount === fullCatalog.length ? new Set() : new Set(fullCatalog.map((task) => task.code)));
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

  return (
    <main className="app-shell">
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
          color: #4ea1f3 !important;
          text-transform: uppercase !important;
          white-space: nowrap !important;
          line-height: 1.15 !important;
          margin: 0 !important;
          padding: 0 !important;
          display: block !important;
        }
        .sidebar {
          width: 275px !important;
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
          margin: 16px 24px 20px !important;
          background: #ffffff !important;
          border-radius: 10px !important;
          border: 1px solid #e2e8f0 !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04) !important;
          overflow: hidden !important;
        }
        .catalog-table-head {
          display: grid !important;
          grid-template-columns: minmax(320px, 2fr) minmax(180px, 1fr) 85px 125px 105px 115px 65px !important;
          align-items: center !important;
          gap: 12px !important;
          padding: 11px 16px !important;
          background: #f8fafc !important;
          border-bottom: 1px solid #e2e8f0 !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          color: #64748b !important;
          letter-spacing: 0.4px !important;
          text-transform: uppercase !important;
        }
        .catalog-row {
          display: grid !important;
          grid-template-columns: minmax(320px, 2fr) minmax(180px, 1fr) 85px 125px 105px 115px 65px !important;
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
        .catalog-task {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          min-width: 0 !important;
        }
        .catalog-task b {
          font-size: 11px !important;
          font-weight: 800 !important;
          color: #0f172a !important;
          background: #f1f5f9 !important;
          padding: 2px 6px !important;
          border-radius: 4px !important;
          flex: none !important;
        }
        .catalog-task span {
          font-size: 12.5px !important;
          font-weight: 600 !important;
          color: #1e293b !important;
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
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
          width: min(640px, 94vw) !important;
          border-radius: 16px !important;
          background: #ffffff !important;
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28) !important;
          overflow: hidden !important;
        }
        .create-project-modal header {
          padding: 22px 28px 18px !important;
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
          gap: 16px !important;
          padding: 24px 28px 12px !important;
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
          display: flex !important;
          align-items: center !important;
          justify-content: flex-end !important;
          gap: 12px !important;
          border-top: 1px solid #f1f5f9 !important;
          background: #ffffff !important;
        }
      `}</style>
      <aside className="sidebar">
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
        {/* Module 1: LẬP MASTER TIMELINE — sổ ra/thu gọn được */}
        {(() => {
          const lapMtlSectionOpen = lapMtlOpen;
          return <>
            <button type="button" className={`sidebar-section-toggle ${lapMtlSectionOpen ? "open" : ""}`} onClick={() => { setLapMtlOpen((current) => !current); setView("projects"); }} aria-expanded={lapMtlSectionOpen} title={lapMtlSectionOpen ? "Thu gọn menu Lập MTL" : "Mở rộng menu Lập MTL"}>
              <div className="section-toggle-left">
                <IconBuilding />
                <span>Lập Master Timeline</span>
              </div>
              <IconChevronDown />
            </button>
            <nav className={`sidebar-nav sidebar-collapsible ${lapMtlSectionOpen ? "" : "collapsed"}`} aria-label="Điều hướng Lập MTL" aria-hidden={!lapMtlSectionOpen}>
              <button className={view === "projects" || view === "workspace" ? "active" : ""} onClick={() => setView("projects")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconTimeline />
                <span>Lập & Cập nhật</span>
              </button>
              <button className={view === "departments" ? "active" : ""} onClick={() => openDepartmentReview()} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconCheck />
                <span>PBCM xác nhận</span>
              </button>
              <button className={view === "gmd" ? "active" : ""} onClick={() => setView("gmd")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconShield />
                <span>GMD kiểm soát</span>
              </button>
              <button className={view === "gms" ? "active" : ""} onClick={() => setView("gms")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconSeal />
                <span>Thẩm định</span>
              </button>
              <button className={view === "confirm_approval" ? "active" : ""} onClick={() => setView("confirm_approval")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconFileCheck />
                <span>Xác nhận phê duyệt MTL</span>
              </button>
              <button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")} tabIndex={lapMtlSectionOpen ? 0 : -1}>
                <IconList />
                <span>Danh mục WBS</span>
              </button>
            </nav>
          </>;
        })()}

        {/* Module 2: LẬP NHIỆM VỤ THIẾT KẾ */}
        {(() => {
          const isSectionOpen = designTaskOpen;
          return <>
            <button type="button" className={`sidebar-section-toggle ${isSectionOpen ? "open" : ""}`} onClick={() => { setDesignTaskOpen((current) => !current); setView("design_task"); }} aria-expanded={isSectionOpen} title={isSectionOpen ? "Thu gọn menu Lập NVTK" : "Mở rộng menu Lập NVTK"}>
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
            <button type="button" className={`sidebar-section-toggle ${isSectionOpen ? "open" : ""}`} onClick={() => { setFsVer2Open((current) => !current); setView("fs_ver2"); }} aria-expanded={isSectionOpen} title={isSectionOpen ? "Thu gọn menu Lập FS-Ver2" : "Mở rộng menu Lập FS-Ver2"}>
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

        <div className="template-card"><span>MẪU ĐANG DÙNG</span><strong>NVLG MTL 2026.06</strong><small>{fullCatalog.length} task · 14 nhóm · WBS cấp 4</small></div>
        <div className="sidebar-footer">MTL v1.0 · © 2026 Novaland Group</div>
      </aside>

      <section className="workspace">
        {view === "overview" ? (
          <>
            <header className="topbar overview-topbar">
              <div className="breadcrumbs">
                <IconHome />
                <i>/</i>
                <span>THEO DÕI</span>
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
                <UserBadge />
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
            <header className="topbar">
              <div className="breadcrumbs">
                <span>Cấu trúc Master Timeline</span>
                <i>/</i>
                <strong>Lập & Cập nhật Master Timeline</strong>
                <i>/</i>
                <span>{projects.length} dự án</span>
              </div>
              <div className="top-actions">
                <button className="primary-button" onClick={openCreate}>+ Tạo Master Timeline</button>
                <UserBadge />
              </div>
            </header>
            <section className="project-index">
              <header className="project-index-header">
                <div>
                  <h1>DANH SÁCH DỰ ÁN</h1>
                </div>
                <label className="search-field project-index-search">
                  <span>Tìm dự án</span>
                  <input value={projectSearch} onChange={(event) => { setProjectSearch(event.target.value); setProjectPage(1); }} placeholder="Nhập tên, mã dự án, chủ đầu tư..." />
                </label>
              </header>

              {/* KPI Stats Bar */}
              <div className="table-stats-bar">
                <div className="table-stat-card">
                  <span>TỔNG DỰ ÁN</span>
                  <b>{projects.length}</b>
                </div>
                <div className="table-stat-card">
                  <span>ĐANG LẬP MTL</span>
                  <b style={{ color: "#1a56a8" }}>{projects.filter((p) => p.approvalStatus === "draft").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>GMD KIỂM SOÁT</span>
                  <b style={{ color: "#7e22ce" }}>{projects.filter((p) => p.approvalStatus === "gmd_review").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>GMS THẨM ĐỊNH</span>
                  <b style={{ color: "#0369a1" }}>{projects.filter((p) => p.approvalStatus === "submitted" || p.approvalStatus === "appraised").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>ĐÃ DUYỆT BASELINE</span>
                  <b style={{ color: "#167461" }}>{projects.filter((p) => p.isOfficialApproved).length}</b>
                </div>
              </div>

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
                  <span>{projectSearch || projectStatusFilter !== "all" || projectRegionFilter !== "all" ? "Thử tìm bằng từ khóa khác hoặc thiết lập lại bộ lọc." : "Tạo dự án đầu tiên để hệ thống sinh Master Timeline từ danh mục WBS."}</span>
                  {!projectSearch && projectStatusFilter === "all" && <button className="primary-button" onClick={openCreate}>Tạo Master timeline</button>}
                </div>
              )}
              <Pagination total={visibleProjects.length} pageSize={projectPageSize} page={projectPage} onPageChange={setProjectPage} onPageSizeChange={(size) => { setProjectPageSize(size); setProjectPage(1); }} />
            </section>
          </>
        ) : view === "catalog" ? (
          <>
            <header className="topbar">
              <div className="breadcrumbs">
                <span>Cấu trúc Master Timeline</span>
                <i>/</i>
                <strong>Danh mục WBS</strong>
                <i>/</i>
                <span>{fullCatalog.length} công việc</span>
              </div>
              <div className="top-actions">
                <button type="button" className="secondary-button" onClick={toggleAllCatalogTasks}>
                  {enabledCatalogCount === fullCatalog.length ? "Bỏ tích tất cả" : "Tích tất cả"}
                </button>
                <button type="button" className="primary-button" onClick={() => openTaskCreator(false)}>
                  + Thêm công việc
                </button>
                <UserBadge />
              </div>
            </header>

            <section className="catalog-header">
              <div>
                <span className="status-badge" style={{ background: "#edf8f5", color: "#167461" }}>
                  {enabledCatalogCount}/{fullCatalog.length} TỰ ĐỘNG SINH
                </span>
                <h1>Danh Mục WBS Chuẩn</h1>
                <p>Công việc được tích “Tự động sinh” sẽ luôn có sẵn khi tạo dự án mới theo mẫu NVLG MTL 2026.06.</p>
              </div>
              <label className="search-field" style={{ minWidth: "260px" }}>
                <span>Tìm</span>
                <input
                  value={catalogSearch}
                  onChange={(event) => {
                    setCatalogSearch(event.target.value);
                    setCatalogPage(1);
                  }}
                  placeholder="Tìm theo mã WBS hoặc tên..."
                />
              </label>
            </section>

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
                      setCatalogPage(1);
                    }}
                  >
                    <div className="catalog-group-card-top">
                      <span>{group.code}</span>
                      <small>{count} task</small>
                    </div>
                    <b>{group.short} · {group.name}</b>
                  </button>
                );
              })}
            </section>

            <div className="table-filters" style={{ margin: "14px 24px 0", borderRadius: "10px 10px 0 0", border: "1px solid #e2e8f0", borderBottom: 0, background: "#fff" }}>
              <label className="table-filters-select">
                <span>Nhóm WBS</span>
                <select
                  value={catalogGroupFilter}
                  onChange={(event) => {
                    setCatalogGroupFilter(event.target.value);
                    setCatalogPage(1);
                  }}
                >
                  <option value="all">Tất cả nhóm ({GROUPS.length})</option>
                  {GROUPS.map((group) => (
                    <option key={group.code} value={group.code}>
                      {group.code} · {group.short} ({group.name})
                    </option>
                  ))}
                </select>
              </label>
              <label className="table-filters-select">
                <span>Nguồn</span>
                <select
                  value={catalogSourceFilter}
                  onChange={(event) => {
                    setCatalogSourceFilter(event.target.value as "all" | "custom" | "standard");
                    setCatalogPage(1);
                  }}
                >
                  <option value="all">Tất cả nguồn</option>
                  <option value="standard">Mẫu chuẩn</option>
                  <option value="custom">Tùy chỉnh</option>
                </select>
              </label>
              <span className="table-filters-count" style={{ marginLeft: "auto" }}>
                Hiển thị <strong>{catalogRows.length}</strong> / {fullCatalog.length} công việc
              </span>
            </div>

            <section className="catalog-table" style={{ marginTop: 0, borderRadius: "0 0 10px 10px" }}>
              <div className="catalog-table-head">
                <span>WBS / CÔNG VIỆC</span>
                <span>ĐƠN VỊ</span>
                <span>CẤP ĐỘ</span>
                <span>THỜI LƯỢNG MẪU</span>
                <span>NGUỒN</span>
                <span>TỰ ĐỘNG SINH</span>
                <span>HÀNH ĐỘNG</span>
              </div>
              {pagedCatalogRows.map((task) => {
                const group = GROUP_BY_CODE[task.groupCode];
                return (
                  <div
                    className={`catalog-row ${enabledCatalogCodes.has(task.code) ? "auto-enabled" : ""}`}
                    key={`${task.custom ? "custom" : "base"}-${task.code}`}
                  >
                    <span className="catalog-task" style={{ paddingLeft: `${(task.level - 1) * 16}px` }}>
                      <b>{task.code}</b>
                      <span>{task.name}</span>
                    </span>
                    <span className="catalog-unit">
                      <b>{group?.short || task.groupCode}</b>
                      <span>{group?.name}</span>
                    </span>
                    <span>
                      <span className={`catalog-level-badge catalog-level-${Math.min(task.level, 4)}`}>
                        Cấp {task.level}
                      </span>
                    </span>
                    <span style={{ fontWeight: 600, color: "#334155" }}>
                      {task.defaultDuration} ngày
                    </span>
                    <span>
                      <i className={task.custom ? "source-custom" : "source-standard"}>
                        {task.custom ? "Tùy chỉnh" : "Mẫu chuẩn"}
                      </i>
                    </span>
                    <span>
                      <label className="auto-generate-check">
                        <input
                          type="checkbox"
                          checked={enabledCatalogCodes.has(task.code)}
                          onChange={() => toggleCatalogTask(task)}
                          aria-label={`Tự động sinh ${task.code}`}
                        />
                        <i />
                        <b>{enabledCatalogCodes.has(task.code) ? "Có" : "Không"}</b>
                      </label>
                    </span>
                    <span>
                      {task.custom ? (
                        <button
                          type="button"
                          className="danger-button"
                          style={{ height: "26px", fontSize: "10.5px", padding: "0 8px" }}
                          onClick={() => removeCatalogTask(task.code)}
                          aria-label={`Xóa ${task.code}`}
                        >
                          Xóa
                        </button>
                      ) : (
                        <span style={{ color: "#94a3b8", fontSize: "11px" }}>—</span>
                      )}
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
            <Pagination
              total={catalogRows.length}
              pageSize={catalogPageSize}
              page={catalogPage}
              onPageChange={setCatalogPage}
              onPageSizeChange={(size) => {
                setCatalogPageSize(size);
                setCatalogPage(1);
              }}
              pageSizeOptions={[20, 40, 80]}
            />
          </>
        ) : view === "departments" ? (
          <>
            <header className="topbar"><div className="breadcrumbs"><span>Lập Master timeline</span><i>/</i><strong>PBCM xác nhận</strong>{activeProject && <><i>/</i><span>{activeProject.code}</span></>}</div><div className="top-actions">{activeProject && <label className="department-project-select"><span>Dự án</span><select value={activeProject.id} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) { setActiveId(project.id); setDepartmentCode(project.selectedGroups[0] ?? GROUPS[0].code); } }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}<UserBadge /></div></header>
            {activeProject ? <>
              <section className="department-header"><div><span className="status-badge">BƯỚC 2/5</span><h1>Xác nhận MTL theo phòng ban</h1><p>Mỗi đơn vị chỉ xem và xác nhận toàn bộ cây công việc thuộc đầu mục WBS của mình.</p></div><div className="department-progress"><b>{departmentApprovedCount}/{activeProject.selectedGroups.length}</b><span>ĐẦU MỤC ĐÃ XÁC NHẬN</span><i><em style={{ width: `${(departmentApprovedCount / Math.max(activeProject.selectedGroups.length, 1)) * 100}%` }} /></i></div></section>
              <section className="department-review-layout">
                <aside className="department-groups" aria-label="Đầu mục phòng ban">
                  <header><span>VAI TRÒ PHÒNG BAN · DEMO</span><b>{departmentPendingCount} đầu mục còn chờ</b></header><p className="department-demo-note">Bản triển khai thật sẽ tự nhận diện tài khoản và chỉ hiện đúng một đầu mục được phân quyền.</p>
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
            <header className="topbar"><div className="breadcrumbs"><span>Lập Master timeline</span><i>/</i><strong>GMD kiểm soát</strong></div><div className="top-actions"><UserBadge /></div></header>
            <section className="gms-header"><div><span className="status-badge">BƯỚC 3/5</span><h1>Ban điều hành dự án kiểm soát MTL</h1><p>Xem cảnh báo tự động và xác nhận của các phòng ban, sau đó cho ý kiến trước khi MTL đi thẩm định.</p></div><div className="gms-metrics"><div><b>{pendingGmdCount}</b><span>CHỜ KIỂM SOÁT</span></div><div><b>{projects.filter((project) => project.approvalStatus === "gmd_returned").length}</b><span>ĐÃ TRẢ VỀ</span></div><div><b>{projects.filter((project) => Boolean(project.gmdReviewedAt) && project.approvalStatus !== "gmd_returned").length}</b><span>ĐÃ CHO ĐI THẨM ĐỊNH</span></div></div></section>

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
            <header className="topbar"><div className="breadcrumbs"><span>Lập Master timeline</span><i>/</i><strong>Thẩm định</strong></div><div className="top-actions"><UserBadge /></div></header>
            <section className="gms-header"><div><span className="status-badge">BƯỚC 4/5</span><h1>Danh mục dự án MTL cần thẩm định</h1><p>Tìm và chọn dự án để xem toàn bộ công việc, nhập ý kiến rồi gửi phản hồi cho người lập.</p></div><div className="gms-metrics"><div><b>{pendingGmsCount}</b><span>CHỜ THẨM ĐỊNH</span></div><div><b>{projects.filter((project) => project.approvalStatus === "approved").length}</b><span>ĐÃ XÁC NHẬN</span></div><div><b>{projects.filter((project) => project.approvalStatus === "changes_requested").length}</b><span>YÊU CẦU ĐIỀU CHỈNH</span></div></div></section>
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
            <header className="topbar">
              <div className="breadcrumbs">
                <span>Lập Master timeline</span>
                <i>/</i>
                <strong>Xác nhận phê duyệt MTL</strong>
              </div>
              <div className="top-actions">
                <button type="button" className="primary-button" onClick={() => openEApprovalModal()}>
                  + Nhập phê duyệt E-Approval
                </button>
                <UserBadge />
              </div>
            </header>
            <section className="project-index">
              <header className="project-index-header">
                <div>
                  <span className="status-badge">BƯỚC 5/5</span>
                  <h1>Xác nhận phê duyệt MTL từ E-Approval</h1>
                  <p>PMD kiểm tra hồ sơ sau thẩm định nội bộ, nhập Mã hồ sơ và Link phê duyệt E-Approval để chốt Master Timeline và đưa vào module MTL Đã Duyệt.</p>
                </div>
                <label className="search-field project-index-search">
                  <span>Tìm dự án</span>
                  <input value={confirmSearch} onChange={(event) => { setConfirmSearch(event.target.value); setConfirmPage(1); }} placeholder="Tên, mã dự án hoặc mã E-Approval" />
                </label>
              </header>

              <div className="approved-summary-strip" style={{ margin: "0 24px 14px" }}>
                <div className="approved-metric-card">
                  <span>CHỜ XÁC NHẬN E-APPROVAL</span>
                  <b style={{ color: pendingEApprovalCount > 0 ? "#d92b2b" : "#168c72" }}>{pendingEApprovalCount}</b>
                </div>
                <div className="approved-metric-card">
                  <span>ĐÃ QUA GMS THẨM ĐỊNH</span>
                  <b>{projects.filter((p) => p.approvalStatus === "approved").length}</b>
                </div>
                <div className="approved-metric-card">
                  <span>ĐÃ PHÊ DUYỆT CHÍNH THỨC</span>
                  <b style={{ color: "#2ea44f" }}>{officialApprovedProjects.length}</b>
                </div>
                <div className="approved-metric-card">
                  <span>TỔNG DỰ ÁN HỆ THỐNG</span>
                  <b>{projects.length}</b>
                </div>
              </div>

              <div className="table-filters">
                <div className="gms-function-tabs" style={{ margin: 0 }}>
                  <button className={confirmFilter === "all" ? "active" : ""} onClick={() => { setConfirmFilter("all"); setConfirmPage(1); }}>
                    Tất cả dự án <b>{projects.length}</b>
                  </button>
                  <button className={confirmFilter === "pending" ? "active" : ""} onClick={() => { setConfirmFilter("pending"); setConfirmPage(1); }}>
                    Chưa xác nhận E-Approval <b>{projects.filter((p) => !p.isOfficialApproved).length}</b>
                  </button>
                  <button className={confirmFilter === "approved" ? "active" : ""} onClick={() => { setConfirmFilter("approved"); setConfirmPage(1); }}>
                    Đã phê duyệt <b>{officialApprovedProjects.length}</b>
                  </button>
                </div>
                <span className="table-filters-count">{visibleConfirmProjects.length} dự án</span>
              </div>

              {visibleConfirmProjects.length > 0 ? (
                <div className="project-table" aria-label="Danh sách xác nhận phê duyệt MTL">
                  <div className="project-table-head" style={{ gridTemplateColumns: "80px 100px minmax(180px, 1.4fr) 130px 150px 80px 110px 160px" }}>
                    <span>Vùng</span>
                    <span>Mã DA</span>
                    <span>Tên dự án</span>
                    <span>Thẩm định GMS</span>
                    <span>Mã E-Approval</span>
                    <span>Bản</span>
                    <span>Ngày duyệt</span>
                    <span>Hành động</span>
                  </div>
                  <div className="project-table-body">
                    {pagedConfirmProjects.map((project) => (
                      <div key={project.id} className="project-table-row" style={{ gridTemplateColumns: "80px 100px minmax(180px, 1.4fr) 130px 150px 80px 110px 160px" }}>
                        <span className="project-region-cell">{project.region || project.area || "—"}</span>
                        <span className="project-code">{project.code}</span>
                        <span className="project-name-cell"><b>{project.name}</b><small>{project.type}</small></span>
                        <span>
                          <span className={`status-badge approval-${project.approvalStatus}`}>
                            {projectApprovalLabel(project)}
                          </span>
                        </span>
                        <span>
                          {project.eApprovalUrl ? (
                            <a href={project.eApprovalUrl} target="_blank" rel="noreferrer" className="eapp-link-badge" title="Mở trên E-Approval">
                              <span>{project.eApprovalCode || "E-Approval"}</span>
                              <IconExternalLink />
                            </a>
                          ) : (
                            <span style={{ color: "#829ab1", fontSize: "11px" }}>{project.eApprovalCode || "Chưa nhập"}</span>
                          )}
                        </span>
                        <span><b>{project.officialVersion || (project.isOfficialApproved ? "v1.0" : "—")}</b></span>
                        <span>{project.eApprovalDate ? formatDate(project.eApprovalDate) : "—"}</span>
                        <span className="project-action-cell" style={{ gap: "6px" }}>
                          {!project.isOfficialApproved ? (
                            <button
                              type="button"
                              className="primary-button"
                              style={{ height: "28px", fontSize: "11px", padding: "0 10px" }}
                              onClick={() => openEApprovalModal(project)}
                            >
                              Xác nhận E-Approval
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="secondary-button"
                                style={{ height: "28px", fontSize: "11px", padding: "0 8px" }}
                                title="Sửa thông tin E-Approval"
                                onClick={() => openEApprovalModal(project)}
                              >
                                Sửa
                              </button>
                              <button
                                type="button"
                                className="action-btn view-btn"
                                title="Xem trong MTL đã duyệt"
                                onClick={() => { setActiveId(project.id); setView("approved_projects"); }}
                              >
                                <IconEye />
                              </button>
                            </>
                          )}
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
            <header className="topbar">
              <div className="breadcrumbs">
                <span>MTL đã duyệt</span>
                <i>/</i>
                <strong>Danh sách MTL đã phê duyệt ({officialApprovedProjects.length} dự án)</strong>
              </div>
              <div className="top-actions">
                <button type="button" className="primary-button" onClick={() => openEApprovalModal()}>
                  + Xác nhận phê duyệt MTL
                </button>
                <UserBadge />
              </div>
            </header>
            <section className="project-index">
              <header className="project-index-header">
                <div>
                  <span className="status-badge" style={{ background: "#eaf8f4", color: "#167664", border: "1px solid #a4dfd1" }}>OFFICIAL BASELINE · E-APPROVAL</span>
                  <h1>DANH MỤC MASTER TIMELINE ĐÃ PHÊ DUYỆT</h1>
                  <p>Các Master Timeline đã có quyết định phê duyệt trên phần mềm E-Approval. Dùng làm chuẩn Baseline để theo dõi tiến độ thực tế.</p>
                </div>
                <label className="search-field project-index-search">
                  <span>Tìm dự án</span>
                  <input value={approvedSearch} onChange={(event) => { setApprovedSearch(event.target.value); setApprovedPage(1); }} placeholder="Tên, mã dự án hoặc mã E-Approval" />
                </label>
              </header>

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
                <div className="project-table" aria-label="Các dự án MTL đã duyệt">
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
            <header className="topbar">
              <div className="breadcrumbs">
                <span>Lập Nhiệm Vụ Thiết Kế</span>
                <i>/</i>
                <strong>Danh sách hồ sơ NVTK</strong>
                <i>/</i>
                <span>{projects.length} dự án</span>
              </div>
              <div className="top-actions">
                <button type="button" className="secondary-button" onClick={() => setView("projects")}>← Quay lại MTL</button>
                <button type="button" className="primary-button">+ Tạo Nhiệm Vụ Thiết Kế</button>
                <UserBadge />
              </div>
            </header>
            <section className="project-index">
              <header className="project-index-header">
                <div>
                  <h1>DANH SÁCH DỰ ÁN LẬP NHIỆM VỤ THIẾT KẾ (NVTK)</h1>
                </div>
                <label className="search-field project-index-search">
                  <span>Tìm dự án</span>
                  <input value={designSearch} onChange={(event) => { setDesignSearch(event.target.value); setDesignPage(1); }} placeholder="Nhập tên, mã dự án, chủ đầu tư..." />
                </label>
              </header>

              {/* KPI Stats Bar */}
              <div className="table-stats-bar">
                <div className="table-stat-card">
                  <span>TỔNG DỰ ÁN NVTK</span>
                  <b>{projects.length}</b>
                </div>
                <div className="table-stat-card">
                  <span>CHƯA LẬP NVTK</span>
                  <b style={{ color: "#64748b" }}>{projects.filter((p) => p.designTaskStatus === "chua_lap").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>ĐANG LẬP NVTK</span>
                  <b style={{ color: "#1a56a8" }}>{projects.filter((p) => p.designTaskStatus === "dang_lap").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>PBCM GÓP Ý</span>
                  <b style={{ color: "#d97706" }}>{projects.filter((p) => p.designTaskStatus === "pbcm_gop_y").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>ĐÃ PHÊ DUYỆT NVTK</span>
                  <b style={{ color: "#167461" }}>{projects.filter((p) => p.designTaskStatus === "da_duyet").length}</b>
                </div>
              </div>

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
            <header className="topbar">
              <div className="breadcrumbs">
                <span>Lập FS Thực Thi (FS-Ver2)</span>
                <i>/</i>
                <strong>Phân tích hiệu quả tài chính</strong>
                <i>/</i>
                <span>{projects.length} dự án</span>
              </div>
              <div className="top-actions">
                <button type="button" className="secondary-button" onClick={() => setView("projects")}>← Quay lại MTL</button>
                <button type="button" className="primary-button">+ Lập Phương Án FS</button>
                <UserBadge />
              </div>
            </header>
            <section className="project-index">
              <header className="project-index-header">
                <div>
                  <h1>DANH SÁCH DỰ ÁN LẬP FS THỰC THI (FS-VER2)</h1>
                </div>
                <label className="search-field project-index-search">
                  <span>Tìm dự án</span>
                  <input value={fsSearch} onChange={(event) => { setFsSearch(event.target.value); setFsPage(1); }} placeholder="Nhập tên, mã dự án, chủ đầu tư..." />
                </label>
              </header>

              {/* KPI Stats Bar */}
              <div className="table-stats-bar">
                <div className="table-stat-card">
                  <span>TỔNG DỰ ÁN FS</span>
                  <b>{projects.length}</b>
                </div>
                <div className="table-stat-card">
                  <span>CHƯA LẬP FS</span>
                  <b style={{ color: "#64748b" }}>{projects.filter((p) => p.fsStatus === "chua_lap").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>ĐANG TÍNH TOÁN FS</span>
                  <b style={{ color: "#1a56a8" }}>{projects.filter((p) => p.fsStatus === "dang_tinh_toan").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>ĐỐI CHIẾU SỐ LIỆU</span>
                  <b style={{ color: "#d97706" }}>{projects.filter((p) => p.fsStatus === "cho_doi_chieu").length}</b>
                </div>
                <div className="table-stat-card">
                  <span>ĐÃ DUYỆT FS-VER2</span>
                  <b style={{ color: "#167461" }}>{projects.filter((p) => p.fsStatus === "da_duyet").length}</b>
                </div>
              </div>

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
        ) : !activeProject ? (
          <div className="empty-state">
            <span className="empty-kicker">MTL WORKSPACE</span><h1>Tạo Master Timeline trong vài phút</h1><p>Nhập thông tin dự án, chọn phạm vi áp dụng và hệ thống sẽ sinh đúng cây công việc từ mẫu Microsoft Project.</p>
            <div className="empty-metrics"><div><b>9</b><span>Phòng ban</span></div><div><b>5</b><span>Nhóm Phần 4</span></div><div><b>{fullCatalog.length}</b><span>Task mẫu</span></div></div>
            <button className="primary-button" onClick={openCreate}>Tạo dự án đầu tiên</button>
          </div>
        ) : (
          <>
            {activeProject.isOfficialApproved && (
              <div className="baseline-banner">
                <div className="baseline-banner-left">
                  <span className="baseline-badge">🛡️ BASELINE LOCKED</span>
                  <span>Hồ sơ E-Approval: <strong>{activeProject.eApprovalCode}</strong></span>
                  <span>· Phiên bản: <strong>{activeProject.officialVersion || "v1.0"}</strong></span>
                  <span>· Ngày duyệt: <strong>{formatDate(activeProject.eApprovalDate || activeProject.approvedAt)}</strong></span>
                </div>
                <div className="baseline-banner-right">
                  {activeProject.eApprovalUrl && (
                    <a href={activeProject.eApprovalUrl} target="_blank" rel="noreferrer">
                      <span>Mở hồ sơ trên E-Approval</span>
                      <IconExternalLink />
                    </a>
                  )}
                  <button type="button" className="secondary-button" style={{ height: "26px", fontSize: "10.5px", background: "#ffffff22", color: "#fff", borderColor: "#ffffff44" }} onClick={reopenApproved}>
                    Tạo bản điều chỉnh
                  </button>
                </div>
              </div>
            )}

            <header className="topbar">
              <div className="breadcrumbs"><span>Lập Master timeline</span><i>/</i><button className="breadcrumb-back" onClick={() => setView("projects")}>Lập & Cập nhật</button><i>/</i><strong>{activeProject.code}</strong></div>
              <div className="top-actions">
                <span className="saved-state"><i />Đã lưu trên thiết bị</span>
                <button className="danger-button" onClick={() => setShowDelete(true)}>Xóa dự án</button>
                <button className="secondary-button project-export" onClick={exportMicrosoftProject}>Xuất Microsoft Project <small>.xml → .mpp</small></button>
                {!activeProject.isOfficialApproved && (
                  <button className="secondary-button" style={{ borderColor: "#168c72", color: "#168c72", fontWeight: 700 }} onClick={() => openEApprovalModal(activeProject)}>
                    ✓ Xác nhận E-Approval
                  </button>
                )}
                <button className="primary-button" onClick={openCreate}>Tạo Master timeline</button>
                <UserBadge />
              </div>
            </header>

            <section className="project-header">
              <div><span className={`status-badge approval-${activeProject.approvalStatus}`}>{projectApprovalLabel(activeProject)}{activeProject.approvedVersion ? ` · ${activeProject.approvedVersion}` : ""}</span><h1>{activeProject.name}</h1><p>{activeProject.code} · {activeProject.type}{activeProject.location ? ` · ${activeProject.location}` : ""}</p></div>
              <div className="project-metrics"><div><b>{scheduled.length}</b><span>TASK ĐÃ SINH</span></div><div><b>{activeProject.selectedGroups.filter((code) => GROUP_BY_CODE[code]?.role === "indirect").length}/{INDIRECT_COUNT}</b><span>BAN/PHÒNG GIÁN TIẾP</span></div><div><b>{activeProject.selectedGroups.filter((code) => GROUP_BY_CODE[code]?.role === "direct").length}/{DIRECT_COUNT}</b><span>PHÒNG TRỰC TIẾP</span></div><div><b>{formatDate(activeProject.targetDate)}</b><span>NGÀY MỤC TIÊU</span></div></div>
            </section>

            <section className={`approval-flow state-${activeProject.approvalStatus}`}>
              <div className="approval-steps">
                <span className="done"><i>1</i><b>Lập MTL</b></span><em />
                <span className={allDepartmentsApproved(activeProject) ? "done" : ""}><i>2</i><b>Phòng ban xác nhận</b></span><em />
                <span className={GMS_STAGES.includes(activeProject.approvalStatus) ? "done" : ""}><i>3</i><b>GMD kiểm soát</b></span><em />
                <span className={activeProject.approvalStatus === "appraised" || activeProject.approvalStatus === "approved" ? "done" : ""}><i>4</i><b>GMS thẩm định</b></span><em />
                <span className={activeProject.approvalStatus === "approved" ? "done" : ""}><i>5</i><b>Phê duyệt E-Approval</b></span>
              </div>
              <div className="approval-action">
                {isPlanEditable(activeProject) && !allDepartmentsApproved(activeProject) && <><span>Còn {pbcmGroupsOf(activeProject).length - approvedDepartmentCount(activeProject)} đầu mục chưa xác nhận</span><button className="secondary-button" onClick={() => openDepartmentReview()}>Mở xác nhận phòng ban</button></>}
                {isPlanEditable(activeProject) && allDepartmentsApproved(activeProject) && <button className="primary-button" onClick={submitToGmd}>Trình GMD kiểm soát</button>}
                {activeProject.approvalStatus === "gmd_review" && <span>Đã trình {formatDate(activeProject.gmdSubmittedAt)} · Đang chờ GMD kiểm soát</span>}
                {activeProject.approvalStatus === "submitted" && <span>GMD đã duyệt {formatDate(activeProject.gmdReviewedAt)} · Đang chờ GMS thẩm định</span>}
                {activeProject.approvalStatus === "appraised" && !activeProject.isOfficialApproved && <button className="primary-button" onClick={() => openEApprovalModal(activeProject)}>Xác nhận duyệt qua E-Approval</button>}
                {activeProject.isOfficialApproved && <><span>Đã duyệt E-Approval {formatDate(activeProject.eApprovalDate)}</span><button className="secondary-button" onClick={reopenApproved}>Tạo bản điều chỉnh</button></>}
              </div>
            </section>
            <section className="department-status-strip" aria-label="Trạng thái xác nhận phòng ban">{PBCM_GROUPS.filter((group) => activeProject.selectedGroups.includes(group.code)).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} className={`status-${approval?.status ?? "pending"}`} title={approval?.note || `${group.name} · ${DEPARTMENT_APPROVAL_LABEL[approval?.status ?? "pending"]}`} onClick={() => openDepartmentReview(group.code)}><i>{approval?.status === "approved" ? "✓" : approval?.status === "changes_requested" ? "!" : "·"}</i><span><b>{group.code}</b><small>{group.short}</small></span></button>; })}</section>
            {activeProject.selectedGroups.some((code) => activeProject.departmentApprovals[code]?.note) && <section className="department-feedback-list"><b>Ý kiến xác nhận phòng ban</b><div>{GROUPS.filter((group) => activeProject.departmentApprovals[group.code]?.note).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} onClick={() => openDepartmentReview(group.code)}><span>{group.code} · {group.short}</span><p>{approval.note}</p><small>{approval.reviewer || "Chưa gán người xác nhận"} · {DEPARTMENT_APPROVAL_LABEL[approval.status]}</small></button>; })}</div></section>}
            {activeProject.reviewNote && <div className={`review-note ${activeProject.approvalStatus}`}><b>Phản hồi thẩm định từ GMS</b><span>{activeProject.reviewNote}</span><small>Gửi lúc {formatDateTime(activeProject.reviewedAt)} · Vui lòng cập nhật các nội dung được nêu trước khi gửi lại.</small></div>}

            <section className="toolbar" aria-label="Công cụ danh sách MTL">
              <div className="scope-tabs"><span className="active">Tất cả công việc ({scheduled.length})</span></div>
              <label className="search-field"><span>Tìm</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã WBS hoặc tên công việc" /></label>
              <button className="text-button" onClick={() => setCollapsed(new Set())}>Mở tất cả</button><button className="text-button" onClick={() => setCollapsed(new Set(activeProject.selectedGroups))}>Thu gọn</button>
            </section>

            <div className={`planning-area ${selectedTask ? "with-detail" : ""}`}>
              <section className="task-grid" aria-label="Cây công việc Master Timeline">
                <div className="grid-header" style={{ gridTemplateColumns: "minmax(260px, 1.4fr) 80px 150px 100px 90px 70px" }}>
                  <span>CÔNG VIỆC / WBS</span>
                  <span>ĐƠN VỊ</span>
                  <span>KẾ HOẠCH</span>
                  <span>% THỰC TẾ</span>
                  <span>TRẠNG THÁI</span>
                  <span>TIẾN ĐỘ</span>
                </div>
                <div className="grid-body">
                  {visibleTasks.map((task) => {
                    const group = GROUP_BY_CODE[task.groupCode];
                    const isCollapsed = collapsed.has(task.code);
                    return (
                      <div key={task.code} role="button" tabIndex={0} className={`task-row level-${Math.min(task.level, 4)} ${selectedCode === task.code ? "selected" : ""} ${task.summary ? "summary" : ""}`} style={{ gridTemplateColumns: "minmax(260px, 1.4fr) 80px 150px 100px 90px 70px" }} onClick={() => setSelectedCode(task.code)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedCode(task.code); }}>
                        <span className="task-cell task-title" title="Nhấp chuột phải để thêm, sửa hoặc xóa" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ code: task.code, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 180) }); }} style={{ "--indent": `${(task.level - 1) * 18}px` } as React.CSSProperties}>
                          {task.summary ? <i className="toggle" role="button" aria-label={isCollapsed ? "Mở nhóm" : "Thu gọn nhóm"} onClick={(event) => { event.stopPropagation(); setCollapsed((current) => { const next = new Set(current); if (next.has(task.code)) next.delete(task.code); else next.add(task.code); return next; }); }}>{isCollapsed ? "+" : "−"}</i> : <i className="task-dot" />}
                          <span className="task-inline"><b>{task.code}</b><small>{task.name}</small>{task.custom && <i className="custom-chip">Mới</i>}{task.predecessors.length > 0 && <i className={`dependency-chip ${task.dependencyConflict ? "conflict" : ""}`}>{task.predecessors.map((dependency) => `${dependency.type} · ${dependency.predecessorCode}${dependency.lagDays ? ` + ${dependency.lagDays}d` : ""}`).join(", ")}</i>}</span>
                        </span>
                        <span className="task-cell owner-cell"><b>{group?.short}</b><small>{group?.name}</small></span>
                        <span className="task-cell date-cell" style={{ fontSize: "10px", lineHeight: "1.2" }}>
                          <b>{formatDate(task.startDate)}</b>
                          <small style={{ color: "#627d98", display: "block" }}>→ {formatDate(task.endDate)} ({task.duration}d)</small>
                        </span>
                        <span className="task-cell" onClick={(e) => { e.stopPropagation(); if (!task.summary) openProgressModal(task); }}>
                          <div className="progress-cell" style={{ cursor: task.summary ? "default" : "pointer" }}>
                            <div className="progress-cell-header">
                              <span className="percent">{task.actualProgress}%</span>
                            </div>
                            <div className="progress-bar-track">
                              <div className={`progress-bar-fill ${task.actualProgress === 100 ? "done" : (task.actualStatus === "Trễ hạn" ? "late" : "running")}`} style={{ width: `${task.actualProgress}%` }} />
                            </div>
                          </div>
                        </span>
                        <span className="task-cell">
                          <i className={`actual-status-badge ${task.actualStatus === "Hoàn thành" ? "status-done" : (task.actualStatus === "Trễ hạn" ? "status-late" : (task.actualStatus === "Đang thực hiện" ? "status-running" : "status-idle"))}`}>
                            {task.actualStatus}
                          </i>
                        </span>
                        <span className="task-cell">
                          {!task.summary ? (
                            <button type="button" className="progress-quick-btn" title="Cập nhật tiến độ thực tế" onClick={(e) => { e.stopPropagation(); openProgressModal(task); }}>
                              <IconSlider />
                            </button>
                          ) : (
                            <span style={{ fontSize: "10px", color: "#829ab1", fontWeight: 700 }}>Tổng hợp</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  {!visibleTasks.length && <div className="no-results">Không tìm thấy công việc phù hợp.</div>}
                </div>
                <footer className="grid-footer"><span>Hiển thị {visibleTasks.length}/{scheduled.length} task · {projectDependencyCount(activeProject)} liên kết</span><span>{activeProject.isOfficialApproved ? `Master Timeline chính thức đã khóa Baseline. Bấm vào cột % để cập nhật tiến độ thực tế.` : "Nhấp chuột phải tại cột Công việc/WBS để thêm con, chỉnh sửa hoặc xóa."}</span></footer>
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
              <div>
                <span>TẠO MASTER TIMELINE</span>
                <h2>Thông tin dự án</h2>
              </div>
              <button type="button" onClick={() => setShowCreate(false)}>Đóng</button>
            </header>

            <div className="form-grid">
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
                <span>Chủ đầu tư (Pháp nhân)</span>
                <input
                  value={form.investor || ""}
                  onChange={(event) => setForm({ ...form, investor: event.target.value })}
                  placeholder="Ví dụ: Công ty TNHH BĐS Đà Lạt Valley"
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
                <span>Ngày bắt đầu</span>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                />
              </label>

              <label className="field">
                <span>Ngày kết thúc dự án</span>
                <input
                  type="date"
                  value={form.targetDate}
                  onChange={(event) => setForm({ ...form, targetDate: event.target.value })}
                />
              </label>

              <div className="field field-wide">
                <div className="file-upload-box">
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
                    Upload Master timeline (.xml)
                  </span>
                  <input
                    type="file"
                    accept=".xml"
                    onChange={handleXMLUpload}
                    className="file-input-styled"
                  />
                  {xmlData && (
                    <small style={{ color: "#167461", display: "block", marginTop: "4px", fontWeight: 700 }}>
                      ✓ Tệp hợp lệ: Tìm thấy {xmlData.customTasks.length} công việc.
                    </small>
                  )}
                </div>
              </div>
            </div>

            {formError && <div className="form-error" role="alert">{formError}</div>}

            <footer>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowCreate(false)}
              >
                Hủy
              </button>
              <button
                className="primary-button"
                type="submit"
                style={{ background: "#73b52d", borderColor: "#64a024" }}
              >
                Tạo Master Timeline
              </button>
            </footer>
          </form>
        </div>
      )}

      {showTaskModal && <div className="modal-backdrop" onMouseDown={() => { setShowTaskModal(false); setInsertAnchor(null); }}>
        <form className="project-modal task-modal" onSubmit={addCatalogTask} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>{insertAnchor ? `THÊM TẠI WBS ${insertAnchor.code}` : "DANH MỤC WBS"}</span><h2>Thêm công việc mới</h2><p>{insertAnchor ? `Mã và WBS cha đã được gợi ý theo vị trí “${insertAnchor.name}”.` : "Công việc được lưu vào danh mục dùng chung cho các dự án sau."}</p></div><button type="button" onClick={() => { setShowTaskModal(false); setInsertAnchor(null); }}>Đóng</button></header>
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

