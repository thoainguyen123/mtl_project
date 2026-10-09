import test from "node:test";
import assert from "node:assert/strict";
import { generate, suggestAnchors } from "../lib/engine/generate";
import { DEFAULT_CONFIG } from "../lib/engine/config";
import type { ProjectParameters } from "../lib/types";

const anchors = {
  name: "Dự án thử", code: "TST", investor: "Công ty A", region: "TP.HCM",
  t0: "2026-10-01", startConstruction: "2028-03-01", openSale: "2030-06-01",
  handover: "2032-06-30", closeOut: "2033-06-30",
};
const high = (over: Partial<NonNullable<ProjectParameters["high"]>> = {}): ProjectParameters => ({
  anchors: { ...anchors, type: "high_rise" },
  high: { towers: 3, basements: 2, floors: 25, gfa: 60000, pool: true, landHa: 1.2, ...over },
  hangMuc: ["htkt", "coc", "tien_ich", "canh_quan"],
});
const low = (over: Partial<NonNullable<ProjectParameters["low"]>> = {}): ProjectParameters => ({
  anchors: { ...anchors, type: "low_rise" },
  low: { units: 300, phases: 2, landHa: 15.5, parkM2: 10000, clubhouse: true, ...over },
  hangMuc: ["san_lap", "xu_ly_nen", "htkt", "tien_ich", "canh_quan"],
});
const run = (p: ProjectParameters) => generate({ params: p, config: DEFAULT_CONFIG });
const leafs = (r: ReturnType<typeof run>) => r.tasks.filter((t) => t.kind === "task" || t.kind === "periodic");

test("hầm = 0 loại bỏ toàn bộ nhánh tường vây / shoring / đào hầm", () => {
  const withB = run(high({ basements: 2 }));
  const noB = run(high({ basements: 0 }));
  const has = (r: ReturnType<typeof run>) => r.tasks.filter((t) => t.tags?.includes("basement"));
  assert.ok(has(withB).length >= 5, "có hầm thì phải có nhánh hầm");
  assert.equal(has(noB).length, 0);
  assert.ok(noB.report.removedByRule.some((x) => /hầm = 0/.test(x.rule)));
  assert.ok(noB.report.included < withB.report.included);
});

test("hầm < 2 bỏ quan trắc chuyển vị sâu, hầm >= 2 giữ lại", () => {
  const deep = (r: ReturnType<typeof run>) => r.tasks.filter((t) => t.tags?.includes("basement_deep")).length;
  assert.equal(deep(run(high({ basements: 1 }))), 0);
  assert.ok(deep(run(high({ basements: 2 }))) > 0);
});

test("thấp tầng xóa 100% nhánh cao tầng (13.8)", () => {
  const r = run(low());
  assert.equal(r.tasks.filter((t) => t.templateCode.startsWith("13.8")).length, 0);
  assert.ok(r.tasks.some((t) => t.templateCode.startsWith("13.7")));
});

test("cao tầng xóa nhánh thấp tầng (13.7)", () => {
  const r = run(high());
  assert.equal(r.tasks.filter((t) => t.templateCode.startsWith("13.7")).length, 0);
});

test("N tháp => N nhánh, đổi tiền tố tên, cuốn chiếu SS + 15 ngày", () => {
  const r = run(high({ towers: 3 }));
  const thanA = r.tasks.find((t) => t.templateCode === "13.8.1.2" && t.copyLabel === "Tháp A")!;
  const thanB = r.tasks.find((t) => t.templateCode === "13.8.1.2" && t.copyLabel === "Tháp B")!;
  const thanC = r.tasks.find((t) => t.templateCode === "13.8.1.2" && t.copyLabel === "Tháp C")!;
  assert.ok(thanA && thanB && thanC);
  assert.match(thanA.name, /Tháp A$/);
  const entryB = r.tasks.find((t) => t.templateCode === "13.8.1.1" && t.copyLabel === "Tháp B")!;
  assert.ok(entryB.deps.some((d) => d.rel === "SS" && d.lag === 15 && d.predId === "13.8.1.1@1"));
  assert.ok(entryB.start! > r.tasks.find((t) => t.id === "13.8.1.1@1")!.start!);
  const dup = r.report.duplications.find((x) => /3 tháp/.test(x.rule))!;
  assert.equal(dup.copies, 3);
});

test("1 tháp không nhân bản", () => {
  const r = run(high({ towers: 1 }));
  assert.equal(r.report.duplications.length, 0);
  assert.ok(r.tasks.find((t) => t.id === "13.8.1.2"));
});

test("công thức: thời lượng thân = số tầng nổi × ngày/sàn", () => {
  const r = run(high({ floors: 25 }));
  const t = r.tasks.find((x) => x.templateCode === "13.8.1.2")!;
  assert.equal(t.durationDays, 25 * 6);
  const r2 = run(high({ floors: 40 }));
  assert.equal(r2.tasks.find((x) => x.templateCode === "13.8.1.2")!.durationDays, 240);
});

test("K phân kỳ => K nhánh thi công và K nhánh bàn giao", () => {
  const r = run(low({ phases: 3 }));
  for (const root of ["13.7.1.1", "13.12.1.3"]) {
    const copies = r.tasks.filter((t) => t.templateCode === root);
    assert.equal(copies.length, 3, root);
  }
  assert.ok(r.tasks.some((t) => t.name.includes("Bàn giao đợt 3")));
});

test("lịch: không việc nào bắt đầu trước T0; việc thi công không trước Khởi công", () => {
  const r = run(high());
  for (const t of leafs(r)) assert.ok(t.start! >= anchors.t0, `${t.wbs} ${t.name}`);
  for (const t of leafs(r).filter((x) => x.templateCode.startsWith("13.") && x.kind === "task")) {
    assert.ok(t.start! >= anchors.startConstruction, `${t.wbs} ${t.name} bắt đầu ${t.start}`);
  }
});

test("mốc neo có đủ 5 mốc và đúng ngày", () => {
  const r = run(high());
  const ms = Object.fromEntries(r.tasks.filter((t) => t.kind === "milestone").map((t) => [t.anchor, t.start]));
  assert.deepEqual(ms, { T0: anchors.t0, KC: anchors.startConstruction, MB: anchors.openSale, BG: anchors.handover, KT: anchors.closeOut });
});

test("chuỗi pháp lý/thiết kế được tính lùi (ALAP) về trước Khởi công", () => {
  const r = run(high());
  const gate = r.tasks.filter((t) => t.tags?.includes("gate_kc"));
  assert.ok(gate.length > 0, "phải có tác vụ cổng Khởi công");
  for (const g of gate) assert.ok(g.finish! < anchors.startConstruction, `${g.name} xong ${g.finish}`);
});

test("khung thời gian quá ngắn => cảnh báo xung đột, không báo lỗi im lặng", () => {
  const p = high();
  p.anchors.startConstruction = "2026-11-01";
  const r = run(p);
  assert.ok(r.report.warnings.some((w) => /vi phạm ràng buộc/.test(w)) || r.tasks.some((t) => t.conflict));
});

test("tác vụ định kỳ không tham gia đường găng", () => {
  const r = run(high());
  assert.equal(r.tasks.filter((t) => t.kind === "periodic" && t.critical).length, 0);
});

test("hiệu năng: sinh MTL ~800 công việc dưới 1 giây", () => {
  const t = Date.now();
  run(high({ towers: 4 }));
  assert.ok(Date.now() - t < 1000, `mất ${Date.now() - t} ms`);
});

test("việc vận hành (OM) diễn ra sau Bàn giao và không kéo dài ngày kết thúc dự án", () => {
  const r = run(high());
  const om = r.tasks.filter((t) => t.kind === "task" && t.tags?.includes("post_project"));
  assert.ok(om.length > 0);
  for (const t of om) assert.ok(t.start! >= anchors.handover, `${t.name} bắt đầu ${t.start}`);
  assert.ok(r.report.projectFinish < "2035-01-01");
});

test("gợi ý mốc khả thi => sinh lịch không xung đột", () => {
  for (const p of [high(), low({ phases: 3 })]) {
    const s = suggestAnchors(p, DEFAULT_CONFIG);
    assert.ok(s.startConstruction > p.anchors.t0 && s.handover > s.startConstruction);
    const r = run({ ...p, anchors: { ...p.anchors, ...s } });
    assert.equal(r.tasks.filter((t) => t.conflict).length, 0, JSON.stringify(r.tasks.filter((t) => t.conflict).slice(0, 3).map((t) => [t.name, t.conflict])));
  }
});

test("lịch không rơi vào Chủ nhật / ngày lễ", () => {
  const r = run(high());
  for (const t of r.tasks.filter((x) => x.kind === "task")) {
    assert.notEqual(new Date(t.start + "T00:00:00Z").getUTCDay(), 0, `${t.name} ${t.start}`);
    assert.notEqual(new Date(t.finish + "T00:00:00Z").getUTCDay(), 0, `${t.name} ${t.finish}`);
  }
});

test("cấu trúc mpp 7.10.2026: gói thầu CUDT có 3 bước LOA → hợp đồng → tạm ứng; QSB có BOQ gói A/B", () => {
  const r = run(high());
  const names = (n: string) => r.tasks.filter((t) => t.name === n && t.ban === "PTC").length;
  assert.ok(names("Chọn thầu và phát hành LOA") > 10);
  assert.equal(names("Chọn thầu và phát hành LOA"), names("Hoàn thành hợp đồng"));
  assert.equal(names("Hoàn thành hợp đồng"), names("Hoàn thành tạm ứng"));
  assert.ok(r.tasks.some((t) => /Ngân sách gói thầu \(BOQ\) - gói B/.test(t.name)));
  assert.ok(!r.tasks.some((t) => /Quản lý thanh quyết toán \(Kiêm nhiệm\)/.test(t.name)), "cấu trúc cũ đã bị thay");
});

test("gói thầu 'nhà thấp tầng' / 'nhà cao tầng' lọc theo loại hình", () => {
  const has = (r: ReturnType<typeof run>, re: RegExp) => r.tasks.some((t) => re.test(t.name) && t.kind === "summary" || re.test(t.name));
  assert.ok(has(run(low()), /Gói thầu cọc \(nhà thấp tầng\)/));
  assert.ok(!has(run(low()), /Gói thầu cọc và tường vây \(nhà cao tầng\)/));
  assert.ok(has(run(high()), /Gói thầu cọc và tường vây \(nhà cao tầng\)/));
  assert.ok(!has(run(high()), /Gói thầu cọc \(nhà thấp tầng\)/));
});
