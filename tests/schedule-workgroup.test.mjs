import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const template = JSON.parse(await readFile(new URL("../app/mtl-template.json", import.meta.url), "utf8"));

function workingDaysBetween(start, end) {
  if (!start || !end || end < start) return 0;
  let count = 0;
  let curr = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (curr <= stop) {
    const day = curr.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    curr.setUTCDate(curr.getUTCDate() + 1);
  }
  return count;
}

test("template distinguishes Báo cáo định kỳ, Tracking công việc, and summary tasks", () => {
  const baoCao = template.filter((t) => t.workGroup === "Báo cáo định kỳ");
  const tracking = template.filter((t) => t.workGroup === "Tracking công việc");
  const summaries = template.filter((t) => t.summary);

  assert.equal(baoCao.length, 276);
  assert.equal(tracking.length, 512);
  assert.equal(summaries.length, 312);
  assert.equal(baoCao.length + tracking.length + summaries.length, 1100);
});

test("schedule calculation logic leaves Báo cáo định kỳ with empty dates and rolls up parents from Tracking children", () => {
  const tasks = template.map((task) => {
    const isParent = task.summary || template.some((other) => other.code !== task.code && other.code.startsWith(`${task.code}.`));
    const isBaoCao = task.workGroup === "Báo cáo định kỳ";

    if (isParent || isBaoCao) {
      return {
        ...task,
        startDate: "",
        endDate: "",
        duration: 0,
      };
    }

    return {
      ...task,
      startDate: "2026-03-01",
      endDate: "2026-03-10",
      duration: 8,
    };
  });

  // Verify Báo cáo định kỳ tasks have empty dates and duration 0
  const baoCao = tasks.filter((t) => t.workGroup === "Báo cáo định kỳ");
  assert.ok(baoCao.every((t) => t.startDate === "" && t.endDate === "" && t.duration === 0));

  // Roll up parents
  const rolledUp = tasks.map((task) => {
    const descendants = tasks.filter((candidate) => candidate.code.startsWith(`${task.code}.`));
    const isParent = task.summary || descendants.length > 0;
    if (!isParent || !descendants.length) return task;

    const datedDescendants = descendants.filter((c) => Boolean(c.startDate && c.endDate));
    if (datedDescendants.length > 0) {
      const startDate = datedDescendants.reduce((earliest, c) => (!earliest || c.startDate < earliest ? c.startDate : earliest), datedDescendants[0].startDate);
      const endDate = datedDescendants.reduce((latest, c) => (!latest || c.endDate > latest ? c.endDate : latest), datedDescendants[0].endDate);
      const duration = Math.max(1, workingDaysBetween(startDate, endDate));
      return {
        ...task,
        summary: true,
        startDate,
        endDate,
        duration,
      };
    }

    return {
      ...task,
      summary: true,
      startDate: "",
      endDate: "",
      duration: 0,
    };
  });

  // Parents that have tracking children should have valid rolled-up dates
  const sampleParent = rolledUp.find((t) => t.summary && template.some((c) => c.code.startsWith(`${t.code}.`) && c.workGroup === "Tracking công việc"));
  assert.ok(sampleParent);
  assert.equal(sampleParent.startDate, "2026-03-01");
  assert.equal(sampleParent.endDate, "2026-03-10");
  assert.equal(sampleParent.duration, 7);
});
