// Xuất dữ liệu: MS Project (MSPDI XML) và Excel theo form MTL của Tập đoàn (Cover + Chi tiết MTL).
import * as XLSX from "xlsx";
import type { DurationConfig, MtlVersion, Project, TaskNode, TaskTracking } from "@/lib/types";
import { MTL_STATUS_LABEL, PROJECT_TYPE_LABEL, TASK_STATUS_LABEL } from "@/lib/types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dmy = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** Số thứ tự cây (OutlineNumber) theo thứ tự hiển thị */
function outlineNumbers(tasks: TaskNode[]): Map<string, string> {
  const cnt = new Map<string, number>();
  const out = new Map<string, string>();
  for (const t of tasks) {
    const pk = t.parentId ?? "__root__";
    const n = (cnt.get(pk) ?? 0) + 1;
    cnt.set(pk, n);
    const parent = t.parentId ? out.get(t.parentId) : undefined;
    out.set(t.id, parent ? `${parent}.${n}` : String(n));
  }
  return out;
}

export function toMspdi(project: Project, version: MtlVersion, cfg: DurationConfig, tracking: TaskTracking[]): string {
  const A = project.params.anchors;
  const tasks = version.tasks;
  const uid = new Map(tasks.map((t, i) => [t.id, i + 1]));
  const outline = outlineNumbers(tasks);
  const trk = new Map(tracking.map((x) => [x.taskId, x.percent]));
  const DAYMIN = 480; // 8 giờ / ngày
  const dur = (d: number) => `PT${d * 8}H0M0S`;
  const dt = (iso: string, end = false) => `${iso}T${end ? "17:00:00" : "08:00:00"}`;
  const workDays = cfg.workWeek === 6 ? [2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6];
  const weekDays = [1, 2, 3, 4, 5, 6, 7].map((d) => {
    const w = workDays.includes(d);
    return `<WeekDay><DayType>${d}</DayType><DayWorking>${w ? 1 : 0}</DayWorking>${w ? `<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>` : ""}</WeekDay>`;
  }).join("");
  const exceptions = cfg.holidays.length
    ? `<Exceptions>${cfg.holidays.map((h, i) => `<Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${h}T00:00:00</FromDate><ToDate>${h}T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences><Name>Nghỉ lễ ${i + 1}</Name><Type>1</Type><DayWorking>0</DayWorking></Exception>`).join("")}</Exceptions>`
    : "";
  const finish = tasks.reduce((m, t) => (t.finish && t.finish > m ? t.finish : m), A.t0);
  const rows = tasks.map((t) => {
    const isSummary = t.kind === "summary";
    const isMs = t.kind === "milestone";
    const links = t.deps
      .filter((d) => uid.has(d.predId))
      .map((d) => `<PredecessorLink><PredecessorUID>${uid.get(d.predId)}</PredecessorUID><Type>${{ FF: 0, FS: 1, SF: 2, SS: 3 }[d.rel]}</Type><CrossProject>0</CrossProject><LinkLag>${d.lag * DAYMIN * 10}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`)
      .join("");
    const pct = isSummary ? 0 : Math.round(trk.get(`${version.id}:${t.id}`) ?? (t.status === "done" ? 100 : 0));
    return `<Task><UID>${uid.get(t.id)}</UID><ID>${uid.get(t.id)}</ID><Name>${esc(t.name)}</Name><Type>0</Type><IsNull>0</IsNull><WBS>${esc(t.wbs)}</WBS><OutlineNumber>${outline.get(t.id)}</OutlineNumber><OutlineLevel>${outline.get(t.id)!.split(".").length}</OutlineLevel><Priority>500</Priority><Start>${dt(t.start ?? A.t0)}</Start><Finish>${dt(t.finish ?? A.t0, true)}</Finish><Duration>${dur(isMs ? 0 : Math.max(1, t.durationDays))}</Duration><DurationFormat>7</DurationFormat><Milestone>${isMs ? 1 : 0}</Milestone><Summary>${isSummary ? 1 : 0}</Summary><PercentComplete>${pct}</PercentComplete><CalendarUID>-1</CalendarUID>${t.assigneeTitle ? `<Notes>${esc(`Chức danh: ${t.assigneeTitle}${t.ban ? ` | Ban: ${t.ban}` : ""}`)}</Notes>` : ""}${isSummary ? "" : links}</Task>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project"><SaveVersion>14</SaveVersion><Name>${esc(`${A.code} - ${A.name} - ${version.label}`)}</Name><Title>${esc(A.name)}</Title><CreationDate>${new Date().toISOString().slice(0, 19)}</CreationDate><ScheduleFromStart>1</ScheduleFromStart><StartDate>${dt(A.t0)}</StartDate><FinishDate>${dt(finish, true)}</FinishDate><DefaultStartTime>08:00:00</DefaultStartTime><DefaultFinishTime>17:00:00</DefaultFinishTime><MinutesPerDay>${DAYMIN}</MinutesPerDay><MinutesPerWeek>${DAYMIN * cfg.workWeek}</MinutesPerWeek><DaysPerMonth>26</DaysPerMonth><CalendarUID>1</CalendarUID><DurationFormat>7</DurationFormat><Calendars><Calendar><UID>1</UID><Name>MTL ${cfg.workWeek} ngày/tuần</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>${weekDays}</WeekDays>${exceptions}</Calendar></Calendars><Tasks>${rows}</Tasks></Project>`;
}

export function toWorkbook(project: Project, version: MtlVersion, tracking: TaskTracking[]): Buffer {
  const A = project.params.anchors;
  const trk = new Map(tracking.map((x) => [x.taskId, x.percent]));
  const outline = outlineNumbers(version.tasks);
  const cover: (string | number)[][] = [
    ["CÔNG TY CỔ PHẦN TẬP ĐOÀN ĐẦU TƯ ĐỊA ỐC NOVALAND (DEMO)"],
    ["TIẾN ĐỘ TỔNG THỂ DỰ ÁN (MTL)"],
    [],
    ["DỰ ÁN", A.name],
    ["Mã dự án", A.code],
    ["Chủ đầu tư / Pháp nhân", A.investor],
    ["Loại hình", PROJECT_TYPE_LABEL[A.type]],
    ["Vùng", A.region],
    ["Phiên bản", version.label],
    ["Trạng thái", MTL_STATUS_LABEL[version.status]],
    ["Ngày lập", dmy(version.createdAt.slice(0, 10))],
    [],
    ["1. THÔNG TIN TỔNG QUÁT"],
    ["Ngày bắt đầu dự án (T0)", dmy(A.t0)],
    ["Ngày mục tiêu Khởi công", dmy(A.startConstruction)],
    ["Ngày mục tiêu Mở bán", dmy(A.openSale)],
    ["Ngày mục tiêu Bàn giao", dmy(A.handover)],
    ["Ngày kết thúc hoàn toàn", dmy(A.closeOut)],
    [],
    ["2. CÁC MỐC DỰ ÁN CHÍNH"],
    ["WBS", "Mốc", "Ngày"],
    ...version.tasks.filter((t) => t.kind === "milestone").map((t) => [t.wbs, t.name, dmy(t.start)]),
    [],
    ["Đề xuất", "Xem xét", "Xem xét", "Phê duyệt"],
    ["HEAD PHÒNG", "GĐ ĐIỀU HÀNH KHU VỰC", "PHÓ TỔNG GIÁM ĐỐC", "TỔNG GIÁM ĐỐC"],
  ];
  const detail: (string | number)[][] = [
    ["3. TIẾN ĐỘ CHI TIẾT"],
    ["WBS", "Hạng mục công việc", "Số ngày", "Ngày bắt đầu", "Ngày hoàn thành", "Trạng thái công việc", "Chức danh chịu trách nhiệm", "% hoàn thành", "Ghi chú"],
  ];
  for (const t of version.tasks) {
    const o = outline.get(t.id)!;
    const indent = "    ".repeat(o.split(".").length - 1);
    detail.push([
      t.wbs, `${indent}${t.name}`, t.kind === "summary" ? "" : t.durationDays, dmy(t.start), dmy(t.finish),
      TASK_STATUS_LABEL[t.status], t.assigneeTitle ?? "", t.kind === "task" ? trk.get(`${version.id}:${t.id}`) ?? (t.status === "done" ? 100 : 0) : "",
      [t.conflict, t.durationNote].filter(Boolean).join(" | "),
    ]);
  }
  const wb = XLSX.utils.book_new();
  const wsCover = XLSX.utils.aoa_to_sheet(cover);
  wsCover["!cols"] = [{ wch: 34 }, { wch: 60 }, { wch: 22 }, { wch: 22 }];
  const wsDetail = XLSX.utils.aoa_to_sheet(detail);
  wsDetail["!cols"] = [{ wch: 16 }, { wch: 70 }, { wch: 9 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsCover, "Cover");
  XLSX.utils.book_append_sheet(wb, wsDetail, "Chi tiết MTL");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
