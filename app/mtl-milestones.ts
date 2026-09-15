import type { ParameterDependency, ParameterTask, ParameterTaskEdit } from "./mtl-parameter-engine";

export type MilestoneDefinition = {
  code: string;
  name: string;
  group: "Pháp lý" | "Thi công" | "Kinh doanh & Bàn giao";
  groupCode: string;
  mappedCode: string | null;
  preparationCodes: string[];
};

/* mappedCode là WBS thực tế của thư viện tháng 9/2026, không phải mã trong bảng đề xuất. */
export const KEY_MILESTONES: MilestoneDefinition[] = [
  { code: "MILE_PLP_01", name: "Phê duyệt Quy hoạch 1/500", group: "Pháp lý", groupCode: "4.1", mappedCode: "4.1.4.9", preparationCodes: ["4.1.4.8", "4.2.1.3"] },
  { code: "MILE_PLP_02", name: "Hoàn thành Nghĩa vụ Tài chính Đất đai", group: "Pháp lý", groupCode: "4.1", mappedCode: "4.1.3.18", preparationCodes: ["4.1.3.17"] },
  { code: "MILE_PLP_03", name: "Thẩm duyệt Thiết kế PCCC", group: "Pháp lý", groupCode: "4.1", mappedCode: "4.1.5.10", preparationCodes: ["4.2.3.1.4", "4.2.5.1.4"] },
  { code: "MILE_PLP_04", name: "Thẩm định Thiết kế Kỹ thuật / Cơ sở", group: "Pháp lý", groupCode: "4.1", mappedCode: "4.1.5.11", preparationCodes: ["4.1.5.7", "4.1.5.8", "4.2.3.1.3"] },
  { code: "MILE_PLP_05", name: "Cấp Giấy phép Xây dựng công trình", group: "Pháp lý", groupCode: "4.1", mappedCode: "4.1.5.13", preparationCodes: ["4.1.5.10", "4.1.5.11"] },
  { code: "MILE_PLP_06", name: "Chấp thuận Nghiệm thu PCCC và Hoàn thành công trình", group: "Pháp lý", groupCode: "4.1", mappedCode: "4.1.5.22", preparationCodes: ["4.1.5.19", "4.3.12.1.1", "4.3.12.1.3"] },
  { code: "MILE_PCD_01", name: "Khởi công Xây dựng công trình", group: "Thi công", groupCode: "4.3", mappedCode: null, preparationCodes: ["4.3.1.1.7", "4.3.1.1.8"] },
  { code: "MILE_PCD_02", name: "Hoàn thành Cọc & Tường vây", group: "Thi công", groupCode: "4.3", mappedCode: "4.3.6.1.2", preparationCodes: ["4.3.6.1.1"] },
  { code: "MILE_PCD_03", name: "Hoàn thành Phần Ngầm / Cốt ±0.00", group: "Thi công", groupCode: "4.3", mappedCode: "4.3.8.1.1", preparationCodes: ["4.3.6.1.2"] },
  { code: "MILE_PCD_04", name: "Cất nóc Công trình", group: "Thi công", groupCode: "4.3", mappedCode: "4.3.8.1.2", preparationCodes: ["4.3.8.1.1"] },
  { code: "MILE_PCD_05", name: "Đấu nối Điện, Nước & Hạ tầng ngoài", group: "Thi công", groupCode: "4.3", mappedCode: "4.3.4.1.4", preparationCodes: ["4.3.4.1.3", "4.1.5.18"] },
  { code: "MILE_PCD_06", name: "Hoàn thành Commissioning hệ thống", group: "Thi công", groupCode: "4.3", mappedCode: null, preparationCodes: ["4.3.8.1.3", "4.3.4.1.4"] },
  { code: "MILE_COM_01", name: "Khai trương Nhà mẫu & Sales Gallery", group: "Kinh doanh & Bàn giao", groupCode: "9.3", mappedCode: null, preparationCodes: ["9.3.NM_INIT.3"] },
  { code: "MILE_COM_02", name: "Đủ điều kiện bán nhà ở hình thành trong tương lai", group: "Kinh doanh & Bàn giao", groupCode: "4.1", mappedCode: "4.1.6.3", preparationCodes: ["4.1.5.17", "9.3.7.1.2"] },
  { code: "MILE_OM_01", name: "Tiếp nhận Bàn giao nội bộ cho OM", group: "Kinh doanh & Bàn giao", groupCode: "4.4", mappedCode: "4.4.1.2.3", preparationCodes: ["4.3.12.1.4"] },
  { code: "MILE_OM_02", name: "Bắt đầu Bàn giao căn hộ cho khách hàng", group: "Kinh doanh & Bàn giao", groupCode: "4.4", mappedCode: "4.4.1.3", preparationCodes: ["4.4.1.2.3", "4.1.5.22"] },
  { code: "MILE_OM_03", name: "Hoàn tất Bàn giao Sổ hồng cho cư dân", group: "Kinh doanh & Bàn giao", groupCode: "4.1", mappedCode: "4.1.6.6", preparationCodes: ["4.4.1.3"] },
];

export type MilestoneDates = Record<string, string>;
export type InitialMilestoneSchedule = {
  taskEdits: Record<string, ParameterTaskEdit & { startDate?: string; endDate?: string }>;
  markerTasks: ParameterTask[];
  supplementalTasks: ParameterTask[];
  supplementalDependencies: ParameterDependency[];
  scheduledTaskCount: number;
  warnings: string[];
  earliestDate: string | null;
  latestDate: string | null;
};

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
const shiftCalendar = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const shiftWorking = (date: string, days: number) => {
  let result = date;
  let remaining = Math.abs(days);
  const direction = days < 0 ? -1 : 1;
  while (remaining > 0) {
    result = shiftCalendar(result, direction);
    const weekday = new Date(`${result}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
};
const durationOf = (task: ParameterTask, edits: Record<string, ParameterTaskEdit>) => Math.max(1, Number(edits[task.code]?.duration ?? task.defaultDuration) || 1);

/** Khởi tạo lịch gợi ý một lần. Không đụng các chỉnh sửa ngày sau khi dự án đã tạo. */
export function decomposeMilestoneDates(
  tasks: ParameterTask[],
  dependencies: ParameterDependency[],
  durationEdits: Record<string, ParameterTaskEdit>,
  milestoneDates: MilestoneDates,
): InitialMilestoneSchedule {
  const byCode = new Map(tasks.map((task) => [task.code, task]));
  const edits: InitialMilestoneSchedule["taskEdits"] = {};
  const fixedCodes = new Set<string>();
  const warnings: string[] = [];
  const markerTasks: ParameterTask[] = [];
  const supplementalTasks: ParameterTask[] = [];
  const supplementalDependencies: ParameterDependency[] = [];
  let markerId = Math.max(0, ...tasks.map((task) => task.id)) + 1;

  const addSupplemental = (task: Omit<ParameterTask, "id" | "custom">) => {
    if (byCode.has(task.code)) return;
    const generated = { ...task, id: markerId++, custom: true };
    byCode.set(task.code, generated);
    supplementalTasks.push(generated);
  };

  if (validDate(milestoneDates.MILE_COM_01 ?? "") && byCode.has("9.3")) {
    addSupplemental({ code: "9.3.NM_INIT", parentCode: "9.3", groupCode: "9.3", name: "Chuẩn bị Nhà mẫu & Sales Gallery", level: 2, summary: true, defaultDuration: 1 });
    [
      ["Thiết kế Nhà mẫu & Sales Gallery", 20],
      ["Lựa chọn nhà thầu và đặt hàng", 30],
      ["Thi công, hoàn thiện và nghiệm thu Nhà mẫu", 45],
    ].forEach(([name, duration], index) => {
      addSupplemental({ code: `9.3.NM_INIT.${index + 1}`, parentCode: "9.3.NM_INIT", groupCode: "9.3", name: String(name), level: 3, summary: false, defaultDuration: Number(duration) });
      if (index) supplementalDependencies.push({ successorCode: `9.3.NM_INIT.${index + 1}`, predecessorCode: `9.3.NM_INIT.${index}`, type: "FS", lagDays: 0 });
    });
  }
  if (validDate(milestoneDates.MILE_PCD_06 ?? "") && byCode.has("4.3")) {
    addSupplemental({ code: "4.3.COMM_INIT", parentCode: "4.3", groupCode: "4.3", name: "Chạy thử liên động PCCC, MEP, thang máy và hút khói", level: 2, summary: false, defaultDuration: 20 });
    ["4.3.8.1.3", "4.3.4.1.4"].filter((code) => byCode.has(code)).forEach((code) => supplementalDependencies.push({ successorCode: "4.3.COMM_INIT", predecessorCode: code, type: "FS", lagDays: 0 }));
  }

  const putFinish = (code: string, finishDate: string, fixed = false) => {
    const task = byCode.get(code);
    if (!task || task.summary) return false;
    const current = edits[code];
    if (fixedCodes.has(code) && current?.endDate !== finishDate) return false;
    if (!fixed && current?.endDate && current.endDate <= finishDate) return false;
    const duration = durationOf(task, durationEdits);
    edits[code] = { ...durationEdits[code], startDate: shiftWorking(finishDate, -(duration - 1)), endDate: finishDate };
    if (fixed) fixedCodes.add(code);
    return true;
  };

  KEY_MILESTONES.forEach((milestone) => {
    const date = milestoneDates[milestone.code];
    if (!date) return;
    if (!validDate(date)) {
      warnings.push(`${milestone.code}: ngày không hợp lệ.`);
      return;
    }
    const markerCode = `${milestone.groupCode}.${milestone.code}`;
    if (byCode.has(milestone.groupCode) && !byCode.has(markerCode)) {
      markerTasks.push({ id: markerId++, code: markerCode, parentCode: milestone.groupCode, groupCode: milestone.groupCode, name: `MỐC CHỐT · ${milestone.name}`, level: 2, summary: false, defaultDuration: 0, custom: true });
      edits[markerCode] = { startDate: date, endDate: date, duration: 0 };
    }
    if (milestone.mappedCode && byCode.has(milestone.mappedCode)) {
      const existing = edits[milestone.mappedCode]?.endDate;
      if (existing && existing !== date) warnings.push(`${milestone.code}: WBS ${milestone.mappedCode} có hai ngày neo khác nhau.`);
      else putFinish(milestone.mappedCode, date, true);
    } else if (milestone.mappedCode) {
      warnings.push(`${milestone.code}: WBS ${milestone.mappedCode} không được bật trong cây task; chỉ lưu mốc ngày.`);
    }
  });

  /* Các task chuẩn bị có thể chạy song song; từng task phải xong trước task/mốc chốt. */
  KEY_MILESTONES.forEach((milestone) => {
    const date = milestoneDates[milestone.code];
    if (!validDate(date ?? "")) return;
    const anchorStart = milestone.mappedCode ? edits[milestone.mappedCode]?.startDate : date;
    if (!anchorStart) return;
    const latestFinish = shiftWorking(anchorStart, -1);
    const preparationCodes = milestone.code === "MILE_PCD_06" && byCode.has("4.3.COMM_INIT") ? ["4.3.COMM_INIT"] : milestone.preparationCodes;
    preparationCodes.forEach((code) => putFinish(code, latestFinish));
  });

  /* Backward pass trên các FS/FF/SS đã được định nghĩa trong thư viện. */
  const allDependencies = [...dependencies, ...supplementalDependencies];
  for (let pass = 0; pass < byCode.size; pass += 1) {
    let changed = false;
    allDependencies.forEach((link) => {
      const successor = edits[link.successorCode];
      const predecessor = byCode.get(link.predecessorCode);
      if (!successor || !predecessor || predecessor.summary) return;
      let latestFinish: string | undefined;
      if (link.type === "FS" && successor.startDate) latestFinish = shiftWorking(successor.startDate, -(1 + link.lagDays));
      if (link.type === "FF" && successor.endDate) latestFinish = shiftWorking(successor.endDate, -link.lagDays);
      if ((link.type === "SS" || link.type === "SF") && (link.type === "SS" ? successor.startDate : successor.endDate)) {
        const latestStart = shiftWorking((link.type === "SS" ? successor.startDate : successor.endDate)!, -link.lagDays);
        latestFinish = shiftWorking(latestStart, durationOf(predecessor, durationEdits) - 1);
      }
      if (latestFinish) changed = putFinish(link.predecessorCode, latestFinish) || changed;
    });
    if (!changed) break;
  }

  /* Forward pass cho task chưa neo, để chuỗi sau mốc có lịch ban đầu. */
  for (let pass = 0; pass < byCode.size; pass += 1) {
    let changed = false;
    allDependencies.forEach((link) => {
      const predecessor = edits[link.predecessorCode];
      const task = byCode.get(link.successorCode);
      if (!predecessor || !task || task.summary) return;
      let requiredStart: string | undefined;
      if (link.type === "FS" && predecessor.endDate) requiredStart = shiftWorking(predecessor.endDate, 1 + link.lagDays);
      if (link.type === "SS" && predecessor.startDate) requiredStart = shiftWorking(predecessor.startDate, link.lagDays);
      if (link.type === "FF" && predecessor.endDate) requiredStart = shiftWorking(predecessor.endDate, link.lagDays - (durationOf(task, durationEdits) - 1));
      if (link.type === "SF" && predecessor.startDate) requiredStart = shiftWorking(predecessor.startDate, link.lagDays - (durationOf(task, durationEdits) - 1));
      if (!requiredStart) return;
      const current = edits[task.code];
      if (current?.startDate && current.startDate >= requiredStart) return;
      if (fixedCodes.has(task.code)) {
        warnings.push(`${task.code}: ngày chốt sớm hơn thời lượng/quan hệ ${link.type} từ ${link.predecessorCode}.`);
        return;
      }
      edits[task.code] = { ...durationEdits[task.code], startDate: requiredStart, endDate: shiftWorking(requiredStart, durationOf(task, durationEdits) - 1) };
      changed = true;
    });
    if (!changed) break;
  }

  /* Kiểm tra mốc liên khối thường không có dependency trong thư viện gốc. */
  const mustNotPrecede: [string, string, number][] = [
    ["MILE_PLP_01", "MILE_PLP_04", 0], ["MILE_PLP_03", "MILE_PLP_05", 0],
    ["MILE_PLP_04", "MILE_PLP_05", 0], ["MILE_PLP_05", "MILE_PCD_01", 5],
    ["MILE_PCD_01", "MILE_PCD_02", 0], ["MILE_PCD_02", "MILE_PCD_03", 0],
    ["MILE_PCD_03", "MILE_PCD_04", 1], ["MILE_PCD_03", "MILE_COM_02", 0],
    ["MILE_PCD_05", "MILE_PCD_06", 0], ["MILE_PCD_06", "MILE_PLP_06", 0],
    ["MILE_COM_01", "MILE_COM_02", 0], ["MILE_PLP_06", "MILE_OM_02", 0],
    ["MILE_OM_01", "MILE_OM_02", 0], ["MILE_PLP_02", "MILE_OM_03", 0],
    ["MILE_OM_02", "MILE_OM_03", 0],
  ];
  mustNotPrecede.forEach(([beforeCode, afterCode, calendarLag]) => {
    const before = milestoneDates[beforeCode];
    const after = milestoneDates[afterCode];
    if (validDate(before ?? "") && validDate(after ?? "") && after < shiftCalendar(before, calendarLag)) {
      warnings.push(`${afterCode} phải sau ${beforeCode}${calendarLag ? ` ít nhất ${calendarLag} ngày lịch` : ""}.`);
    }
  });
  if (validDate(milestoneDates.MILE_OM_01 ?? "") && validDate(milestoneDates.MILE_OM_02 ?? "")) {
    const handoverLead = Math.round((Date.parse(`${milestoneDates.MILE_OM_02}T00:00:00Z`) - Date.parse(`${milestoneDates.MILE_OM_01}T00:00:00Z`)) / 86400000);
    if (handoverLead < 30 || handoverLead > 45) warnings.push("MILE_OM_01 nên trước MILE_OM_02 khoảng 30–45 ngày lịch để OM kiểm tra hồ sơ và căn hộ.");
  }

  const dates = Object.values(milestoneDates).filter(validDate).sort();
  return { taskEdits: edits, markerTasks, supplementalTasks, supplementalDependencies, scheduledTaskCount: Object.keys(edits).length - markerTasks.length, warnings: [...new Set(warnings)], earliestDate: dates[0] ?? null, latestDate: dates.at(-1) ?? null };
}
