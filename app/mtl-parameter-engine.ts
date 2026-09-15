export type ProjectParameters = {
  loaiHinhDuAn: "Chung cư cao tầng" | "Thấp tầng/Biệt thự" | "Khu đô thị phức hợp" | "Khách sạn/Nghỉ dưỡng";
  dienTichDat: number;
  donViDienTichDat: "m²" | "ha";
  gfa: number;
  soPhanKy: number;
  soThapBlock: number;
  soTangHam: 0 | 1 | 2 | 3;
  bienPhapDao: "Open-cut" | "Top-down";
  soTangNoi: number;
  hienTrangDat: "Đất sạch 100%" | "Đang đền bù GPMB" | "Đất nhận chuyển nhượng (M&A)";
  mocPhapLyDau: "Chưa có 1/500" | "Đã duyệt 1/500" | "Đã duyệt TKCS" | "Đã có GPXD";
  nghiaVuTaiChinh: "Đã hoàn thành tiền SDĐ" | "Đang thẩm định giá đất" | "Đất thuê hàng năm";
  moHinhThau: "Tổng thầu Design & Build" | "Tổng thầu Thi công" | "Chia nhiều gói riêng lẻ";
  nhaMauSales: "Nhà mẫu tại công trường" | "Nhà mẫu bên ngoài" | "Căn hộ mẫu tầng thực tế" | "Không làm";
};

export type ParameterTask = {
  id: number;
  code: string;
  parentCode: string | null;
  groupCode: string;
  name: string;
  level: number;
  summary: boolean;
  defaultDuration: number;
  gmdReport?: string;
  workGroup?: "" | "Báo cáo định kỳ" | "Tracking công việc";
  notes?: string;
  custom?: boolean;
};

export type ParameterDependency = {
  successorCode: string;
  predecessorCode: string;
  type: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
};

export type ParameterTaskEdit = {
  duration?: number;
  status?: "Đang thực hiện" | "Đóng" | "Hoàn thành" | "Trễ hạn";
  actualProgress?: number;
  actualNote?: string;
};

export type ParameterImpact = {
  parameter: string;
  title: string;
  detail: string;
  affectedTasks: number;
};

export type ParameterGenerationResult = {
  tasks: ParameterTask[];
  dependencies: ParameterDependency[];
  taskEdits: Record<string, ParameterTaskEdit>;
  impacts: ParameterImpact[];
  generatedTaskCount: number;
  removedTaskCount: number;
  completedTaskCount: number;
  recalculatedTaskCount: number;
};

export const DEFAULT_PROJECT_PARAMETERS: ProjectParameters = {
  loaiHinhDuAn: "Khu đô thị phức hợp",
  dienTichDat: 10,
  donViDienTichDat: "ha",
  gfa: 100000,
  soPhanKy: 1,
  soThapBlock: 1,
  soTangHam: 1,
  bienPhapDao: "Open-cut",
  soTangNoi: 30,
  hienTrangDat: "Đang đền bù GPMB",
  mocPhapLyDau: "Chưa có 1/500",
  nghiaVuTaiChinh: "Đang thẩm định giá đất",
  moHinhThau: "Tổng thầu Thi công",
  nhaMauSales: "Nhà mẫu tại công trường",
};

const clampInteger = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(value) || min)));
const isInBranch = (code: string, branch: string) => code === branch || code.startsWith(`${branch}.`);

function nextId(tasks: ParameterTask[]) {
  return Math.max(0, ...tasks.map((task) => Number(task.id) || 0)) + 1;
}

export function generateParameterizedMTL(
  sourceTasks: ParameterTask[],
  sourceDependencies: ParameterDependency[],
  rawParameters: ProjectParameters,
): ParameterGenerationResult {
  const parameters: ProjectParameters = {
    ...rawParameters,
    dienTichDat: Math.max(1, Number(rawParameters.dienTichDat) || 1),
    gfa: Math.max(1, Number(rawParameters.gfa) || 1),
    soPhanKy: clampInteger(rawParameters.soPhanKy, 1, 20),
    soThapBlock: clampInteger(rawParameters.soThapBlock, 1, 26),
    soTangHam: clampInteger(rawParameters.soTangHam, 0, 3) as 0 | 1 | 2 | 3,
    soTangNoi: clampInteger(rawParameters.soTangNoi, 1, 120),
  };
  let tasks = sourceTasks.map((task) => ({ ...task }));
  let dependencies = sourceDependencies.map((dependency) => ({ ...dependency }));
  const sourceCount = tasks.length;
  const taskEdits: Record<string, ParameterTaskEdit> = {};
  const impacts: ParameterImpact[] = [];
  let generatedTaskCount = 0;

  const removeBranches = (branches: string[]) => {
    const before = tasks.length;
    tasks = tasks.filter((task) => !branches.some((branch) => isInBranch(task.code, branch)));
    return before - tasks.length;
  };

  const addTask = (task: Omit<ParameterTask, "id" | "custom">) => {
    if (tasks.some((item) => item.code === task.code)) return;
    tasks.push({ ...task, id: nextId(tasks), custom: true });
    generatedTaskCount += 1;
  };

  const cloneBranch = (branch: string, newRootCode: string, label: string) => {
    const source = tasks.filter((task) => isInBranch(task.code, branch));
    if (!source.length || tasks.some((task) => task.code === newRootCode)) return new Map<string, string>();
    const mapping = new Map<string, string>();
    source.forEach((task) => mapping.set(task.code, `${newRootCode}${task.code.slice(branch.length)}`));
    source.forEach((task) => addTask({
      ...task,
      code: mapping.get(task.code)!,
      parentCode: task.code === branch ? task.parentCode : mapping.get(task.parentCode ?? "") ?? task.parentCode,
      name: `${task.name} - ${label}`,
    }));
    const clonedDependencies = dependencies
      .filter((dependency) => mapping.has(dependency.successorCode) && mapping.has(dependency.predecessorCode))
      .map((dependency) => ({ ...dependency, successorCode: mapping.get(dependency.successorCode)!, predecessorCode: mapping.get(dependency.predecessorCode)! }));
    dependencies.push(...clonedDependencies);
    return mapping;
  };

  let removedByType = 0;
  if (parameters.loaiHinhDuAn === "Chung cư cao tầng") removedByType = removeBranches(["4.3.7"]);
  if (parameters.loaiHinhDuAn === "Thấp tầng/Biệt thự") removedByType = removeBranches(["4.3.8"]);
  if (parameters.loaiHinhDuAn === "Khách sạn/Nghỉ dưỡng") removedByType = removeBranches(["4.3.7"]);
  impacts.push({ parameter: "PARAM_LOAI_HINH_DA", title: parameters.loaiHinhDuAn, detail: removedByType ? `Loại ${removedByType} task không phù hợp loại hình.` : "Giữ các nhánh cao tầng, thấp tầng và tiện ích phù hợp.", affectedTasks: removedByType });

  const phaseBranches = [
    { code: "9.3.7", label: "Mở bán" },
    { code: "4.1.5.13", label: "Cấp phép" },
    { code: "4.4.1.3", label: "Bàn giao" },
  ];
  let phaseClones = 0;
  for (let phase = 2; phase <= parameters.soPhanKy; phase += 1) {
    phaseBranches.forEach(({ code, label }) => {
      const before = generatedTaskCount;
      cloneBranch(code, `${code}_DOT${phase}`, `${label} đợt ${phase}`);
      phaseClones += generatedTaskCount - before;
    });
  }
  impacts.push({ parameter: "PARAM_SO_PHAN_KY", title: `${parameters.soPhanKy} phân kỳ`, detail: phaseClones ? `Sinh ${phaseClones} task mở bán, cấp phép và bàn giao theo đợt.` : "Sử dụng các nhánh đợt 1 trong thư viện.", affectedTasks: phaseClones });

  const towerMappings: Map<string, string>[] = [];
  if (tasks.some((task) => task.code === "4.3.8.1")) {
    const towerRoot = tasks.find((task) => task.code === "4.3.8.1");
    if (towerRoot) towerRoot.name = `${towerRoot.name.replace(/\s*-\s*\[[^\]]+\]\s*$/, "")} - Tháp A`;
    for (let tower = 2; tower <= parameters.soThapBlock; tower += 1) {
      const letter = String.fromCharCode(64 + tower);
      const mapping = cloneBranch("4.3.8.1", `4.3.8.1_THAP_${letter}`, `Tháp ${letter}`);
      towerMappings.push(mapping);
      const successorCode = mapping.get("4.3.8.1.1") ?? mapping.get("4.3.8.1.2");
      const predecessorCode = tasks.some((task) => task.code === "4.3.8.1.1") ? "4.3.8.1.1" : "4.3.8.1.2";
      if (successorCode) dependencies.push({ successorCode, predecessorCode, type: "SS", lagDays: 15 * (tower - 1) });
    }
  }
  const towerGenerated = towerMappings.reduce((sum, mapping) => sum + mapping.size, 0);
  impacts.push({ parameter: "PARAM_SO_THAP_BLOCK", title: `${parameters.soThapBlock} tháp/block`, detail: towerGenerated ? `Sinh ${towerGenerated} task cho các tháp bổ sung, gối đầu SS mỗi 15 ngày.` : "Dùng một nhánh tháp/block.", affectedTasks: towerGenerated });

  const towerRoots = tasks.filter((task) => task.code === "4.3.8.1" || /^4\.3\.8\.1_THAP_[A-Z]$/.test(task.code));
  let basementGenerated = 0;
  if (parameters.soTangHam === 0) {
    const before = tasks.length;
    tasks = tasks.filter((task) => !/phần ngầm/i.test(task.name));
    basementGenerated = before - tasks.length;
  } else {
    towerRoots.forEach((root) => {
      const basementRoot = `${root.code}.HAM`;
      const baseLevel = root.level + 1;
      addTask({ code: basementRoot, parentCode: root.code, groupCode: "4.3", name: `Thi công ${parameters.soTangHam} tầng hầm - ${parameters.bienPhapDao}`, level: baseLevel, summary: true, defaultDuration: 1 });
      const basementTasks = ["Tường vây Barrette và cọc nền", "Hệ giằng Shoring/Kingpost", `Đào đất hầm theo biện pháp ${parameters.bienPhapDao}`, "Thi công kết cấu tầng hầm"];
      basementTasks.forEach((name, index) => addTask({ code: `${basementRoot}.${index + 1}`, parentCode: basementRoot, groupCode: "4.3", name, level: baseLevel + 1, summary: false, defaultDuration: Math.max(15, parameters.soTangHam * 20) }));
      if (parameters.soTangHam >= 2) addTask({ code: `${basementRoot}.5`, parentCode: basementRoot, groupCode: "4.3", name: "Quan trắc chuyển vị và công trình ngầm", level: baseLevel + 1, summary: false, defaultDuration: parameters.soTangHam * 30 });
    });
    basementGenerated = towerRoots.length * (parameters.soTangHam >= 2 ? 6 : 5);
  }
  impacts.push({ parameter: "PARAM_SO_TANG_HAM", title: parameters.soTangHam ? `${parameters.soTangHam} tầng hầm · ${parameters.bienPhapDao}` : "Không có tầng hầm", detail: parameters.soTangHam ? `Sinh cụm thi công ngầm${parameters.soTangHam >= 2 ? " và quan trắc ngầm" : ""}.` : `Bỏ ${basementGenerated} task phần ngầm.`, affectedTasks: basementGenerated });

  let gpmbRemoved = 0;
  if (parameters.hienTrangDat === "Đất sạch 100%") gpmbRemoved = removeBranches(["9.9"]);
  impacts.push({ parameter: "PARAM_HIEN_TRANG_DAT", title: parameters.hienTrangDat, detail: gpmbRemoved ? `Bỏ qua ${gpmbRemoved} task GPMB thuộc nhánh 9.9.` : "Giữ nhánh đo đạc, bồi thường, tái định cư và bàn giao mặt bằng.", affectedTasks: gpmbRemoved });

  const legalRank = ["Chưa có 1/500", "Đã duyệt 1/500", "Đã duyệt TKCS", "Đã có GPXD"].indexOf(parameters.mocPhapLyDau);
  const completedCodes = new Set<string>();
  if (legalRank >= 1) tasks.filter((task) => isInBranch(task.code, "4.1.4.8") || isInBranch(task.code, "4.1.4.9")).forEach((task) => completedCodes.add(task.code));
  if (legalRank >= 2) tasks.filter((task) => /thiết kế cơ sở/i.test(task.name)).forEach((task) => completedCodes.add(task.code));
  if (legalRank >= 3) tasks.filter((task) => task.code === "4.1.5.12" || task.code === "4.1.5.13").forEach((task) => completedCodes.add(task.code));
  completedCodes.forEach((code) => { taskEdits[code] = { ...taskEdits[code], status: "Hoàn thành", actualProgress: 100, actualNote: `Tự động hoàn thành theo mốc pháp lý: ${parameters.mocPhapLyDau}` }; });
  impacts.push({ parameter: "PARAM_MOC_PHAP_LY_DAU", title: parameters.mocPhapLyDau, detail: completedCodes.size ? `Đánh dấu hoàn thành ${completedCodes.size} task pháp lý/thiết kế đã qua.` : "Không đóng sẵn task pháp lý.", affectedTasks: completedCodes.size });

  const financeRoot = "4.1.TC";
  addTask({ code: financeRoot, parentCode: "4.1", groupCode: "4.1", name: `Nghĩa vụ tài chính đất - ${parameters.nghiaVuTaiChinh}`, level: 2, summary: true, defaultDuration: 1 });
  const financeNames = parameters.nghiaVuTaiChinh === "Đã hoàn thành tiền SDĐ"
    ? ["Xác nhận hoàn thành nghĩa vụ tài chính về đất"]
    : parameters.nghiaVuTaiChinh === "Đang thẩm định giá đất"
      ? ["Lập hồ sơ xác định giá đất", "Thẩm định giá đất", "Phê duyệt và nộp tiền sử dụng đất"]
      : ["Xác định đơn giá thuê đất hàng năm", "Theo dõi và nộp tiền thuê đất"];
  financeNames.forEach((name, index) => addTask({ code: `${financeRoot}.${index + 1}`, parentCode: financeRoot, groupCode: "4.1", name, level: 3, summary: false, defaultDuration: index === 1 ? 45 : 20 }));
  if (parameters.nghiaVuTaiChinh === "Đã hoàn thành tiền SDĐ") taskEdits[`${financeRoot}.1`] = { status: "Hoàn thành", actualProgress: 100 };
  impacts.push({ parameter: "PARAM_NGHIA_VU_TAI_CHINH", title: parameters.nghiaVuTaiChinh, detail: `Sinh ${financeNames.length + 1} task nghĩa vụ tài chính ảnh hưởng pháp lý và mở bán.`, affectedTasks: financeNames.length + 1 });

  const procurementRoot = "9.5.MHT";
  addTask({ code: procurementRoot, parentCode: "9.5", groupCode: "9.5", name: `Mô hình thầu - ${parameters.moHinhThau}`, level: 2, summary: true, defaultDuration: 1 });
  const procurementNames = parameters.moHinhThau === "Chia nhiều gói riêng lẻ"
    ? ["Gói kết cấu", "Gói MEP", "Gói hoàn thiện", "Gói hạ tầng và cảnh quan"]
    : parameters.moHinhThau === "Tổng thầu Design & Build"
      ? ["Lựa chọn Tổng thầu Design & Build", "Thiết kế và thi công song song"]
      : ["Lựa chọn Tổng thầu Thi công", "Triển khai thi công theo hồ sơ thiết kế"];
  procurementNames.forEach((name, index) => addTask({ code: `${procurementRoot}.${index + 1}`, parentCode: procurementRoot, groupCode: "9.5", name, level: 3, summary: false, defaultDuration: 30 }));
  for (let index = 1; index < procurementNames.length; index += 1) dependencies.push({ successorCode: `${procurementRoot}.${index + 1}`, predecessorCode: `${procurementRoot}.1`, type: parameters.moHinhThau === "Tổng thầu Design & Build" ? "SS" : "FS", lagDays: 0 });
  impacts.push({ parameter: "PARAM_MO_HINH_THAU", title: parameters.moHinhThau, detail: `Sinh ${procurementNames.length} gói/chuỗi công việc thầu với logic ${parameters.moHinhThau === "Tổng thầu Design & Build" ? "song song" : "tuần tự"}.`, affectedTasks: procurementNames.length + 1 });

  let sampleHouseTasks = 0;
  if (parameters.nhaMauSales !== "Không làm") {
    const sampleRoot = "9.3.NM";
    addTask({ code: sampleRoot, parentCode: "9.3", groupCode: "9.3", name: `Nhà mẫu & Sales Gallery - ${parameters.nhaMauSales}`, level: 2, summary: true, defaultDuration: 1 });
    ["Thiết kế nhà mẫu và Sales Gallery", "Đấu thầu và lựa chọn nhà thầu", "Thi công và hoàn thiện", "Nghiệm thu, khai trương phục vụ mở bán"].forEach((name, index) => {
      addTask({ code: `${sampleRoot}.${index + 1}`, parentCode: sampleRoot, groupCode: "9.3", name, level: 3, summary: false, defaultDuration: [30, 30, 60, 5][index] });
      if (index > 0) dependencies.push({ successorCode: `${sampleRoot}.${index + 1}`, predecessorCode: `${sampleRoot}.${index}`, type: "FS", lagDays: 0 });
    });
    if (tasks.some((task) => task.code === "9.3.7.1.1")) dependencies.push({ successorCode: "9.3.7.1.1", predecessorCode: `${sampleRoot}.4`, type: "FS", lagDays: 0 });
    sampleHouseTasks = 5;
  }
  impacts.push({ parameter: "PARAM_NHA_MAU_SALES", title: parameters.nhaMauSales, detail: sampleHouseTasks ? "Sinh chuỗi thiết kế, đấu thầu, thi công và khai trương trước mở bán đợt 1." : "Không sinh nhánh nhà mẫu/Sales Gallery.", affectedTasks: sampleHouseTasks });

  const landM2 = parameters.donViDienTichDat === "ha" ? parameters.dienTichDat * 10000 : parameters.dienTichDat;
  let recalculatedTaskCount = 0;
  tasks.filter((task) => !task.summary).forEach((task) => {
    const designMatch = ["9.8", "4.2"].includes(task.groupCode) && /(thiết kế|thẩm định|bóc tách|boq|hồ sơ)/i.test(task.name);
    const qsbMatch = task.groupCode === "9.6";
    const constructionMatch = task.groupCode === "4.3" && /(thi công|kết cấu|hoàn thiện)/i.test(task.name);
    let duration: number | undefined;
    if (designMatch) duration = clampInteger((parameters.gfa / 5000) * 5, 5, 120);
    if (qsbMatch) duration = clampInteger((parameters.gfa / 5000) * 3, 3, 90);
    if (constructionMatch) duration = clampInteger((landM2 / 10000) * 12, 10, 240);
    if (/4\.3\.8\.1(?:_THAP_[A-Z])?\.2$/.test(task.code)) duration = parameters.soTangNoi * 6;
    if (duration !== undefined) {
      taskEdits[task.code] = { ...taskEdits[task.code], duration };
      recalculatedTaskCount += 1;
    }
  });
  impacts.push({ parameter: "PARAM_QUY_MO_GFA_DAT", title: `${parameters.dienTichDat} ${parameters.donViDienTichDat} · GFA ${parameters.gfa.toLocaleString("vi-VN")} m²`, detail: `Tính lại duration cho ${recalculatedTaskCount} task thiết kế, QSB và thi công.`, affectedTasks: recalculatedTaskCount });
  impacts.push({ parameter: "PARAM_SO_TANG_NOI", title: `${parameters.soTangNoi} tầng`, detail: `Thời lượng kết cấu thân: ${parameters.soTangNoi} × 6 = ${parameters.soTangNoi * 6} ngày mỗi tháp.`, affectedTasks: tasks.filter((task) => /4\.3\.8\.1(?:_THAP_[A-Z])?\.2$/.test(task.code)).length });

  const activeCodes = new Set(tasks.map((task) => task.code));
  dependencies = dependencies.filter((dependency, index, list) => activeCodes.has(dependency.successorCode) && activeCodes.has(dependency.predecessorCode)
    && list.findIndex((candidate) => candidate.successorCode === dependency.successorCode && candidate.predecessorCode === dependency.predecessorCode && candidate.type === dependency.type && candidate.lagDays === dependency.lagDays) === index);
  tasks.sort((a, b) => a.groupCode.localeCompare(b.groupCode, undefined, { numeric: true }) || a.code.localeCompare(b.code, undefined, { numeric: true }));

  return {
    tasks,
    dependencies,
    taskEdits,
    impacts,
    generatedTaskCount,
    removedTaskCount: Math.max(0, sourceCount + generatedTaskCount - tasks.length),
    completedTaskCount: completedCodes.size,
    recalculatedTaskCount,
  };
}
