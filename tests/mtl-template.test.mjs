import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = JSON.parse(await readFile(new URL("../app/mtl-template.json", import.meta.url), "utf8"));
const dependencies = JSON.parse(await readFile(new URL("../app/mtl-dependencies.json", import.meta.url), "utf8"));

test("MTL template preserves the complete Project catalog", () => {
  assert.equal(template.length, 1100);
  assert.equal(new Set(template.map((task) => task.code)).size, 1100);
  assert.equal(template.filter((task) => task.code.startsWith("9.")).length, 783);
  assert.equal(template.filter((task) => task.code.startsWith("4.")).length, 317);
});

test("MTL template contains nine departments and all Part 4 groups", () => {
  const groups = new Set(template.map((task) => task.groupCode));
  const codes = new Set(template.map((task) => task.code));
  assert.deepEqual(
    [...groups].sort(),
    ["4.0", "4.1", "4.2", "4.3", "4.4", "9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9"],
  );
  assert.equal(Math.max(...template.map((task) => task.level)), 6);
  assert.ok(template.every((task) => task.parentCode === null || codes.has(task.parentCode)));
});

test("MTL template carries the reporting metadata from the September 2026 workbook", () => {
  assert.equal(template.filter((task) => task.gmdReport).length, 525);
  assert.equal(template.filter((task) => task.workGroup).length, 788);
  assert.equal(template.filter((task) => task.workGroup === "Báo cáo định kỳ").length, 276);
  assert.equal(template.filter((task) => task.workGroup === "Tracking công việc").length, 512);
  assert.equal(template.filter((task) => task.notes).length, 819);
  assert.deepEqual(
    [...new Set(template.flatMap((task) => task.workGroup ? [task.workGroup] : []))].sort(),
    ["Báo cáo định kỳ", "Tracking công việc"],
  );
});

test("default predecessor links from MTL_9_4_Lien_ket_Cong_viec match WBS codes", () => {
  const codes = new Set(template.map((task) => task.code));
  assert.equal(dependencies.length, 788);
  assert.ok(dependencies.every((dependency) => codes.has(dependency.successorCode) && codes.has(dependency.predecessorCode)));
  assert.deepEqual(
    Object.fromEntries(["FS", "SS"].map((type) => [type, dependencies.filter((dependency) => dependency.type === type).length])),
    { FS: 728, SS: 60 },
  );
});
