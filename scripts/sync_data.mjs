import xlsx from "xlsx";
import fs from "fs";
const { readFile, utils } = xlsx;

const excelPath = "E:\\0.PROJECT AI\\DATA MTL\\MTL_9_4_Lien_ket_Cong_viec.xlsx";
const templatePath = "./app/mtl-template.json";
const dependenciesPath = "./app/mtl-dependencies.json";

const template = JSON.parse(fs.readFileSync(templatePath, "utf-8"));
const templateMap = new Map(template.map((t) => [t.code, t]));
const templateCodeSet = new Set(template.map((t) => t.code));

const workbook = readFile(excelPath);
const sheet = workbook.Sheets["MTL 9-4"];
const data = utils.sheet_to_json(sheet, { header: 1 });

console.log(`Excel total rows: ${data.length}`);

// Header is at row index 4
// Row 4: ["Mã WBS","Đơn vị chủ trì","Hạng mục công việc","Loại công việc","Công việc tiền nhiệm (Predecessors)","Mối quan hệ","Thời lượng giả lập (Ngày)","Diễn giải logic nghiệp vụ & Đơn vị phối hợp"]

let updatedDurations = 0;
let updatedNotes = 0;
let updatedWorkGroups = 0;

const extractedDependencies = [];
const seenDepKey = new Set();
const invalidPreds = [];

for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[0]) continue;
  const wbs = String(row[0]).trim();
  const name = row[2] ? String(row[2]).trim() : "";
  const workType = row[3] ? String(row[3]).trim() : "";
  const predStr = row[4] ? String(row[4]).trim() : "";
  const rel = row[5] ? String(row[5]).trim() : "FS";
  const durVal = row[6] !== undefined && row[6] !== null && String(row[6]).trim() !== "" ? Number(row[6]) : null;
  const note = row[7] ? String(row[7]).trim() : "";

  const task = templateMap.get(wbs);
  if (task) {
    if (durVal !== null && !isNaN(durVal) && durVal > 0) {
      task.defaultDuration = durVal;
      updatedDurations++;
    }
    if (workType) {
      task.workGroup = workType;
      updatedWorkGroups++;
    }
    if (note) {
      task.notes = note;
      updatedNotes++;
    }
  }

  if (predStr && templateCodeSet.has(wbs)) {
    // Split predecessors by semicolon or comma
    const preds = predStr.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    for (const p of preds) {
      if (!templateCodeSet.has(p)) {
        invalidPreds.push({ successorCode: wbs, predecessorCode: p });
        continue;
      }
      if (p === wbs) {
        console.warn(`Self dependency detected: ${wbs}`);
        continue;
      }
      const key = `${wbs}->${p}`;
      if (!seenDepKey.has(key)) {
        seenDepKey.add(key);
        extractedDependencies.push({
          successorCode: wbs,
          predecessorCode: p,
          type: (rel === "SS" || rel === "FF" || rel === "SF") ? rel : "FS",
          lagDays: 0,
        });
      }
    }
  }
}

console.log(`Updated tasks in template: durations=${updatedDurations}, workGroups=${updatedWorkGroups}, notes=${updatedNotes}`);
console.log(`Invalid predecessor codes (not in catalog): ${invalidPreds.length}`);
if (invalidPreds.length > 0) {
  console.log("Invalid predecessors sample:", invalidPreds.slice(0, 10));
}
console.log(`Extracted unique dependencies: ${extractedDependencies.length}`);

// Cycle detection via topological sort
function detectCycles(deps) {
  const adj = new Map();
  for (const code of templateCodeSet) adj.set(code, []);
  for (const dep of deps) {
    adj.get(dep.predecessorCode)?.push(dep.successorCode);
  }

  const visited = new Map(); // 0: unvisited, 1: visiting, 2: visited
  const cycleNodes = [];

  function dfs(node, path) {
    visited.set(node, 1);
    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      if (visited.get(neighbor) === 1) {
        cycleNodes.push([...path, neighbor]);
        return true;
      }
      if (!visited.get(neighbor)) {
        if (dfs(neighbor, [...path, neighbor])) return true;
      }
    }
    visited.set(node, 2);
    return false;
  }

  for (const code of templateCodeSet) {
    if (!visited.get(code)) {
      if (dfs(code, [code])) break;
    }
  }

  return cycleNodes;
}

const cycles = detectCycles(extractedDependencies);
console.log(`Cycles detected: ${cycles.length}`);
if (cycles.length > 0) {
  console.log("First cycle:", cycles[0]);
}
