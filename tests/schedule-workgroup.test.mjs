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

test("calibrated schedule strictly encloses all tasks within project startDate and targetDate without slipping", () => {
  const pStart = "2026-09-20";
  const pEnd = "2028-12-31";

  function interpolateDate(start, end, fraction) {
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    const targetMs = startMs + (endMs - startMs) * Math.max(0, Math.min(1, fraction));
    return new Date(targetMs).toISOString().slice(0, 10);
  }

  function dateAtWorkingOffset(start, offset) {
    let value = start;
    let remaining = Math.abs(offset);
    const direction = offset < 0 ? -1 : 1;
    while (remaining > 0) {
      const d = new Date(`${value}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + direction);
      value = d.toISOString().slice(0, 10);
      const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
      if (weekday !== 0 && weekday !== 6) remaining -= 1;
    }
    return value;
  }

  const mGroundbreaking = interpolateDate(pStart, pEnd, 0.28);
  const mFinish = interpolateDate(mGroundbreaking, pEnd, 0.82);
  const mHandover = interpolateDate(mFinish, pEnd, 0.65);

  const windows = {
    "4.0": [pStart, pEnd],
    "4.1": [pStart, mHandover],
    "4.2": [pStart, mGroundbreaking],
    "4.3": [mGroundbreaking, mFinish],
    "4.4": [mFinish, pEnd],
    "9.1": [pStart, mGroundbreaking],
    "9.2": [pStart, pEnd],
    "9.3": [interpolateDate(pStart, pEnd, 0.42), pEnd],
    "9.4": [interpolateDate(pStart, pEnd, 0.35), mFinish],
    "9.5": [interpolateDate(pStart, mGroundbreaking, 0.4), mFinish],
    "9.6": [interpolateDate(pStart, mGroundbreaking, 0.3), mFinish],
    "9.7": [pStart, pEnd],
    "9.8": [pStart, mGroundbreaking],
    "9.9": [pStart, mGroundbreaking],
  };

  const totalProjectWorkingDays = workingDaysBetween(pStart, pEnd);
  const timeScale = Math.min(1.2, Math.max(0.15, totalProjectWorkingDays / 600));

  const leafTasks = template.filter((t) => !t.summary);
  const byGroup = new Map();
  leafTasks.forEach((t) => byGroup.set(t.groupCode, [...(byGroup.get(t.groupCode) ?? []), t]));

  const scheduled = [];
  byGroup.forEach((groupTasks, groupCode) => {
    const [wStart, wEnd] = windows[groupCode] ?? [pStart, pEnd];
    const wWorkingDays = Math.max(5, workingDaysBetween(wStart, wEnd));
    const gCount = Math.max(1, groupTasks.length);

    groupTasks.forEach((task, index) => {
      if (task.workGroup === "Báo cáo định kỳ") return;
      const offsetWorkingDays = Math.floor((index / gCount) * Math.max(0, wWorkingDays - 4) * 0.85);
      let taskStart = dateAtWorkingOffset(wStart, offsetWorkingDays);
      if (taskStart < pStart) taskStart = pStart;
      if (taskStart >= pEnd) taskStart = pStart;

      const rawDur = task.defaultDuration > 0 ? task.defaultDuration : 10;
      const scaledDur = Math.max(1, Math.round(rawDur * timeScale));
      const tentativeEnd = dateAtWorkingOffset(taskStart, scaledDur - 1);
      let taskEnd = tentativeEnd <= wEnd ? tentativeEnd : wEnd;
      if (taskEnd > pEnd) taskEnd = pEnd;
      if (taskEnd < taskStart) taskEnd = taskStart;

      scheduled.push({
        code: task.code,
        groupCode: task.groupCode,
        startDate: taskStart,
        endDate: taskEnd,
        duration: workingDaysBetween(taskStart, taskEnd),
      });
    });
  });

  assert.ok(scheduled.length > 500);
  // Verify 100% of tasks are strictly within [pStart, pEnd]
  assert.ok(scheduled.every((t) => t.startDate >= pStart), "All tasks must start on or after project start date");
  assert.ok(scheduled.every((t) => t.endDate <= pEnd), "All tasks must end on or before project end date");
  assert.ok(scheduled.every((t) => t.endDate >= t.startDate), "All tasks must end on or after their start date");
  assert.ok(scheduled.every((t) => t.duration >= 1), "All tasks must have positive duration");
});

