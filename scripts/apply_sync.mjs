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

let updatedDurations = 0;
let updatedNotes = 0;
let updatedWorkGroups = 0;

const extractedDependencies = [];
const seenDepKey = new Set();

for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[0]) continue;
  const wbs = String(row[0]).trim();
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
      task.workGroup = workType === "Tracking" ? "Tracking công việc" : workType;
      updatedWorkGroups++;
    }
    if (note) {
      task.notes = note;
      updatedNotes++;
    }
  }

  if (predStr && templateCodeSet.has(wbs)) {
    const preds = predStr.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    for (const p of preds) {
      if (!templateCodeSet.has(p) || p === wbs) continue;
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

// Preserve any special lagDays from previous dependencies if successor and predecessor match
const prevDeps = JSON.parse(fs.readFileSync(dependenciesPath, "utf-8"));
const prevLagMap = new Map();
for (const d of prevDeps) {
  if (d.lagDays && d.lagDays !== 0) {
    prevLagMap.set(`${d.successorCode}->${d.predecessorCode}`, d.lagDays);
  }
}

for (const d of extractedDependencies) {
  const key = `${d.successorCode}->${d.predecessorCode}`;
  if (prevLagMap.has(key)) {
    d.lagDays = prevLagMap.get(key);
  }
}

console.log(`Writing template: ${template.length} tasks...`);
console.log(`Updated durations: ${updatedDurations}, workGroups: ${updatedWorkGroups}, notes: ${updatedNotes}`);
fs.writeFileSync(templatePath, JSON.stringify(template, null, 2), "utf-8");

console.log(`Writing dependencies: ${extractedDependencies.length} links...`);
fs.writeFileSync(dependenciesPath, JSON.stringify(extractedDependencies, null, 2), "utf-8");

console.log("SUCCESS! All data written to mtl-template.json and mtl-dependencies.json");
