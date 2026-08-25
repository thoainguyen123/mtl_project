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
  status?: "Đang thực hiện" | "Đóng" | "Hoàn thành";
};

type TaskDependency = {
  predecessorCode: string;
  type: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
};

type DefaultTaskDependency = TaskDependency & { successorCode: string };

type ApprovalStatus = "draft" | "submitted" | "approved" | "changes_requested";
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
  submittedAt?: string;
  submittedBy?: string;
  approvedAt?: string;
  reviewedAt?: string;
  approvedVersion?: string;
  reviewNote?: string;
};

type ProjectForm = Pick<Project, "name" | "code" | "type" | "location" | "startDate" | "targetDate" | "area" | "region" | "group">;

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

const GROUPS = [
  { code: "9.1", short: "HRC", name: "Hành chính Nhân sự", scope: "9 phòng ban" },
  { code: "9.2", short: "FAC", name: "Tài chính - Kế toán", scope: "9 phòng ban" },
  { code: "9.3", short: "SAC", name: "Kinh doanh", scope: "9 phòng ban" },
  { code: "9.4", short: "MAC", name: "Marketing", scope: "9 phòng ban" },
  { code: "9.5", short: "PRC", name: "Cung ứng Đấu thầu", scope: "9 phòng ban" },
  { code: "9.6", short: "QSB", name: "Khối lượng và Ngân sách", scope: "9 phòng ban" },
  { code: "9.7", short: "SEC", name: "An ninh", scope: "9 phòng ban" },
  { code: "9.8", short: "IDD", name: "Thiết kế Nội bộ", scope: "9 phòng ban" },
  { code: "9.9", short: "CSC", name: "Bồi thường GPMB", scope: "9 phòng ban" },
  { code: "4.0", short: "PMD", name: "Quản lý Phát triển Dự án", scope: "Phần 4" },
  { code: "4.1", short: "PLP", name: "Pháp lý Dự án", scope: "Phần 4" },
  { code: "4.2", short: "DMD", name: "Quản lý Thiết kế", scope: "Phần 4" },
  { code: "4.3", short: "PCD", name: "Quản lý Thi công", scope: "Phần 4" },
  { code: "4.4", short: "OM", name: "Quản lý Vận hành", scope: "Phần 4" },
] as const;

const GROUP_BY_CODE = Object.fromEntries(GROUPS.map((group) => [group.code, group]));
const GROUP_ORDER = Object.fromEntries(GROUPS.map((group, index) => [group.code, index]));
const today = new Date().toISOString().slice(0, 10);
const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

const emptyForm: ProjectForm = {
  area: "Khu vực 1",
  region: "",
  name: "",
  code: "",
  group: "Nhóm 1 (Đang nghiên cứu)",
  type: "Công trình cao tầng",
  location: "",
  startDate: today,
  targetDate: nextYear,
};

const emptyTaskForm: TaskForm = {
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

function normalizeDepartmentApprovals(selectedGroups: string[], approvals?: Record<string, DepartmentApproval>, legacyApproved = false) {
  return Object.fromEntries(GROUPS.filter((group) => selectedGroups.includes(group.code)).map((group) => {
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

function normalizeProject(project: Partial<Project>): Project {
  const selectedGroups = project.selectedGroups ?? GROUPS.map((group) => group.code);
  const projectTasks = [...TEMPLATE, ...(project.customTasks ?? [])];
  const taskEdits = Object.fromEntries(Object.entries(project.taskEdits ?? {}).map(([code, edit]) => [code, {
    ...edit,
    ...(edit.status ? { status: normalizeTaskStatus(edit.status) } : {}),
  }])) as Record<string, TaskEdit>;
  const includedTaskCodes = project.includedTaskCodes ?? projectTasks.filter((task) => selectedGroups.includes(task.groupCode)).map((task) => task.code);
  return {
    id: project.id ?? crypto.randomUUID(),
    name: project.name ?? "Dự án chưa đặt tên",
    code: project.code ?? "MTL",
    type: project.type ?? "Công trình cao tầng",
    location: project.location ?? "",
    area: project.area ?? "Khu vực 1",
    region: project.region ?? "",
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
    approvalStatus: project.approvalStatus ?? "draft",
    submittedAt: project.submittedAt,
    submittedBy: project.submittedBy,
    approvedAt: project.approvedAt,
    reviewedAt: project.reviewedAt,
    approvedVersion: project.approvedVersion,
    reviewNote: project.reviewNote,
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
    return {
      ...task,
      startDate,
      endDate,
      duration,
      left: Math.min(98, (startOffset / totalDays) * 100),
      width: Math.max(0.7, Math.min(100, (duration / totalDays) * 100)),
      pic: edit.pic ?? "",
      status: edit.status ?? "Đang thực hiện",
      predecessors: project.taskDependencies[task.code] ?? [],
    };
  });

  const rolledUp = tasks.map((task) => {
    if (!task.summary) return task;
    const descendants = tasks.filter((candidate) => candidate.code.startsWith(`${task.code}.`));
    if (!descendants.length) return task;
    const startDate = descendants.reduce((earliest, candidate) => candidate.startDate < earliest ? candidate.startDate : earliest, descendants[0].startDate);
    const endDate = descendants.reduce((latest, candidate) => candidate.endDate > latest ? candidate.endDate : latest, descendants[0].endDate);
    return { ...task, startDate, endDate, duration: Math.max(1, workingDaysBetween(startDate, endDate)) };
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
function IconSeal() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3" /><circle cx="12" cy="12" r="4.5" /><polyline points="10 12 11.5 13.5 14 10.5" /></svg>;
}
function IconList() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="18" height="17" rx="3" /><line x1="8.5" y1="8.5" x2="16" y2="8.5" /><line x1="8.5" y1="12" x2="16" y2="12" /><line x1="8.5" y1="15.5" x2="13" y2="15.5" /><circle cx="5.5" cy="8.5" r="0.75" fill="currentColor" stroke="none" /><circle cx="5.5" cy="12" r="0.75" fill="currentColor" stroke="none" /><circle cx="5.5" cy="15.5" r="0.75" fill="currentColor" stroke="none" /></svg>;
}
function IconGauge() {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3.5" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="13" width="7.5" height="7.5" rx="1.5" /></svg>;
}

/* Progress buckets shown on the overview: a task counts as late only when its finish
   date has passed and it has not been marked complete. */
const WORK_DONE = "#2ea44f";
const WORK_LATE = "#d92b2b";
const WORK_RUNNING = "#1f4e79";

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

function Donut({ stat, size = 104 }: { stat: WorkStat; size?: number }) {
  const segments = [
    { value: stat.running, color: WORK_RUNNING },
    { value: stat.late, color: WORK_LATE },
    { value: stat.done, color: WORK_DONE },
  ];
  const total = stat.total || 1;
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;
  let consumed = 0;
  return (
    <svg className="donut" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e6ecf1" strokeWidth="18" />
      {segments.map((segment, index) => {
        const length = (segment.value / total) * circumference;
        const node = <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={segment.color} strokeWidth="18" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-consumed} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
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
  return project.selectedGroups.filter((code) => project.departmentApprovals[code]?.status === "approved").length;
}

function allDepartmentsApproved(project: Project) {
  return project.selectedGroups.length > 0 && approvedDepartmentCount(project) === project.selectedGroups.length;
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
  submitted: "CHỜ GMS THẨM ĐỊNH",
  approved: "HOÀN THÀNH THẨM ĐỊNH",
  changes_requested: "GMS YÊU CẦU ĐIỀU CHỈNH",
};

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
  const [view, setView] = useState<"overview" | "projects" | "workspace" | "departments" | "catalog" | "gms">("overview");
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
  const [departmentCode, setDepartmentCode] = useState<string>(GROUPS[0].code);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [taskForm, setTaskForm] = useState<TaskForm>(emptyTaskForm);
  const [formError, setFormError] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [search, setSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState<ApprovalStatus | "all">("all");
  const [projectPage, setProjectPage] = useState(1);
  const [projectPageSize, setProjectPageSize] = useState(10);
  const [gmsSearch, setGmsSearch] = useState("");
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
        const normalized = saved.map(normalizeProject);
        setProjects(normalized);
        setCustomCatalog(savedCustomCatalog);
        const catalogCodes = new Set([...TEMPLATE, ...savedCustomCatalog].map((task) => task.code));
        setEnabledCatalogCodes(new Set(savedEnabledCodes ? (JSON.parse(savedEnabledCodes) as string[]).filter((code) => catalogCodes.has(code)) : [...catalogCodes]));
        setActiveId(localStorage.getItem(ACTIVE_KEY) ?? normalized[0]?.id ?? "");
      } catch {
        setProjects([]);
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
  const departmentPendingCount = activeProject ? activeProject.selectedGroups.length - departmentApprovedCount : 0;
  const visibleProjects = useMemo(() => {
    const query = projectSearch.trim().toLocaleLowerCase("vi");
    return projects.filter((project) => {
      const matchesQuery = !query || `${project.code} ${project.name} ${project.location} ${project.type}`.toLocaleLowerCase("vi").includes(query);
      const matchesStatus = projectStatusFilter === "all" || project.approvalStatus === projectStatusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [projects, projectSearch, projectStatusFilter]);
  const pagedProjects = useMemo(() => visibleProjects.slice((Math.min(projectPage, Math.max(1, Math.ceil(visibleProjects.length / projectPageSize))) - 1) * projectPageSize, Math.min(projectPage, Math.max(1, Math.ceil(visibleProjects.length / projectPageSize))) * projectPageSize), [visibleProjects, projectPage, projectPageSize]);
  const overviewToday = new Date().toISOString().slice(0, 10);
  const overviewRegions = useMemo(() => [...new Set(projects.map((project) => project.region).filter(Boolean) as string[])].sort(), [projects]);
  const overviewEntries = useMemo(() => projects.flatMap((project) => scheduleTasks(project).filter((task) => !task.summary).map((task) => ({ project, task }))), [projects]);
  const overviewFiltered = useMemo(() => overviewEntries.filter(({ project, task }) => (overviewRegion === "all" || project.region === overviewRegion)
    && (overviewProject === "all" || project.id === overviewProject)
    && (overviewGroup === "all" || task.groupCode === overviewGroup)), [overviewEntries, overviewRegion, overviewProject, overviewGroup]);
  const overview = useMemo(() => {
    const byGroup = new Map<string, WorkStat>();
    const byProject = new Map<string, WorkStat>();
    const byPerson = new Map<string, WorkStat>();
    const indirect = emptyWorkStat();
    const direct = emptyWorkStat();
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
      countWork(task.groupCode.startsWith("9.") ? indirect : direct, task, overviewToday);
      countWork(all, task, overviewToday);
    });
    const visibleProjectIds = new Set(overviewFiltered.map(({ project }) => project.id));
    const visibleRegions = new Set(overviewFiltered.map(({ project }) => project.region).filter(Boolean));
    return {
      all,
      indirect,
      direct,
      indirectGroups: GROUPS.filter((group) => group.code.startsWith("9.")).length,
      directGroups: GROUPS.filter((group) => !group.code.startsWith("9.")).length,
      regionCount: visibleRegions.size,
      projectCount: visibleProjectIds.size,
      groupRows: GROUPS.map((group) => ({ group, stat: byGroup.get(group.code) ?? emptyWorkStat() })).filter((row) => row.stat.total > 0),
      projectRows: projects.filter((project) => byProject.has(project.id)).map((project) => ({ project, stat: byProject.get(project.id)! })).sort((a, b) => b.stat.total - a.stat.total),
      personRows: [...byPerson.entries()].map(([person, stat]) => ({ person, stat })).sort((a, b) => b.stat.late - a.stat.late || b.stat.total - a.stat.total),
    };
  }, [overviewFiltered, overviewToday, projects]);
  const overviewMaxGroupTotal = Math.max(1, ...overview.groupRows.map((row) => row.stat.total));
  const overviewMaxProjectTotal = Math.max(1, ...overview.projectRows.map((row) => row.stat.total));
  const overviewMaxPersonLate = Math.max(1, ...overview.personRows.map((row) => row.stat.late));
  const pendingGmsCount = projects.filter((project) => project.approvalStatus === "submitted").length;
  const reviewedGmsProjects = projects.filter((project) => project.approvalStatus !== "draft").sort((a, b) => {
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
    if (!activeProject || activeProject.approvalStatus === "approved") return;
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
    if (!activeProject || activeProject.approvalStatus === "approved") return;
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
    if (!activeProject || activeProject.approvalStatus === "approved") return;
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
    if (!activeProject || activeProject.approvalStatus === "approved") return;
    setProjects((current) => current.map((project) => project.id === activeProject.id ? {
      ...project,
      departmentApprovals: { ...project.departmentApprovals, [groupCode]: { ...project.departmentApprovals[groupCode], ...patch } },
    } : project));
  };

  const reviewDepartment = (decision: "approved" | "changes_requested") => {
    if (!activeProject || !departmentApproval || activeProject.approvalStatus === "approved") return;
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

  const submitToGms = () => {
    if (!activeProject) return;
    if (!allDepartmentsApproved(activeProject)) return notify("Cần đủ xác nhận của 14 đầu mục phòng ban trước khi gửi GMS");
    setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, approvalStatus: "submitted", submittedAt: new Date().toISOString(), submittedBy: "Project Manager", reviewedAt: undefined, reviewNote: "" } : project));
    notify("Đã gửi MTL sang GMS thẩm định");
  };

  const selectGmsProject = (project: Project) => {
    setGmsSelectedId(project.id);
    setReviewNote(project.reviewNote ?? "");
  };

  const reviewProject = (decision: "approved" | "changes_requested") => {
    if (!gmsSelectedProject) return;
    const note = reviewNote.trim();
    if (decision === "changes_requested" && !note) {
      notify("Vui lòng nhập Ý kiến thẩm định để người lập biết nội dung cần sửa");
      return;
    }
    setProjects((current) => current.map((project) => project.id === gmsSelectedProject.id ? {
      ...project,
      approvalStatus: decision,
      reviewedAt: new Date().toISOString(),
      approvedAt: decision === "approved" ? new Date().toISOString() : undefined,
      approvedVersion: decision === "approved" ? "v1.0" : undefined,
      reviewNote: note,
    } : project));
    setGmsFilter("history");
    notify(decision === "approved" ? "GMS đã phê duyệt — bản MTL v1.0 đã khóa" : "GMS đã trả MTL để điều chỉnh");
  };

  const reopenApproved = () => {
    if (!activeProject) return;
    setProjects((current) => current.map((project) => project.id === activeProject.id ? { ...project, approvalStatus: "draft", departmentApprovals: normalizeDepartmentApprovals(project.selectedGroups), approvedAt: undefined, reviewedAt: undefined, approvedVersion: undefined, reviewNote: "" } : project));
    notify("Đã tạo bản điều chỉnh từ MTL được duyệt");
  };

  if (!hydrated) return <main className="loading-screen"><div className="loading-mark">MTL</div><p>Đang chuẩn bị không gian dự án…</p></main>;

  return (
    <main className="app-shell">
      <style>{`
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
      `}</style>
      <aside className="sidebar">
        <div className="brand"><img className="brand-logo" src="/nova-group-logo-light.png" alt="Nova Group" /><div className="brand-app"><strong><span>QUẢN LÝ</span><span>TIẾN ĐỘ TỔNG THỂ DỰ ÁN</span></strong></div></div>
        <nav className="sidebar-nav sidebar-nav-top" aria-label="Điều hướng chính"><button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><IconGauge /><span>Tổng quan tiến độ dự án</span></button></nav>
        <div className="sidebar-section-label">Lập Master Timeline</div>
        <nav className="sidebar-nav" aria-label="Điều hướng Lập MTL"><button className={view === "projects" || view === "workspace" ? "active" : ""} onClick={() => setView("projects")}><IconTimeline /><span>Lập & Cập nhật</span><b>{projects.length}</b></button><button className={view === "departments" ? "active" : ""} onClick={() => openDepartmentReview()}><IconCheck /><span>PBCM xác nhận</span>{departmentPendingCount > 0 && <b>{departmentPendingCount}</b>}</button><button className={view === "gms" ? "active" : ""} onClick={() => setView("gms")}><IconSeal /><span>Thẩm định</span>{pendingGmsCount > 0 && <b className="nav-alert">{pendingGmsCount}</b>}</button></nav>
        <div className="sidebar-section-label">Cấu trúc Master timeline</div>
        <nav className="sidebar-nav" aria-label="Điều hướng Cấu trúc MTL"><button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")}><IconList /><span>Danh mục WBS</span><b>{fullCatalog.length}</b></button></nav>
        <div className="template-card"><span>MẪU ĐANG DÙNG</span><strong>NVLG MTL 2026.06</strong><small>{fullCatalog.length} task · 14 nhóm · WBS cấp 4</small></div>
        <div className="sidebar-footer">MTL v1.0 · © 2026 Novaland Group</div>
      </aside>

      <section className="workspace">
        {view === "overview" ? (
          <>
            <header className="topbar"><div className="breadcrumbs"><strong>Tổng quan</strong><i>/</i><span>Theo dõi thực hiện công việc</span></div><div className="top-actions"><UserBadge /></div></header>
            <section className="overview">
              <header className="overview-header"><h1>Theo dõi thực hiện công việc</h1><span className="overview-date">{formatDate(overviewToday)}</span></header>

              <div className="overview-top">
                <div className="overview-filters">
                  <label className="field"><span>Vùng</span><select value={overviewRegion} onChange={(event) => setOverviewRegion(event.target.value)}><option value="all">Tất cả</option>{overviewRegions.map((region) => <option key={region} value={region}>{region}</option>)}</select></label>
                  <label className="field"><span>Tên dự án</span><select value={overviewProject} onChange={(event) => setOverviewProject(event.target.value)}><option value="all">Tất cả</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
                  <label className="field"><span>Phòng/Ban</span><select value={overviewGroup} onChange={(event) => setOverviewGroup(event.target.value)}><option value="all">Tất cả</option>{GROUPS.map((group) => <option key={group.code} value={group.code}>{group.code} · {group.short}</option>)}</select></label>
                </div>

                <div className="kpi-card kpi-scope">
                  <header>Tổng vùng<b>{overview.regionCount}</b></header>
                  <div className="kpi-scope-body"><b>{formatCount(overview.projectCount)}</b><span>Dự án</span></div>
                </div>

                <div className="kpi-card kpi-work indirect">
                  <header>{overview.indirectGroups} ban/phòng gián tiếp<b>{formatCount(overview.indirect.total)}</b></header>
                  <div className="kpi-work-body">
                    <WorkLegend />
                    <div className="kpi-donut"><Donut stat={overview.indirect} /><div className="kpi-donut-values"><b style={{ color: WORK_RUNNING }}>{formatCount(overview.indirect.running)}</b><b style={{ color: WORK_LATE }}>{formatCount(overview.indirect.late)}</b><b style={{ color: WORK_DONE }}>{formatCount(overview.indirect.done)}</b></div></div>
                  </div>
                </div>

                <div className="kpi-card kpi-work direct">
                  <header>{overview.directGroups} phòng trực tiếp<b>{formatCount(overview.direct.total)}</b></header>
                  <div className="kpi-work-body">
                    <WorkLegend />
                    <div className="kpi-donut"><Donut stat={overview.direct} /><div className="kpi-donut-values"><b style={{ color: WORK_RUNNING }}>{formatCount(overview.direct.running)}</b><b style={{ color: WORK_LATE }}>{formatCount(overview.direct.late)}</b><b style={{ color: WORK_DONE }}>{formatCount(overview.direct.done)}</b></div></div>
                  </div>
                </div>
              </div>

              {overview.all.total === 0 ? <div className="overview-empty"><b>Chưa có dữ liệu công việc</b><span>Tạo dự án và sinh Master Timeline để theo dõi tiến độ tại đây.</span><button className="primary-button" onClick={openCreate}>Tạo Master timeline</button></div> : <div className="overview-grid">
                <section className="panel">
                  <header className="panel-head"><h2>Công việc theo phòng ban</h2><WorkLegend /></header>
                  <div className="bar-list">
                    {overview.groupRows.map(({ group, stat }) => <div className="bar-row" key={group.code}>
                      <span className="bar-label">{group.code} {group.short}</span>
                      <span className="bar-track" style={{ width: `${(stat.total / overviewMaxGroupTotal) * 100}%` }}>
                        {stat.running > 0 && <i style={{ width: `${(stat.running / stat.total) * 100}%`, background: WORK_RUNNING }} title={`Đang triển khai: ${formatCount(stat.running)}`}>{stat.running / stat.total > 0.12 ? formatCount(stat.running) : ""}</i>}
                        {stat.done > 0 && <i style={{ width: `${(stat.done / stat.total) * 100}%`, background: WORK_DONE }} title={`Hoàn thành: ${formatCount(stat.done)}`}>{stat.done / stat.total > 0.12 ? formatCount(stat.done) : ""}</i>}
                        {stat.late > 0 && <i style={{ width: `${(stat.late / stat.total) * 100}%`, background: WORK_LATE }} title={`Trễ hạn: ${formatCount(stat.late)}`}>{stat.late / stat.total > 0.12 ? formatCount(stat.late) : ""}</i>}
                      </span>
                      <span className="bar-total">{formatCount(stat.total)}</span>
                    </div>)}
                  </div>
                </section>

                <section className="panel">
                  <header className="panel-head"><h2>Chi tiết theo phòng ban</h2></header>
                  <div className="heat-table">
                    <div className="heat-head"><span>Phòng/Ban</span><span>Tổng công việc</span><span>Hoàn thành</span><span>Trễ hạn</span><span>Tỷ lệ trễ hạn</span></div>
                    <div className="heat-body">
                      {overview.groupRows.map(({ group, stat }) => <div className="heat-row" key={group.code}>
                        <span>{group.code} {group.short}</span>
                        <span>{formatCount(stat.total)}</span>
                        <span>{formatCount(stat.done)}</span>
                        <span style={{ background: stat.late ? `rgba(217,43,43,${0.12 + 0.78 * (stat.late / overview.groupRows.reduce((max, row) => Math.max(max, row.stat.late), 1))})` : undefined, color: stat.late / Math.max(1, overview.groupRows.reduce((max, row) => Math.max(max, row.stat.late), 1)) > 0.6 ? "#fff" : undefined }}>{formatCount(stat.late)}</span>
                        <span>{latePercent(stat).toFixed(2)}%</span>
                      </div>)}
                    </div>
                    <div className="heat-row heat-total"><span>Tổng</span><span>{formatCount(overview.all.total)}</span><span>{formatCount(overview.all.done)}</span><span>{formatCount(overview.all.late)}</span><span>{latePercent(overview.all).toFixed(2)}%</span></div>
                  </div>
                </section>

                <section className="panel">
                  <header className="panel-head"><h2>Công việc theo dự án</h2><WorkLegend /></header>
                  <div className="column-chart">
                    {overview.projectRows.slice(0, 8).map(({ project, stat }) => <div className="column-group" key={project.id}>
                      <div className="column-bars">
                        <i style={{ height: `${(stat.running / overviewMaxProjectTotal) * 100}%`, background: WORK_RUNNING }} title={`Đang triển khai: ${formatCount(stat.running)}`}><b>{formatCount(stat.running)}</b></i>
                        <i style={{ height: `${(stat.done / overviewMaxProjectTotal) * 100}%`, background: WORK_DONE }} title={`Hoàn thành: ${formatCount(stat.done)}`}><b>{formatCount(stat.done)}</b></i>
                        <i style={{ height: `${(stat.late / overviewMaxProjectTotal) * 100}%`, background: WORK_LATE }} title={`Trễ hạn: ${formatCount(stat.late)}`}><b>{formatCount(stat.late)}</b></i>
                      </div>
                      <span className="column-label" title={project.name}>{project.code}</span>
                    </div>)}
                  </div>
                </section>

                <section className="panel">
                  <header className="panel-head"><h2>Nhân sự thực hiện</h2></header>
                  <div className="heat-table person-table">
                    <div className="heat-head"><span>Người thực hiện</span><span>Tổng công việc</span><span>Hoàn thành</span><span>Trễ hạn</span><span>Tỷ lệ trễ hạn</span></div>
                    <div className="heat-body">
                      {overview.personRows.map(({ person, stat }) => <div className="heat-row" key={person}>
                        <span title={person}>{person}</span>
                        <span>{formatCount(stat.total)}</span>
                        <span>{formatCount(stat.done)}</span>
                        <span style={{ background: stat.late ? `rgba(217,43,43,${0.12 + 0.78 * (stat.late / overviewMaxPersonLate)})` : undefined, color: stat.late / overviewMaxPersonLate > 0.6 ? "#fff" : undefined }}>{formatCount(stat.late)}</span>
                        <span>{latePercent(stat).toFixed(2)}%</span>
                      </div>)}
                    </div>
                    <div className="heat-row heat-total"><span>Tổng</span><span>{formatCount(overview.all.total)}</span><span>{formatCount(overview.all.done)}</span><span>{formatCount(overview.all.late)}</span><span>{latePercent(overview.all).toFixed(2)}%</span></div>
                  </div>
                </section>
              </div>}
            </section>
          </>
        ) : view === "projects" ? (
          <>
            <header className="topbar"><div className="breadcrumbs"><strong>Danh mục dự án</strong><i>/</i><span>{projects.length} dự án</span></div><div className="top-actions"><button className="primary-button" onClick={openCreate}>Tạo Master timeline</button><UserBadge /></div></header>
            <section className="project-index">
              <header className="project-index-header"><div><span>MASTER TIMELINE</span><h1>Danh mục dự án</h1><p>Chọn tên dự án để mở màn hình lập và theo dõi MTL.</p></div><label className="search-field project-index-search"><span>Tìm dự án</span><input value={projectSearch} onChange={(event) => { setProjectSearch(event.target.value); setProjectPage(1); }} placeholder="Nhập tên hoặc mã dự án" /></label></header>
              <div className="table-filters">
                <label className="table-filters-select"><span>Trạng thái</span><select value={projectStatusFilter} onChange={(event) => { setProjectStatusFilter(event.target.value as ApprovalStatus | "all"); setProjectPage(1); }}><option value="all">Tất cả trạng thái</option><option value="draft">{APPROVAL_LABEL.draft}</option><option value="submitted">{APPROVAL_LABEL.submitted}</option><option value="approved">{APPROVAL_LABEL.approved}</option><option value="changes_requested">{APPROVAL_LABEL.changes_requested}</option></select></label>
                <span className="table-filters-count">{visibleProjects.length} dự án</span>
              </div>
              {visibleProjects.length > 0 ? <div className="project-table" aria-label="Các dự án hiện có">
                <div className="project-table-head"><span>Mã dự án</span><span>Vùng</span><span>Tên dự án</span><span>Vị trí</span><span>Trạng thái</span><span>Ngày tạo</span><span>Hành động</span></div>
                <div className="project-table-body">
                  {pagedProjects.map((project) => (
                    <div key={project.id} className="project-table-row" onClick={() => openProject(project)}>
                      <span className="project-code">{project.code}</span>
                      <span className="project-region-cell">{project.region || project.area || "—"}</span>
                      <span className="project-name-cell"><b>{project.name}</b><small>{project.type}</small></span>
                      <span>{project.location || "—"}</span>
                      <span><span className={`status-badge approval-${project.approvalStatus}`}>{projectApprovalLabel(project)}{project.approvedVersion ? ` · ${project.approvedVersion}` : ""}</span></span>
                      <span>{formatDate(project.createdAt)}</span>
                      <span className="project-action-cell">
                        <button type="button" className="action-btn view-btn" title="Mở dự án" aria-label="Mở dự án" onClick={(event) => { event.stopPropagation(); openProject(project); }}>
                          <IconEye />
                        </button>
                        <button type="button" className="action-btn delete-btn" title="Xóa dự án" aria-label="Xóa dự án" onClick={(event) => { event.stopPropagation(); setProjectToDelete(project); }}>
                          <IconTrash />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div> : <div className="project-index-empty"><b>{projectSearch || projectStatusFilter !== "all" ? "Không tìm thấy dự án phù hợp" : "Chưa có dự án nào"}</b><span>{projectSearch || projectStatusFilter !== "all" ? "Thử tìm bằng tên/mã khác hoặc đổi bộ lọc trạng thái." : "Tạo dự án đầu tiên để hệ thống sinh Master Timeline từ danh mục WBS."}</span>{!projectSearch && projectStatusFilter === "all" && <button className="primary-button" onClick={openCreate}>Tạo Master timeline</button>}</div>}
              <Pagination total={visibleProjects.length} pageSize={projectPageSize} page={projectPage} onPageChange={setProjectPage} onPageSizeChange={(size) => { setProjectPageSize(size); setProjectPage(1); }} />
            </section>
          </>
        ) : view === "catalog" ? (
          <>
            <header className="topbar"><div className="breadcrumbs"><strong>Danh mục WBS chuẩn</strong><i>/</i><span>{fullCatalog.length} công việc</span></div><div className="top-actions"><button className="secondary-button" onClick={toggleAllCatalogTasks}>{enabledCatalogCount === fullCatalog.length ? "Bỏ tích tất cả" : "Tích tất cả"}</button><button className="primary-button" onClick={() => openTaskCreator(false)}>Thêm công việc</button><UserBadge /></div></header>
            <section className="catalog-header"><div><span className="status-badge">{enabledCatalogCount}/{fullCatalog.length} TỰ ĐỘNG SINH</span><h1>Thư viện WBS</h1><p>Công việc được tích “Tự động sinh” sẽ luôn có sẵn khi tạo dự án mới.</p></div><label className="search-field"><span>Tìm</span><input value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(1); }} placeholder="Mã WBS hoặc tên công việc" /></label></section>
            <section className="catalog-groups">{GROUPS.map((group) => <div key={group.code}><span>{group.short}</span><b>{group.code} {group.name}</b><small>{fullCatalog.filter((task) => task.groupCode === group.code).length} task</small></div>)}</section>
            <div className="table-filters">
              <label className="table-filters-select"><span>Nhóm WBS</span><select value={catalogGroupFilter} onChange={(event) => { setCatalogGroupFilter(event.target.value); setCatalogPage(1); }}><option value="all">Tất cả nhóm</option>{GROUPS.map((group) => <option key={group.code} value={group.code}>{group.code} · {group.short}</option>)}</select></label>
              <label className="table-filters-select"><span>Nguồn</span><select value={catalogSourceFilter} onChange={(event) => { setCatalogSourceFilter(event.target.value as "all" | "custom" | "standard"); setCatalogPage(1); }}><option value="all">Tất cả nguồn</option><option value="standard">Mẫu chuẩn</option><option value="custom">Tùy chỉnh</option></select></label>
              <span className="table-filters-count">{catalogRows.length} công việc</span>
            </div>
            <section className="catalog-table">
              <div className="catalog-table-head"><span>WBS / CÔNG VIỆC</span><span>ĐƠN VỊ</span><span>CẤP</span><span>THỜI LƯỢNG MẪU</span><span>NGUỒN</span><span>TỰ ĐỘNG SINH</span><span /></div>
              {pagedCatalogRows.map((task) => { const group = GROUP_BY_CODE[task.groupCode]; return <div className={`catalog-row ${enabledCatalogCodes.has(task.code) ? "auto-enabled" : ""}`} key={`${task.custom ? "custom" : "base"}-${task.code}`}><span className="catalog-task"><b>{task.code}</b><span>{task.name}</span></span><span className="catalog-unit"><b>{group?.short}</b><span>{group?.name}</span></span><span>Cấp {task.level}</span><span>{task.defaultDuration} ngày</span><span><i className={task.custom ? "source-custom" : "source-standard"}>{task.custom ? "Tùy chỉnh" : "Mẫu chuẩn"}</i></span><span><label className="auto-generate-check"><input type="checkbox" checked={enabledCatalogCodes.has(task.code)} onChange={() => toggleCatalogTask(task)} aria-label={`Tự động sinh ${task.code}`} /><i /><b>{enabledCatalogCodes.has(task.code) ? "Có" : "Không"}</b></label></span><span>{task.custom && <button className="icon-danger" onClick={() => removeCatalogTask(task.code)} aria-label={`Xóa ${task.code}`}>Xóa</button>}</span></div>})}
              {!catalogRows.length && <div className="no-results">Không tìm thấy công việc phù hợp.</div>}
            </section>
            <Pagination total={catalogRows.length} pageSize={catalogPageSize} page={catalogPage} onPageChange={setCatalogPage} onPageSizeChange={(size) => { setCatalogPageSize(size); setCatalogPage(1); }} pageSizeOptions={[20, 40, 80]} />
          </>
        ) : view === "departments" ? (
          <>
            <header className="topbar"><div className="breadcrumbs"><strong>Phòng ban xác nhận</strong>{activeProject && <><i>/</i><span>{activeProject.code}</span></>}</div><div className="top-actions">{activeProject && <label className="department-project-select"><span>Dự án</span><select value={activeProject.id} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value); if (project) { setActiveId(project.id); setDepartmentCode(project.selectedGroups[0] ?? GROUPS[0].code); } }}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}<UserBadge /></div></header>
            {activeProject ? <>
              <section className="department-header"><div><span className="status-badge">BƯỚC 2/4</span><h1>Xác nhận MTL theo phòng ban</h1><p>Mỗi đơn vị chỉ xem và xác nhận toàn bộ cây công việc thuộc đầu mục WBS của mình.</p></div><div className="department-progress"><b>{departmentApprovedCount}/{activeProject.selectedGroups.length}</b><span>ĐẦU MỤC ĐÃ XÁC NHẬN</span><i><em style={{ width: `${(departmentApprovedCount / Math.max(activeProject.selectedGroups.length, 1)) * 100}%` }} /></i></div></section>
              <section className="department-review-layout">
                <aside className="department-groups" aria-label="Đầu mục phòng ban">
                  <header><span>VAI TRÒ PHÒNG BAN · DEMO</span><b>{departmentPendingCount} đầu mục còn chờ</b></header><p className="department-demo-note">Bản triển khai thật sẽ tự nhận diện tài khoản và chỉ hiện đúng một đầu mục được phân quyền.</p>
                  <div className="department-group-section"><strong>KHỐI PHÒNG BAN · 9.x</strong>{GROUPS.filter((group) => group.code.startsWith("9.") && activeProject.selectedGroups.includes(group.code)).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} className={`${departmentCode === group.code ? "active" : ""} status-${approval?.status ?? "pending"}`} onClick={() => setDepartmentCode(group.code)}><i>{approval?.status === "approved" ? "✓" : approval?.status === "changes_requested" ? "!" : "·"}</i><span><b>{group.code} · {group.short}</b><small>{group.name}</small>{approval?.reviewer && <em>{approval.reviewer}</em>}</span></button>; })}</div>
                  <div className="department-group-section"><strong>QUẢN LÝ DỰ ÁN · 4.x</strong>{GROUPS.filter((group) => group.code.startsWith("4.") && activeProject.selectedGroups.includes(group.code)).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} className={`${departmentCode === group.code ? "active" : ""} status-${approval?.status ?? "pending"}`} onClick={() => setDepartmentCode(group.code)}><i>{approval?.status === "approved" ? "✓" : approval?.status === "changes_requested" ? "!" : "·"}</i><span><b>{group.code} · {group.short}</b><small>{group.name}</small>{approval?.reviewer && <em>{approval.reviewer}</em>}</span></button>; })}</div>
                </aside>
                <section className="department-review-main">
                  {departmentApproval ? <>
                    <header className="department-review-title"><div><span className={`department-status status-${departmentApproval.status}`}>{DEPARTMENT_APPROVAL_LABEL[departmentApproval.status]}</span><h2>{selectedDepartment.code} · {selectedDepartment.name}</h2><p>Xác nhận đầu mục cấp cao nhất sẽ áp dụng cho toàn bộ {departmentTasks.length} công việc bên dưới.</p></div><label className="field"><span>Người phụ trách xác nhận</span><input disabled={activeProject.approvalStatus === "submitted" || activeProject.approvalStatus === "approved"} value={departmentApproval.reviewer} onChange={(event) => updateDepartmentApproval(departmentCode, { reviewer: event.target.value, status: "pending", reviewedAt: undefined })} placeholder="Nhập họ tên người xác nhận" /></label></header>
                    <div className="department-task-table"><div className="department-task-head"><span>WBS / CÔNG VIỆC</span><span>PIC</span><span>BẮT ĐẦU</span><span>KẾT THÚC</span><span>TRẠNG THÁI</span></div><div className="department-task-body">{departmentTasks.map((task) => <div className={`department-task-row ${task.summary ? "summary" : ""}`} key={task.code}><span style={{ paddingLeft: `${12 + (task.level - 1) * 14}px` }}><b>{task.code}</b><small>{task.name}</small></span><span>{task.pic || "Chưa gán"}</span><span>{formatDate(task.startDate)}</span><span>{formatDate(task.endDate)}</span><span><i className={`task-status status-${taskStatusClass(task.status)}`}>{task.status}</i></span></div>)}</div></div>
                    <footer className="department-opinion"><label className="field"><span>Ý kiến xác nhận <i>Người lập MTL sẽ đọc được phản hồi này</i></span><textarea disabled={activeProject.approvalStatus === "submitted" || activeProject.approvalStatus === "approved"} value={departmentApproval.note} onChange={(event) => updateDepartmentApproval(departmentCode, { note: event.target.value, status: departmentApproval.status === "approved" ? "pending" : departmentApproval.status, reviewedAt: departmentApproval.status === "approved" ? undefined : departmentApproval.reviewedAt })} placeholder={`Nêu rõ nội dung cần điều chỉnh trong đầu mục ${departmentCode}…`} rows={3} /></label><div>{departmentApproval.reviewedAt && <span>Xác nhận gần nhất: {formatDateTime(departmentApproval.reviewedAt)}</span>}<button className="danger-button" disabled={activeProject.approvalStatus === "submitted" || activeProject.approvalStatus === "approved"} onClick={() => reviewDepartment("changes_requested")}>Yêu cầu điều chỉnh</button><button className="approve-button" disabled={activeProject.approvalStatus === "submitted" || activeProject.approvalStatus === "approved"} onClick={() => reviewDepartment("approved")}>Xác nhận toàn bộ {departmentCode}</button></div></footer>
                  </> : <div className="gms-select-prompt"><h2>Đầu mục không thuộc dự án</h2><p>Hãy chọn một phòng ban đang tham gia dự án này.</p></div>}
                </section>
              </section>
            </> : <div className="empty-state"><span className="empty-kicker">XÁC NHẬN PHÒNG BAN</span><h1>Chưa có dự án để xác nhận</h1><p>Tạo dự án MTL trước, sau đó phân công người xác nhận cho từng đầu mục phòng ban.</p><button className="primary-button" onClick={openCreate}>Tạo Master timeline</button></div>}
          </>
        ) : view === "gms" ? (
          <>
            <header className="topbar"><div className="breadcrumbs"><strong>Thẩm định</strong></div><div className="top-actions"><UserBadge /></div></header>
            <section className="gms-header"><div><h1>Danh mục dự án MTL cần thẩm định</h1><p>Tìm và chọn dự án để xem toàn bộ công việc, nhập ý kiến rồi gửi phản hồi cho người lập.</p></div><div className="gms-metrics"><div><b>{pendingGmsCount}</b><span>CHỜ THẨM ĐỊNH</span></div><div><b>{projects.filter((project) => project.approvalStatus === "approved").length}</b><span>ĐÃ XÁC NHẬN</span></div><div><b>{projects.filter((project) => project.approvalStatus === "changes_requested").length}</b><span>YÊU CẦU ĐIỀU CHỈNH</span></div></div></section>
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
                    <div className={`gms-opinion-box ${gmsSelectedProject.approvalStatus !== "submitted" ? "is-readonly" : ""}`}><label className="field"><span>Ý kiến thẩm định {gmsSelectedProject.approvalStatus === "submitted" && <i>Phản hồi này sẽ được gửi về người lập MTL</i>}</span><textarea disabled={gmsSelectedProject.approvalStatus !== "submitted"} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Nêu rõ công việc/WBS cần sửa, nội dung cần bổ sung hoặc điều kiện phê duyệt…" rows={4} /></label>{gmsSelectedProject.approvalStatus === "submitted" ? <div className="gms-review-actions"><button className="danger-button" onClick={() => reviewProject("changes_requested")}>Trả về để điều chỉnh</button><button className="approve-button" onClick={() => reviewProject("approved")}>Xác nhận</button></div> : <div className="gms-review-result"><b>Đã phản hồi cho người lập</b><span>{formatDateTime(gmsSelectedProject.reviewedAt)} · {gmsSelectedProject.reviewNote || "Không có ý kiến bổ sung."}</span></div>}</div>
                  </> : <div className="gms-select-prompt"><span>GMS</span><h2>Chọn một dự án để thẩm định</h2><p>Tìm dự án ở phía trên, sau đó chọn hồ sơ bên trái để xem danh sách công việc và nhập ý kiến phản hồi.</p></div>}
                </section>
              </div>
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
            <header className="topbar">
              <div className="breadcrumbs"><button className="breadcrumb-back" onClick={() => setView("projects")}>Danh mục dự án</button><i>/</i><strong>{activeProject.code}</strong></div>
              <div className="top-actions"><span className="saved-state"><i />Đã lưu trên thiết bị</span><button className="danger-button" onClick={() => setShowDelete(true)}>Xóa dự án</button><button className="secondary-button project-export" onClick={exportMicrosoftProject}>Xuất Microsoft Project <small>.xml → .mpp</small></button><button className="primary-button" onClick={openCreate}>Tạo Master timeline</button><UserBadge /></div>
            </header>

            <section className="project-header">
              <div><span className={`status-badge approval-${activeProject.approvalStatus}`}>{projectApprovalLabel(activeProject)}{activeProject.approvedVersion ? ` · ${activeProject.approvedVersion}` : ""}</span><h1>{activeProject.name}</h1><p>{activeProject.code} · {activeProject.type}{activeProject.location ? ` · ${activeProject.location}` : ""}</p></div>
              <div className="project-metrics"><div><b>{scheduled.length}</b><span>TASK ĐÃ SINH</span></div><div><b>{activeProject.selectedGroups.filter((code) => code.startsWith("9.")).length}/9</b><span>PHÒNG BAN</span></div><div><b>{activeProject.selectedGroups.filter((code) => code.startsWith("4.")).length}/5</b><span>NHÓM PHẦN 4</span></div><div><b>{formatDate(activeProject.targetDate)}</b><span>NGÀY MỤC TIÊU</span></div></div>
            </section>

            <section className={`approval-flow state-${activeProject.approvalStatus}`}>
              <div className="approval-steps"><span className="done"><i>1</i><b>Lập MTL</b></span><em /><span className={allDepartmentsApproved(activeProject) ? "done" : ""}><i>2</i><b>Phòng ban xác nhận</b></span><em /><span className={activeProject.approvalStatus === "submitted" || activeProject.approvalStatus === "approved" ? "done" : ""}><i>3</i><b>GMS thẩm định</b></span><em /><span className={activeProject.approvalStatus === "approved" ? "done" : ""}><i>4</i><b>Hoàn thành thẩm định</b></span></div>
              <div className="approval-action">
                {(activeProject.approvalStatus === "draft" || activeProject.approvalStatus === "changes_requested") && !allDepartmentsApproved(activeProject) && <><span>Còn {activeProject.selectedGroups.length - approvedDepartmentCount(activeProject)} đầu mục chưa xác nhận</span><button className="secondary-button" onClick={() => openDepartmentReview()}>Mở xác nhận phòng ban</button></>}
                {(activeProject.approvalStatus === "draft" || activeProject.approvalStatus === "changes_requested") && allDepartmentsApproved(activeProject) && <button className="primary-button" onClick={submitToGms}>Gửi GMS thẩm định</button>}
                {activeProject.approvalStatus === "submitted" && <span>Đã gửi {formatDate(activeProject.submittedAt)} · Đang chờ GMS xử lý</span>}
                {activeProject.approvalStatus === "approved" && <><span>Hoàn thành thẩm định {formatDate(activeProject.approvedAt)}</span><button className="secondary-button" onClick={reopenApproved}>Tạo bản điều chỉnh</button></>}
              </div>
            </section>
            <section className="department-status-strip" aria-label="Trạng thái xác nhận phòng ban">{GROUPS.filter((group) => activeProject.selectedGroups.includes(group.code)).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} className={`status-${approval?.status ?? "pending"}`} title={approval?.note || `${group.name} · ${DEPARTMENT_APPROVAL_LABEL[approval?.status ?? "pending"]}`} onClick={() => openDepartmentReview(group.code)}><i>{approval?.status === "approved" ? "✓" : approval?.status === "changes_requested" ? "!" : "·"}</i><span><b>{group.code}</b><small>{group.short}</small></span></button>; })}</section>
            {activeProject.selectedGroups.some((code) => activeProject.departmentApprovals[code]?.note) && <section className="department-feedback-list"><b>Ý kiến xác nhận phòng ban</b><div>{GROUPS.filter((group) => activeProject.departmentApprovals[group.code]?.note).map((group) => { const approval = activeProject.departmentApprovals[group.code]; return <button key={group.code} onClick={() => openDepartmentReview(group.code)}><span>{group.code} · {group.short}</span><p>{approval.note}</p><small>{approval.reviewer || "Chưa gán người xác nhận"} · {DEPARTMENT_APPROVAL_LABEL[approval.status]}</small></button>; })}</div></section>}
            {activeProject.reviewNote && <div className={`review-note ${activeProject.approvalStatus}`}><b>Phản hồi thẩm định từ GMS</b><span>{activeProject.reviewNote}</span><small>Gửi lúc {formatDateTime(activeProject.reviewedAt)} · Vui lòng cập nhật các nội dung được nêu trước khi gửi lại.</small></div>}

            <section className="toolbar" aria-label="Công cụ danh sách MTL">
              <div className="scope-tabs"><span className="active">Tất cả công việc</span></div>
              <label className="search-field"><span>Tìm</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mã WBS hoặc tên công việc" /></label>
              <button className="text-button" onClick={() => setCollapsed(new Set())}>Mở tất cả</button><button className="text-button" onClick={() => setCollapsed(new Set(activeProject.selectedGroups))}>Thu gọn</button>
            </section>

            <div className={`planning-area ${selectedTask ? "with-detail" : ""}`}>
              <section className="task-grid" aria-label="Cây công việc Master Timeline">
                <div className="grid-header"><span>CÔNG VIỆC / WBS</span><span>ĐƠN VỊ</span><span>BẮT ĐẦU</span><span>KẾT THÚC</span><span>THỜI LƯỢNG</span><span>TRẠNG THÁI</span></div>
                <div className="grid-body">
                  {visibleTasks.map((task) => {
                    const group = GROUP_BY_CODE[task.groupCode];
                    const isCollapsed = collapsed.has(task.code);
                    return (
                      <div key={task.code} role="button" tabIndex={0} className={`task-row level-${Math.min(task.level, 4)} ${selectedCode === task.code ? "selected" : ""} ${task.summary ? "summary" : ""}`} onClick={() => setSelectedCode(task.code)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedCode(task.code); }}>
                        <span className="task-cell task-title" title="Nhấp chuột phải để thêm, sửa hoặc xóa" onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ code: task.code, x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 180) }); }} style={{ "--indent": `${(task.level - 1) * 18}px` } as React.CSSProperties}>
                          {task.summary ? <i className="toggle" role="button" aria-label={isCollapsed ? "Mở nhóm" : "Thu gọn nhóm"} onClick={(event) => { event.stopPropagation(); setCollapsed((current) => { const next = new Set(current); if (next.has(task.code)) next.delete(task.code); else next.add(task.code); return next; }); }}>{isCollapsed ? "+" : "−"}</i> : <i className="task-dot" />}
                          <span className="task-inline"><b>{task.code}</b><small>{task.name}</small>{task.custom && <i className="custom-chip">Mới</i>}{task.predecessors.length > 0 && <i className={`dependency-chip ${task.dependencyConflict ? "conflict" : ""}`}>{task.predecessors.map((dependency) => `${dependency.type} · ${dependency.predecessorCode}${dependency.lagDays ? ` + ${dependency.lagDays}d` : ""}`).join(", ")}</i>}</span>
                        </span>
                        <span className="task-cell owner-cell"><b>{group?.short}</b><small>{group?.name}</small></span>
                        <span className="task-cell date-cell">{formatDate(task.startDate)}</span><span className="task-cell date-cell">{formatDate(task.endDate)}</span><span className="task-cell duration-cell">{task.duration} ngày</span><span className="task-cell task-status-cell"><i className={`task-status status-${taskStatusClass(task.status)}`}>{task.status}</i></span>
                      </div>
                    );
                  })}
                  {!visibleTasks.length && <div className="no-results">Không tìm thấy công việc phù hợp.</div>}
                </div>
                <footer className="grid-footer"><span>Hiển thị {visibleTasks.length}/{scheduled.length} task · {projectDependencyCount(activeProject)} liên kết</span><span>{activeProject.approvalStatus === "approved" ? `Bản ${activeProject.approvedVersion} đã được GMS phê duyệt và khóa chỉnh sửa.` : "Nhấp chuột phải tại cột Công việc/WBS để thêm con, chỉnh sửa hoặc xóa."}</span></footer>
              </section>

              {selectedTask && (
                <aside className="detail-panel">
                  <header><span>CHI TIẾT CÔNG VIỆC</span><button aria-label="Đóng chi tiết" onClick={() => setSelectedCode("")}>Đóng</button></header>
                  {activeProject.approvalStatus === "approved" && <div className="locked-banner">Bản Hoàn thành thẩm định — chỉ đọc</div>}
                  <div className="detail-code">{selectedTask.code}</div><h2>{selectedTask.name}</h2><div className="detail-meta"><span>{GROUP_BY_CODE[selectedTask.groupCode]?.short}</span><b>{selectedTask.summary ? "Summary task" : "Task thực hiện"}</b></div>
                  <label className="field"><span>PIC phụ trách</span><input disabled={activeProject.approvalStatus === "approved"} value={selectedTask.pic} onChange={(event) => updateTask(selectedTask.code, { pic: event.target.value })} placeholder="Nhập tên người phụ trách" /></label>
                  <label className="field"><span>Ngày bắt đầu</span><input disabled={activeProject.approvalStatus === "approved" || selectedTask.summary} type="date" value={selectedTask.startDate} max={selectedTask.endDate} onChange={(event) => updateTaskDates(selectedTask.code, event.target.value, selectedTask.endDate)} /></label>
                  <label className="field"><span>Ngày kết thúc</span><input disabled={activeProject.approvalStatus === "approved" || selectedTask.summary} type="date" value={selectedTask.endDate} min={selectedTask.startDate} onChange={(event) => updateTaskDates(selectedTask.code, selectedTask.startDate, event.target.value)} /></label>
                  <label className="field field-readonly"><span>Thời lượng tự tính</span><input readOnly value={`${selectedTask.duration} ngày làm việc`} /></label>
                  <label className="field"><span>Trạng thái</span><select disabled={activeProject.approvalStatus === "approved"} value={selectedTask.status} onChange={(event) => updateTask(selectedTask.code, { status: event.target.value as TaskEdit["status"] })}><option>Đang thực hiện</option><option>Đóng</option><option>Hoàn thành</option></select></label>
                  <DependencyPicker tasks={scheduled} selectedDependencies={selectedTask.predecessors} successorCode={selectedTask.code} disabled={activeProject.approvalStatus === "approved" || selectedTask.summary} onChange={(dependencies) => updateTaskDependencies(selectedTask.code, dependencies)} />
                  {selectedTask.dependencyConflict && <div className="dependency-warning" role="alert"><b>Xung đột liên kết FS</b><span>{selectedTask.dependencyConflict}</span>{selectedTask.suggestedStartDate && <button type="button" onClick={() => updateTaskDates(selectedTask.code, selectedTask.suggestedStartDate!, dateAtWorkingOffset(selectedTask.suggestedStartDate!, selectedTask.duration - 1))}>Áp dụng ngày {formatDate(selectedTask.suggestedStartDate)}</button>}</div>}
                  <div className="detail-summary"><div><span>Bắt đầu</span><b>{formatDate(selectedTask.startDate)}</b></div><div><span>Kết thúc</span><b>{formatDate(selectedTask.endDate)}</b></div></div>
                  <p className="detail-note">{selectedTask.summary ? "Ngày của task tổng hợp được tự động lấy theo các công việc con." : activeProject.approvalStatus === "approved" ? "Tạo bản điều chỉnh nếu cần cập nhật nội dung." : "Thay đổi được lưu tự động trên thiết bị cho dự án này."}</p>
                </aside>
              )}
            </div>
          </>
        )}
      </section>

      {contextMenu && contextTask && activeProject && <section className="task-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        <header><span>{contextTask.code}</span><b>{contextTask.name}</b></header>
        <button disabled={contextTask.level >= 4 || activeProject.approvalStatus === "approved"} onClick={() => { setContextMenu(null); openTaskCreator(true, contextTask, true); }}><i>+</i><span><b>Thêm công việc con</b><small>{contextTask.level >= 4 ? "Đã đạt WBS cấp 4" : `Tạo bên dưới ${contextTask.code}`}</small></span></button>
        <button onClick={() => { setSelectedCode(contextTask.code); setContextMenu(null); }}><i>…</i><span><b>Chỉnh sửa chi tiết</b><small>Mở bảng thông tin bên phải</small></span></button>
        <button className="context-danger" disabled={activeProject.approvalStatus === "approved"} onClick={() => { setContextMenu(null); removeTaskFromProject(contextTask); }}><i>×</i><span><b>Xóa khỏi dự án</b><small>{contextTask.summary ? "Bao gồm các công việc con" : "Không xóa khỏi danh mục mẫu"}</small></span></button>
      </section>}

      {showCreate && (
        <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}>
          <form className="project-modal create-project-modal" onSubmit={createProject} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>TẠO MASTER TIMELINE</span><h2>Thông tin dự án</h2></div><button type="button" onClick={() => setShowCreate(false)}>Đóng</button></header>
            <div className="form-grid">
              <label className="field"><span>Khu vực</span><select autoFocus value={form.area} onChange={(event) => setForm({ ...form, area: event.target.value })}><option>Khu vực 1</option><option>Khu vực 2</option><option>Khu vực 3</option><option>Khu vực 4</option><option>Khu vực 5</option></select></label>
              <label className="field"><span>Vùng</span><input value={form.region || ""} onChange={(event) => setForm({ ...form, region: event.target.value })} placeholder="Nhập vùng" /></label>
              <label className="field field-wide"><span>Tên dự án *</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ví dụ: Aqua Riverside" /></label>
              <label className="field"><span>Mã dự án *</span><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="AQR-01" /></label>
              <label className="field"><span>Nhóm dự án</span><select value={form.group} onChange={(event) => setForm({ ...form, group: event.target.value })}><option>Nhóm 1 (Đang nghiên cứu)</option><option>Nhóm 2 (Đã mua đang thiết kế)</option><option>Nhóm 3 (Đang xây dựng)</option><option>Nhóm 4 (Đã bàn giao khách hàng)</option><option>Nhóm 5 (Thoái vốn)</option></select></label>
              <label className="field field-wide"><span>Loại hình</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>Công trình cao tầng</option><option>Công trình thấp tầng</option><option>Stay</option><option>Play</option></select></label>
              <label className="field"><span>Ngày bắt đầu</span><input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
              <label className="field"><span>Ngày kết thúc dự án</span><input type="date" value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label>
              <label className="field field-wide"><span>Upload Master timeline (.xml)</span><input type="file" accept=".xml" onChange={handleXMLUpload} className="file-input-styled" />{xmlData && <small style={{ color: '#167766', display: 'block', marginTop: '4px' }}><b>✓ Tệp hợp lệ:</b> Tìm thấy {xmlData.customTasks.length} công việc.</small>}</label>
            </div>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <footer className="modal-actions-only"><button type="button" className="secondary-button" onClick={() => setShowCreate(false)}>Hủy</button><button className="primary-button" type="submit">Tạo Master Timeline</button></footer>
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

      {showDelete && activeProject && <div className="modal-backdrop" onMouseDown={() => setShowDelete(false)}><section className="confirm-modal" onMouseDown={(event) => event.stopPropagation()}><span className="danger-symbol">!</span><h2>Xóa dự án {activeProject.code}?</h2><p>Toàn bộ chỉnh sửa và trạng thái thẩm định của dự án này trên thiết bị sẽ bị xóa.</p><div><button type="button" className="secondary-button" onClick={() => setShowDelete(false)}>Giữ dự án</button><button type="button" className="danger-solid" onClick={deleteProject}>Xóa dự án</button></div></section></div>}

      {projectToDelete && <div className="modal-backdrop" onMouseDown={() => setProjectToDelete(null)}><section className="confirm-modal" onMouseDown={(event) => event.stopPropagation()}><span className="danger-symbol">!</span><h2>Xóa dự án {projectToDelete.code}?</h2><p>Dự án <strong>{projectToDelete.name}</strong> và toàn bộ tiến độ liên quan sẽ bị xóa vĩnh viễn.</p><div><button type="button" className="secondary-button" onClick={() => setProjectToDelete(null)}>Hủy</button><button type="button" className="danger-solid" onClick={() => deleteProjectById(projectToDelete.id)}>Xóa dự án</button></div></section></div>}

      {toast && <div className="toast" role="status"><b>Hoàn tất</b><span>{toast}</span></div>}
    </main>
  );
}
