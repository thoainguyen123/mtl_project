import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = JSON.parse(await readFile(new URL("../app/mtl-template.json", import.meta.url), "utf8"));
const dependencies = JSON.parse(await readFile(new URL("../app/mtl-dependencies.json", import.meta.url), "utf8"));

test("MTL template preserves the complete Project catalog", () => {
  assert.equal(template.length, 564);
  assert.equal(new Set(template.map((task) => task.code)).size, 564);
  assert.equal(template.filter((task) => task.code.startsWith("9.")).length, 250);
  assert.equal(template.filter((task) => task.code.startsWith("4.")).length, 314);
});

test("MTL template contains nine departments and all Part 4 groups", () => {
  const groups = new Set(template.map((task) => task.groupCode));
  assert.deepEqual(
    [...groups].sort(),
    ["4.0", "4.1", "4.2", "4.3", "4.4", "9.1", "9.2", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9"],
  );
  assert.equal(Math.max(...template.map((task) => task.level)), 4);
});

test("default predecessor links from the August 2026 MPP match WBS codes", () => {
  const codes = new Set(template.map((task) => task.code));
  assert.equal(dependencies.length, 31);
  assert.ok(dependencies.every((dependency) => codes.has(dependency.successorCode) && codes.has(dependency.predecessorCode)));
  assert.deepEqual(
    Object.fromEntries(["FS", "FF", "SS"].map((type) => [type, dependencies.filter((dependency) => dependency.type === type).length])),
    { FS: 21, FF: 9, SS: 1 },
  );
  assert.deepEqual(
    dependencies.find((dependency) => dependency.lagDays !== 0),
    { successorCode: "4.3.8.1.3", predecessorCode: "4.3.8.1.2", type: "SS", lagDays: 90 },
  );
});
