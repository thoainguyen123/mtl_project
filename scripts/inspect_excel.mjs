import xlsx from "xlsx";
import fs from "fs";
const { readFile, utils } = xlsx;

const templatePath = "./app/mtl-template.json";
const template = JSON.parse(fs.readFileSync(templatePath, "utf-8"));
const templateCodeSet = new Set(template.map((t) => t.code));

const filePath = "E:\\0.PROJECT AI\\DATA MTL\\MTL_9_4_Lien_ket_Cong_viec.xlsx";
const workbook = readFile(filePath);
const sheet = workbook.Sheets["MTL 9-4"];
const data = utils.sheet_to_json(sheet, { header: 1 });

let matchedCount = 0;
const missingInTemplate = [];
const allExtractedDependencies = [];
let durationUpdates = 0;

for (let i = 5; i < data.length; i++) {
  const row = data[i];
  if (!row || !row[0]) continue;
  const wbs = String(row[0]).trim();
  const name = row[2] ? String(row[2]).trim() : "";
  const workType = row[3] ? String(row[3]).trim() : "";
  const predStr = row[4] ? String(row[4]).trim() : "";
  const rel = row[5] ? String(row[5]).trim() : "FS";
  const dur = row[6] !== undefined && row[6] !== null && String(row[6]).trim() !== "" ? Number(row[6]) : null;

  if (templateCodeSet.has(wbs)) {
    matchedCount++;
  } else {
    missingInTemplate.push({ wbs, name });
  }

  if (dur !== null && !isNaN(dur)) {
    durationUpdates++;
  }

  if (predStr) {
    const preds = predStr.split(/[;,]/).map((p) => p.trim()).filter(Boolean);
    for (const p of preds) {
      allExtractedDependencies.push({
        successorCode: wbs,
        predecessorCode: p,
        type: rel || "FS",
        lagDays: 0,
      });
    }
  }
}

console.log("Template tasks total:", template.length);
console.log("Excel tasks matched in template:", matchedCount);
console.log("Excel tasks missing in template:", missingInTemplate.length);
if (missingInTemplate.length > 0) {
  console.log("First 5 missing:", missingInTemplate.slice(0, 5));
}
console.log("Total dependencies extracted from Excel:", allExtractedDependencies.length);
console.log("Total tasks with custom duration:", durationUpdates);
