import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CORE_MILESTONE_CODES, KEY_MILESTONES, createInitialSampleSchedule, decomposeMilestoneDates } from "../app/mtl-milestones.ts";
import { DEFAULT_PROJECT_PARAMETERS, generateParameterizedMTL } from "../app/mtl-parameter-engine.ts";

const tasks = JSON.parse(await readFile(new URL("../app/mtl-template.json", import.meta.url), "utf8"));
const dependencies = JSON.parse(await readFile(new URL("../app/mtl-dependencies.json", import.meta.url), "utf8"));
const decompose = (dates, edits = {}) => decomposeMilestoneDates(tasks, dependencies, edits, dates);

test("all 20 key milestones have unique codes and valid real-library mappings", () => {
  const taskCodes = new Set(tasks.map((task) => task.code));
  assert.equal(KEY_MILESTONES.length, 20);
  assert.equal(new Set(KEY_MILESTONES.map((milestone) => milestone.code)).size, 20);
  assert.ok(KEY_MILESTONES.every((milestone) => !milestone.mappedCode || taskCodes.has(milestone.mappedCode)));
});

test("an entered legal milestone fixes its mapped WBS and decomposes preparation tasks backward", () => {
  const result = decompose({ MILE_PLP_05: "2027-06-30" }, { "4.1.5.10": { duration: 20 }, "4.1.5.11": { duration: 10 } });

  assert.equal(result.taskEdits["4.1.5.13"].endDate, "2027-06-30");
  assert.ok(result.taskEdits["4.1.5.10"].endDate < result.taskEdits["4.1.5.13"].startDate);
  assert.ok(result.taskEdits["4.1.5.10"].startDate < result.taskEdits["4.1.5.10"].endDate);
  assert.ok(result.markerTasks.some((task) => task.code === "4.1.MILE_PLP_05"));
  assert.equal(result.markerTasks.find((task) => task.code === "4.1.MILE_PLP_05")?.defaultDuration, 0);
  assert.ok(result.scheduledTaskCount >= 3);
});

test("construction finish anchors the 180-day tower body and detects an infeasible earlier milestone", () => {
  const result = decompose({ MILE_PCD_03: "2027-03-01", MILE_PCD_04: "2027-04-01" }, { "4.3.8.1.2": { duration: 180 } });

  assert.equal(result.taskEdits["4.3.8.1.2"].endDate, "2027-04-01");
  assert.ok(result.taskEdits["4.3.8.1.2"].startDate < "2027-03-01");
  assert.ok(result.warnings.some((warning) => warning.includes("4.3.8.1.2")));
});

test("cross-department milestone dates warn when GPXD and groundbreaking are reversed", () => {
  const result = decompose({ MILE_PLP_05: "2027-06-30", MILE_PCD_01: "2027-07-02" });

  assert.ok(result.warnings.some((warning) => warning.includes("MILE_PCD_01") && warning.includes("5 ngày lịch")));
});

test("internal OM handover warns when it is outside the 30–45-day preparation window", () => {
  const result = decompose({ MILE_OM_01: "2028-01-01", MILE_OM_02: "2028-01-20" });

  assert.ok(result.warnings.some((warning) => warning.includes("30–45 ngày")));
});

test("blank milestones preserve the existing generation flow", () => {
  const result = decompose({});
  assert.equal(result.scheduledTaskCount, 0);
  assert.equal(result.markerTasks.length, 0);
  assert.equal(result.supplementalTasks.length, 0);
  assert.deepEqual(result.warnings, []);
});

test("sample-house inauguration creates a dated preparation chain", () => {
  const result = decompose({ MILE_COM_01: "2027-09-30" });

  assert.ok(result.supplementalTasks.some((task) => task.code === "9.3.NM_INIT.3"));
  assert.ok(result.taskEdits["9.3.NM_INIT.1"].startDate < result.taskEdits["9.3.NM_INIT.3"].startDate);
  assert.ok(result.taskEdits["9.3.NM_INIT.3"].endDate < "2027-09-30");
  assert.equal(result.supplementalDependencies.length, 2);
});

test("commissioning milestone creates a test task after MEP and infrastructure", () => {
  const result = decompose({ MILE_PCD_06: "2028-02-29" });

  assert.ok(result.supplementalTasks.some((task) => task.code === "4.3.COMM_INIT"));
  assert.ok(result.supplementalDependencies.some((link) => link.successorCode === "4.3.COMM_INIT" && link.predecessorCode === "4.3.8.1.3"));
  assert.ok(result.taskEdits["4.3.8.1.3"].endDate < result.taskEdits["4.3.COMM_INIT"].startDate);
});

test("all entered milestones produce unique WBS markers and valid parent codes", () => {
  const dates = Object.fromEntries(KEY_MILESTONES.map((milestone) => [milestone.code, "2029-06-01"]));
  const result = decompose(dates);
  const generated = [...result.markerTasks, ...result.supplementalTasks];
  const codes = new Set([...tasks.map((task) => task.code), ...generated.map((task) => task.code)]);

  assert.equal(result.markerTasks.length, 20);
  assert.equal(codes.size, tasks.length + generated.length);
  assert.ok(generated.every((task) => codes.has(task.parentCode)));
  assert.ok(result.supplementalDependencies.every((link) => codes.has(link.successorCode) && codes.has(link.predecessorCode)));
});

const sample = (dates = {}, parameters = DEFAULT_PROJECT_PARAMETERS) => {
  const generated = generateParameterizedMTL(tasks, dependencies, parameters);
  return createInitialSampleSchedule(generated.tasks, generated.dependencies, generated.taskEdits, dates, parameters, "2026-09-15");
};

test("no entered dates still generates a complete dated sample schedule", () => {
  const result = sample();
  assert.equal(result.milestoneDates.MILE_PLP_00, "2026-09-15");
  assert.ok(CORE_MILESTONE_CODES.every((code) => result.milestoneSources[code] === "assumed"));
  assert.ok(result.datedLeafCount > 500);
  assert.ok(result.datedLeafCount === Object.keys(result.taskEdits).filter((code) => !code.includes(".MILE_")).length);
  assert.ok(result.milestoneDates.MILE_OM_04 > result.milestoneDates.MILE_PCD_07);
});

test("one and five manually entered core milestones stay fixed while other dates are assumed", () => {
  const one = sample({ MILE_PLP_05: "2028-06-01" });
  assert.equal(one.milestoneDates.MILE_PLP_05, "2028-06-01");
  assert.equal(one.milestoneSources.MILE_PLP_05, "manual");
  assert.equal(one.taskEdits["4.1.5.13"].endDate, "2028-06-01");
  assert.ok(one.milestoneDates.MILE_PLP_01 < "2028-06-01");

  const dates = { MILE_PLP_00: "2027-01-01", MILE_PLP_01: "2027-06-01", MILE_PLP_05: "2028-01-01", MILE_PCD_07: "2029-09-01", MILE_OM_04: "2030-01-01" };
  const five = sample(dates);
  assert.ok(CORE_MILESTONE_CODES.every((code) => five.milestoneDates[code] === dates[code] && five.milestoneSources[code] === "manual"));
  assert.equal(five.milestoneDates.MILE_OM_02 < five.milestoneDates.MILE_OM_04, true);
  assert.equal(five.milestoneDates.MILE_OM_03 > five.milestoneDates.MILE_OM_04, true);
});

test("low-rise sample uses number of houses and skips basement and topping-out milestones", () => {
  const parameters = { ...DEFAULT_PROJECT_PARAMETERS, loaiHinhDuAn: "Thấp tầng/Biệt thự", soCanThapTang: 220 };
  const result = sample({}, parameters);
  assert.equal(result.milestoneDates.MILE_PCD_03, undefined);
  assert.equal(result.milestoneDates.MILE_PCD_04, undefined);
  assert.ok(result.datedLeafCount > 0);
});

test("high-rise topping-out follows floor count and dynamic structural duration", () => {
  const parameters = { ...DEFAULT_PROJECT_PARAMETERS, loaiHinhDuAn: "Chung cư cao tầng", soTangNoi: 40 };
  const result = sample({}, parameters);
  assert.equal(result.taskEdits["4.3.8.1.2"].duration, 240);
  assert.equal(result.taskEdits["4.3.8.1.2"].endDate, result.milestoneDates.MILE_PCD_04);
  assert.ok(result.milestoneDates.MILE_PCD_04 > result.milestoneDates.MILE_PCD_03);
  assert.ok(result.milestoneDates.MILE_PCD_04 < result.milestoneDates.MILE_PCD_07);
});

test("contradictory fixed milestones warn without overwriting manual values", () => {
  const result = sample({ MILE_PLP_01: "2028-06-01", MILE_PLP_05: "2028-01-01" });
  assert.equal(result.milestoneDates.MILE_PLP_05, "2028-01-01");
  assert.ok(result.warnings.some((warning) => warning.includes("MILE_PLP_05")));
});

test("sample schedule strictly respects baselineDate as the minimum start date", () => {
  const baseline = "2026-10-01";
  const generated = generateParameterizedMTL(tasks, dependencies, DEFAULT_PROJECT_PARAMETERS);
  const result = createInitialSampleSchedule(generated.tasks, generated.dependencies, generated.taskEdits, {}, DEFAULT_PROJECT_PARAMETERS, baseline);
  assert.ok(result.earliestDate >= baseline);
  assert.ok(Object.values(result.taskEdits).every((edit) => !edit.startDate || edit.startDate >= baseline));
});
