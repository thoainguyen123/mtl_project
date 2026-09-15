import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DEFAULT_PROJECT_PARAMETERS, generateParameterizedMTL } from "../app/mtl-parameter-engine.ts";

const template = JSON.parse(await readFile(new URL("../app/mtl-template.json", import.meta.url), "utf8"));
const dependencies = JSON.parse(await readFile(new URL("../app/mtl-dependencies.json", import.meta.url), "utf8"));

const generate = (overrides = {}) => generateParameterizedMTL(template, dependencies, {
  ...DEFAULT_PROJECT_PARAMETERS,
  ...overrides,
});

test("filters incompatible WBS branches and preserves tree integrity", () => {
  const result = generate({
    loaiHinhDuAn: "Thấp tầng/Biệt thự",
    hienTrangDat: "Đất sạch 100%",
    soTangHam: 0,
  });
  const codes = new Set(result.tasks.map((task) => task.code));

  assert.ok(result.tasks.every((task) => !task.code.startsWith("4.3.8")));
  assert.ok(result.tasks.every((task) => !task.code.startsWith("9.9")));
  assert.ok(result.tasks.every((task) => task.parentCode === null || codes.has(task.parentCode)));
  assert.ok(result.dependencies.every((link) => codes.has(link.successorCode) && codes.has(link.predecessorCode)));
});

test("clones tower tasks, creates basement work and applies 6-day floor norm", () => {
  const result = generate({ soThapBlock: 3, soTangHam: 2, soTangNoi: 30 });
  const codes = new Set(result.tasks.map((task) => task.code));

  assert.equal(codes.size, result.tasks.length);
  assert.ok(codes.has("4.3.8.1_THAP_B.2"));
  assert.ok(codes.has("4.3.8.1_THAP_C.HAM.5"));
  assert.equal(result.taskEdits["4.3.8.1.2"].duration, 180);
  assert.equal(result.taskEdits["4.3.8.1_THAP_B.2"].duration, 180);
  assert.ok(result.dependencies.some((link) => link.successorCode === "4.3.8.1_THAP_B.1" && link.type === "SS" && link.lagDays === 15));
  assert.ok(result.dependencies.some((link) => link.successorCode === "4.3.8.1_THAP_C.1" && link.type === "SS" && link.lagDays === 30));
});

test("removes underground construction tasks when the project has no basement", () => {
  const result = generate({ loaiHinhDuAn: "Chung cư cao tầng", soTangHam: 0 });

  assert.ok(result.tasks.every((task) => !task.code.includes(".HAM")));
  assert.ok(result.tasks.every((task) => !/phần ngầm/i.test(task.name)));
});

test("clones phased sale, legal and handover milestones", () => {
  const result = generate({ soPhanKy: 3 });
  const codes = new Set(result.tasks.map((task) => task.code));

  assert.ok(codes.has("9.3.7_DOT2"));
  assert.ok(codes.has("4.1.5.13_DOT3"));
  assert.ok(codes.has("4.4.1.3_DOT3"));
});

test("marks legal history complete from the selected initial milestone", () => {
  const result = generate({ mocPhapLyDau: "Đã có GPXD" });
  const completed = Object.values(result.taskEdits).filter((edit) => edit.status === "Hoàn thành");

  assert.ok(completed.length > 0);
  assert.equal(result.taskEdits["4.1.5.13"].actualProgress, 100);
  assert.equal(result.completedTaskCount, completed.length);
});

test("supports all initial legal milestones", () => {
  const milestones = ["Chưa có 1/500", "Đã duyệt 1/500", "Đã duyệt TKCS", "Đã có GPXD"];
  const counts = milestones.map((mocPhapLyDau) => generate({ mocPhapLyDau }).completedTaskCount);

  assert.equal(counts[0], 0);
  assert.ok(counts[1] > counts[0]);
  assert.ok(counts[2] >= counts[1]);
  assert.ok(counts[3] > counts[2]);
});

test("uses number of units instead of basement and floor inputs for low-rise projects", () => {
  const result = generate({ loaiHinhDuAn: "Thấp tầng/Biệt thự", soCanThapTang: 240 });

  assert.equal(result.taskEdits["4.3.7.1.1"].duration, 360);
  assert.equal(result.taskEdits["4.3.7.1.2"].duration, 240);
  assert.ok(result.impacts.some((impact) => impact.parameter === "PARAM_SO_CAN_THAP_TANG" && impact.title === "240 căn thấp tầng"));
  assert.ok(result.impacts.every((impact) => impact.parameter !== "PARAM_SO_TANG_NOI"));
  assert.ok(result.impacts.every((impact) => impact.parameter !== "PARAM_SO_THAP_BLOCK" && impact.parameter !== "PARAM_SO_TANG_HAM"));
});
