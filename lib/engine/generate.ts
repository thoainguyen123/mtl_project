// ============================================================================
// ĐỘNG CƠ TỰ SINH MTL THAM SỐ HÓA (BRD 3.2)
//   1. Lọc task      : theo loại hình + tham số kỹ thuật (hầm = 0, thấp tầng, hồ bơi, ...)
//   2. Nhân bản      : N tháp -> N nhánh (SS + 15 ngày); K phân kỳ -> K nhánh bàn giao
//   3. Thời lượng    : định mức template x hệ số quy mô + công thức (số tầng x ngày/sàn)
//   4. Tính lịch     : forward + backward theo các mốc T0 / Khởi công / Mở bán / Bàn giao / Kết thúc
// ============================================================================
import type {
  DurationColumn, DurationConfig, Dependency, GenerationReport, HangMuc, ProjectParameters,
  TaskNode, TemplateTask, Coef, DepRel,
} from "@/lib/types";
import { HANG_MUC_LABEL } from "@/lib/types";
import { BY_CODE, CHILDREN, EXTRA_PREDS, ORDER, TAGS, TEMPLATE, descendants } from "./template";
import { WorkCalendar, type Iso } from "./calendar";
import { schedule, type SNode } from "./schedule";
import { defaultTitle } from "./config";

export interface GenerateInput {
  params: ProjectParameters;
  config: DurationConfig;
  overrides?: Record<string, { baseHigh?: number; baseLow?: number }>;
}
export interface GenerateOutput {
  tasks: TaskNode[];
  report: GenerationReport;
}

const KNOWN_HM = new Set<string>(Object.keys(HANG_MUC_LABEL));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const LETTERS = "ABCDEFGHIJ".split("");

export function durationColumn(type: ProjectParameters["anchors"]["type"]): DurationColumn {
  return type === "high_rise" || type === "mixed_use" ? "high" : "low";
}

/** Chọn hệ số theo ngưỡng; ô trống trong Excel => 1 */
const pick = (arr: Coef | undefined, idx: number): number => {
  const v = arr?.[idx];
  return typeof v === "number" && v > 0 ? v : 1;
};

interface Inst {
  id: string;
  tpl: TemplateTask;
  branch?: { root: string; idx: number; label: string };
}

export function generate(input: GenerateInput): GenerateOutput {
  const { params, config } = input;
  const A = params.anchors;
  const col = durationColumn(A.type);
  const isHigh = col === "high";
  const hi = params.high;
  const lo = params.low;
  const towers = isHigh ? clamp(hi?.towers ?? 1, 1, 10) : 1;
  const basements = isHigh ? hi?.basements ?? 0 : 0;
  const floors = isHigh ? hi?.floors ?? 25 : 0;
  const phases = !isHigh ? clamp(lo?.phases ?? 1, 1, 5) : 1;
  const selectedHm = new Set<string>(params.hangMuc);
  const warnings: string[] = [];

  // ---------------------------------------------------------------- 1. LỌC TASK
  const dropReason = new Map<string, string>();
  const included = new Set<string>();

  const dropRule = (t: TemplateTask): string | null => {
    const tags = TAGS.get(t.code) ?? [];
    if (isHigh && tags.includes("lowrise_branch")) return "Loại hình cao tầng: bỏ nhánh thấp tầng";
    if (!isHigh && tags.includes("highrise_branch")) return "Loại hình thấp tầng: bỏ 100% nhánh cao tầng";
    if (!t.applies[col]) return "Không áp dụng cho loại hình này (theo template Excel)";
    if (isHigh && basements === 0 && tags.includes("basement")) return "Số tầng hầm = 0: bỏ nhánh tường vây / shoring / đào hầm";
    if (isHigh && basements < 2 && tags.includes("basement_deep")) return "Số tầng hầm < 2: bỏ quan trắc chuyển vị sâu / hạ mực nước";
    if (isHigh && !hi?.pool && tags.includes("pool")) return "Không có hồ bơi: bỏ nhánh hồ bơi";
    const hm = (t.hangmuc ?? []).filter((h) => KNOWN_HM.has(h));
    if (!isHigh && lo && !lo.clubhouse && hm.includes("tien_ich")) return "Không có Clubhouse / tiện ích: bỏ công trình tiện ích";
    if (!isHigh && lo && lo.parkM2 <= 0 && hm.includes("canh_quan")) return "Không có công viên cảnh quan: bỏ nhánh cảnh quan";
    for (const h of hm) if (!selectedHm.has(h)) return `Hạng mục “${HANG_MUC_LABEL[h as HangMuc]}” không triển khai`;
    return null;
  };

  for (const t of TEMPLATE) {
    if (t.kind === "summary") continue;
    const r = dropRule(t);
    if (r) dropReason.set(t.code, r);
    else included.add(t.code);
  }
  for (const t of TEMPLATE) {
    if (t.kind !== "summary") continue;
    if (descendants(t.code).some((d) => included.has(d.code))) included.add(t.code);
    else dropReason.set(t.code, "Nhóm rỗng sau khi lọc");
  }

  // ---------------------------------------------------------------- 2. NHÂN BẢN
  interface Branch { root: string; copies: number; label: (i: number) => string; stagger: number; rule: string }
  const branches: Branch[] = [];
  if (isHigh && towers >= 2 && included.has("13.8.1")) {
    branches.push({
      root: "13.8.1", copies: towers, label: (i) => `Tháp ${LETTERS[i]}`,
      stagger: config.towerStaggerDays, rule: `Nhân bản ${towers} tháp (quan hệ cuốn chiếu SS + ${config.towerStaggerDays} ngày)`,
    });
  }
  if (!isHigh && phases >= 2) {
    if (included.has("13.7.1")) branches.push({
      root: "13.7.1", copies: phases, label: (i) => `Phân kỳ ${i + 1}`,
      stagger: config.phaseStaggerDays, rule: `Nhân bản ${phases} phân kỳ — thi công nhà thấp tầng`,
    });
    if (included.has("13.12.1")) branches.push({
      root: "13.12.1", copies: phases, label: (i) => `Bàn giao đợt ${i + 1}`,
      stagger: config.phaseStaggerDays, rule: `Nhân bản ${phases} nhánh nghiệm thu & bàn giao (Đợt 1..${phases})`,
    });
  }
  const branchOf = (code: string): Branch | undefined =>
    branches.find((b) => code === b.root || code.startsWith(b.root + "."));

  const instances = new Map<string, Inst[]>();
  const instById = new Map<string, Inst>();
  const addInst = (i: Inst) => {
    if (!instances.has(i.tpl.code)) instances.set(i.tpl.code, []);
    instances.get(i.tpl.code)!.push(i);
    instById.set(i.id, i);
  };
  for (const t of TEMPLATE) {
    if (!included.has(t.code)) continue;
    const b = branchOf(t.code);
    if (b) for (let k = 0; k < b.copies; k++) addInst({ id: `${t.code}@${k + 1}`, tpl: t, branch: { root: b.root, idx: k, label: b.label(k) } });
    else addInst({ id: t.code, tpl: t });
  }

  const instName = (i: Inst) => (i.branch ? `${i.tpl.name} - ${i.branch.label}` : i.tpl.name);
  const instWbs = (i: Inst) => {
    if (!i.branch) return i.tpl.wbs;
    const rootWbs = BY_CODE.get(i.branch.root)!.wbs.split(".");
    const newRoot = [...rootWbs.slice(0, -1), String(i.branch.idx + 1)].join(".");
    const oldRoot = rootWbs.join(".");
    return i.tpl.wbs === oldRoot ? newRoot : i.tpl.wbs.startsWith(oldRoot + ".") ? newRoot + i.tpl.wbs.slice(oldRoot.length) : i.tpl.wbs;
  };
  const parentOf = (i: Inst): string | undefined => {
    const p = i.tpl.parent;
    if (!p) return undefined;
    const pinsts = instances.get(p);
    if (!pinsts || pinsts.length === 0) return undefined;
    if (i.branch && i.tpl.code !== i.branch.root) {
      const same = pinsts.find((x) => x.branch?.idx === i.branch!.idx && x.branch?.root === i.branch!.root);
      if (same) return same.id;
    }
    return pinsts[0].id;
  };

  // ---------------------------------------------------------------- 3. THỜI LƯỢNG
  const durNote = new Map<string, string>();
  const baseOf = new Map<string, number>();
  const computeDuration = (i: Inst): number => {
    const t = i.tpl;
    const ov = input.overrides?.[t.code];
    let base = (col === "high" ? ov?.baseHigh : ov?.baseLow) ?? t.base?.[col];
    const notes: string[] = [];
    if (!base || base <= 0) {
      baseOf.set(i.id, 0);
      durNote.set(i.id, "Template chưa có định mức → tạm 1 ngày [CẦN BỔ SUNG]");
      return 1;
    }
    baseOf.set(i.id, base);
    let d = base;
    notes.push(`định mức ${base} ngày`);
    const tags = TAGS.get(t.code) ?? [];
    if (isHigh && t.code === "13.8.1.2") {
      d = floors * config.daysPerFloor;
      notes.length = 0;
      notes.push(`công thức: ${floors} tầng nổi × ${config.daysPerFloor} ngày/sàn`);
    } else if (isHigh && t.code === "13.8.1.1") {
      d = (base * basements) / Math.max(1, config.basementBaseCount);
      notes.push(`× ${basements}/${config.basementBaseCount} (tầng hầm / hầm chuẩn của định mức)`);
    } else {
      let f = 1;
      if (isHigh) {
        const land = hi?.landHa ?? 1;
        const lf = pick(t.coef?.high?.land, land <= 1 ? 0 : 1);
        const ff = pick(t.coef?.high?.floors, floors <= 24 ? 0 : floors <= 50 ? 1 : 2);
        f = lf * ff;
        if (lf !== 1) notes.push(`× ${lf} (đất ${land > 1 ? ">" : "≤"}1ha)`);
        if (ff !== 1) notes.push(`× ${ff} (${floors} tầng)`);
        if (tags.includes("gfa_scaled")) {
          const g = clamp((hi?.gfa ?? config.gfaReference) / config.gfaReference, config.gfaMin, config.gfaMax);
          if (Math.abs(g - 1) > 0.001) { f *= g; notes.push(`× ${g.toFixed(2)} (GFA ${(hi?.gfa ?? 0).toLocaleString("vi-VN")} m²)`); }
        }
      } else {
        const land = lo?.landHa ?? 0;
        const perPhase = Math.round((lo?.units ?? 0) / phases);
        const lf = pick(t.coef?.low?.land, land < 100 ? 0 : land <= 300 ? 1 : 2);
        const qf = pick(t.coef?.low?.qty, perPhase < 100 ? 0 : perPhase <= 1000 ? 1 : 2);
        f = lf * qf;
        if (lf !== 1) notes.push(`× ${lf} (đất ${land} ha)`);
        if (qf !== 1) notes.push(`× ${qf} (${perPhase} căn/phân kỳ)`);
      }
      d = base * f;
    }
    if (config.includeBuffer && t.buffer) { d += t.buffer; notes.push(`+ ${t.buffer} ngày dự phòng`); }
    durNote.set(i.id, notes.join(" "));
    return Math.max(1, Math.round(d));
  };

  // ---------------------------------------------------------------- QUAN HỆ PHỤ THUỘC
  const resolveCode = (code: string, seen = new Set<string>()): string[] => {
    if (seen.has(code)) return [];
    seen.add(code);
    const t = BY_CODE.get(code);
    if (!t) return [];
    if (included.has(code)) return t.kind === "summary" ? descendants(code).filter((d) => d.kind !== "summary" && included.has(d.code)).map((d) => d.code) : [code];
    if (t.kind === "summary") return [];
    const out: string[] = [];
    for (const p of [t.pred, ...(EXTRA_PREDS[code] ?? [])]) if (p) out.push(...resolveCode(p.code, seen));
    return out;
  };

  const depsOf = (i: Inst): Dependency[] => {
    const raw: { code: string; rel: DepRel }[] = [];
    if (i.tpl.pred) raw.push(i.tpl.pred);
    for (const e of EXTRA_PREDS[i.tpl.code] ?? []) raw.push(e);
    const out: Dependency[] = [];
    const seen = new Set<string>();
    for (const p of raw) {
      const direct = included.has(p.code);
      for (const c of resolveCode(p.code)) {
        const rel: DepRel = direct ? p.rel : "FS";
        const insts = instances.get(c) ?? [];
        const sameBranch = i.branch ? insts.find((x) => x.branch?.root === i.branch!.root && x.branch.idx === i.branch!.idx) : undefined;
        for (const x of sameBranch ? [sameBranch] : insts) {
          if (x.id === i.id) continue;
          const key = `${x.id}|${rel}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ predId: x.id, rel, lag: 0 });
        }
      }
    }
    return out;
  };

  // ---------------------------------------------------------------- DỰNG NODE LÁ + MỐC
  const leafInsts = [...instById.values()].filter((i) => i.tpl.kind !== "summary");
  const depsMap = new Map<string, Dependency[]>();
  for (const i of leafInsts) depsMap.set(i.id, depsOf(i));

  // Quan hệ so le giữa các bản sao (tháp: SS + 15; phân kỳ: SS + 60)
  const stagger: { rule: string; copies: number; added: number }[] = [];
  for (const b of branches) {
    let added = 0;
    for (let k = 1; k < b.copies; k++) {
      for (const i of leafInsts) {
        if (!i.branch || i.branch.root !== b.root || i.branch.idx !== k) continue;
        const inBranchPred = (depsMap.get(i.id) ?? []).some((d) => instById.get(d.predId)?.branch?.root === b.root && instById.get(d.predId)?.branch?.idx === k);
        if (inBranchPred) continue;
        const prev = instances.get(i.tpl.code)!.find((x) => x.branch!.idx === k - 1)!;
        depsMap.get(i.id)!.push({ predId: prev.id, rel: "SS", lag: b.stagger });
      }
    }
    const base = descendants(b.root).filter((d) => included.has(d.code)).length + 1;
    added = base * (b.copies - 1);
    stagger.push({ rule: b.rule, copies: b.copies, added });
  }

  const isoOf = (s: string): Iso => s;
  const MS = {
    T0: { id: "M_T0", name: "Bắt đầu dự án (T₀)", date: isoOf(A.t0), anchor: "T0" as const },
    KC: { id: "M_KC", name: "Khởi công", date: isoOf(A.startConstruction), anchor: "KC" as const },
    MB: { id: "M_MB", name: "Mở bán", date: isoOf(A.openSale), anchor: "MB" as const },
    BG: { id: "M_BG", name: "Bàn giao", date: isoOf(A.handover), anchor: "BG" as const },
    KT: { id: "M_KT", name: "Kết thúc hoàn toàn", date: isoOf(A.closeOut), anchor: "KT" as const },
  };

  const tagsOfInst = (i: Inst) => TAGS.get(i.tpl.code) ?? [];
  const gate = leafInsts.filter((i) => tagsOfInst(i).includes("gate_kc"));
  const found = leafInsts.filter((i) => tagsOfInst(i).includes("foundation"));
  const handover = leafInsts.filter((i) => tagsOfInst(i).includes("handover_chain"));
  const openSale = leafInsts.filter((i) => tagsOfInst(i).includes("open_sale"));
  const closeout = leafInsts.filter((i) => tagsOfInst(i).includes("closeout"));
  const isConstruction = (i: Inst) => i.tpl.code.startsWith("13.");

  // vùng tiền khởi công = các tác vụ gate + toàn bộ tiền nhiệm (đặt sát hạn Khởi công)
  const preZone = new Set<string>();
  const stack = gate.map((g) => g.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (preZone.has(id)) continue;
    preZone.add(id);
    for (const d of depsMap.get(id) ?? []) stack.push(d.predId);
  }

  const snodes: SNode[] = [];
  const dur = new Map<string, number>();
  for (const i of leafInsts) {
    const d = computeDuration(i);
    dur.set(i.id, d);
    const deps = [...(depsMap.get(i.id) ?? [])];
    const n: SNode = { id: i.id, dur: d, deps, periodic: i.tpl.kind === "periodic" };
    if (isConstruction(i)) deps.push({ predId: MS.KC.id, rel: "FS", lag: 0 });
    if (tagsOfInst(i).includes("open_sale")) deps.push({ predId: MS.MB.id, rel: "FS", lag: 0 });
    if (tagsOfInst(i).includes("closeout")) deps.push({ predId: MS.BG.id, rel: "FS", lag: 0 });
    if (tagsOfInst(i).includes("post_project")) { n.postProject = true; deps.push({ predId: MS.BG.id, rel: "FS", lag: 0 }); }
    if (preZone.has(i.id) && n.periodic !== true) n.alap = true;
    if (tagsOfInst(i).includes("handover_chain")) { n.alap = true; n.deadline = MS.BG.date; }
    snodes.push(n);
  }
  const mkMilestone = (m: { id: string; date: Iso }, deps: Dependency[]): SNode => ({ id: m.id, dur: 0, milestone: true, fixed: m.date, deps });
  snodes.push(
    mkMilestone(MS.T0, []),
    mkMilestone(MS.KC, gate.map((g) => ({ predId: g.id, rel: "FS" as DepRel, lag: 0 }))),
    mkMilestone(MS.MB, found.map((g) => ({ predId: g.id, rel: "FS" as DepRel, lag: 0 }))),
    mkMilestone(MS.BG, handover.map((g) => ({ predId: g.id, rel: "FS" as DepRel, lag: 0 }))),
    mkMilestone(MS.KT, closeout.map((g) => ({ predId: g.id, rel: "FS" as DepRel, lag: 0 }))),
  );

  // ---------------------------------------------------------------- 4. TÍNH LỊCH
  const cal = new WorkCalendar({ workWeek: config.workWeek, holidays: config.holidays });
  const sched = schedule(snodes, cal, { t0: A.t0, end: A.closeOut });
  warnings.push(...sched.warnings);

  // ---------------------------------------------------------------- DỰNG TaskNode (cây + tổng hợp)
  const nodes = new Map<string, TaskNode>();
  const childrenOf = new Map<string, string[]>();
  const link = (pid: string | undefined, id: string) => {
    const k = pid ?? "__root__";
    if (!childrenOf.has(k)) childrenOf.set(k, []);
    childrenOf.get(k)!.push(id);
  };
  const sortKey = (i: Inst) => (ORDER.get(i.tpl.code) ?? 0) * 100 + (i.branch?.idx ?? 0);

  const insts = [...instById.values()].sort((a, b) => sortKey(a) - sortKey(b));
  for (const i of insts) {
    const leaf = i.tpl.kind !== "summary";
    const r = leaf ? sched.results.get(i.id) : undefined;
    nodes.set(i.id, {
      id: i.id, templateCode: i.tpl.code, wbs: instWbs(i), name: instName(i), level: i.tpl.level + 1,
      parentId: parentOf(i), order: 0, ban: i.tpl.ban,
      kind: i.tpl.kind, deps: leaf ? depsMap.get(i.id) ?? [] : [],
      durationDays: leaf ? dur.get(i.id)! : 0,
      baseDays: leaf ? baseOf.get(i.id) : undefined,
      durationNote: leaf ? durNote.get(i.id) : undefined,
      start: r?.start, finish: r?.finish, earlyStart: r?.earlyStart, earlyFinish: r?.earlyFinish,
      lateStart: r?.lateStart, lateFinish: r?.lateFinish,
      floatDays: r?.floatDays, critical: r?.critical, conflict: r?.conflict,
      copyLabel: i.branch?.label, status: "in_progress", assigneeTitle: defaultTitle(i.tpl.ban),
      tags: [...(TAGS.get(i.tpl.code) ?? []), ...(i.tpl.demoSupplement ? ["demo_supplement"] : [])],
    });
    link(parentOf(i), i.id);
  }
  // gắn các phụ thuộc vào mốc cho leaf đã được thêm trong snodes (hiển thị)
  for (const s of snodes) {
    const n = nodes.get(s.id);
    if (n) n.deps = s.deps;
  }

  // nhóm "MỐC DỰ ÁN"
  nodes.set("M_ROOT", {
    id: "M_ROOT", templateCode: "M_ROOT", wbs: "0", name: "MỐC DỰ ÁN", level: 1, order: 0, kind: "summary",
    deps: [], durationDays: 0, status: "in_progress",
  });
  childrenOf.set("M_ROOT", []);
  for (const m of Object.values(MS)) {
    const r = sched.results.get(m.id)!;
    nodes.set(m.id, {
      id: m.id, templateCode: m.id, wbs: `0.${["T0", "KC", "MB", "BG", "KT"].indexOf(m.anchor) + 1}`, name: m.name, level: 2, parentId: "M_ROOT", order: 0,
      kind: "milestone", deps: snodes.find((s) => s.id === m.id)!.deps, durationDays: 0, start: m.date, finish: m.date,
      lateStart: r.lateStart, lateFinish: r.lateFinish, floatDays: 0, conflict: r.conflict, status: "in_progress", anchor: m.anchor,
    });
    childrenOf.get("M_ROOT")!.push(m.id);
  }

  // tổng hợp ngày cho nhóm (từ dưới lên)
  const rollup = (id: string): { s?: Iso; f?: Iso; crit: boolean } => {
    const n = nodes.get(id)!;
    const kids = childrenOf.get(id) ?? [];
    if (n.kind !== "summary") return { s: n.start, f: n.finish, crit: !!n.critical };
    let s: Iso | undefined, f: Iso | undefined, crit = false;
    for (const k of kids) {
      const r = rollup(k);
      if (r.s && (!s || r.s < s)) s = r.s;
      if (r.f && (!f || r.f > f)) f = r.f;
      crit = crit || r.crit;
    }
    n.start = s; n.finish = f; n.critical = crit;
    n.durationDays = s && f ? cal.count(s, f) : 0;
    return { s, f, crit };
  };
  const rootIds = childrenOf.get("__root__") ?? [];
  const ordered: TaskNode[] = [];
  const emit = (id: string) => {
    const n = nodes.get(id)!;
    n.order = ordered.length;
    ordered.push(n);
    for (const k of childrenOf.get(id) ?? []) emit(k);
  };
  childrenOf.set("__root__", ["M_ROOT", ...rootIds]);
  for (const id of ["M_ROOT", ...rootIds]) rollup(id);
  for (const id of ["M_ROOT", ...rootIds]) emit(id);

  // ---------------------------------------------------------------- BÁO CÁO
  const removedByRule = new Map<string, number>();
  for (const [code, rule] of dropReason) {
    const t = BY_CODE.get(code)!;
    if (t.kind === "summary" && rule === "Nhóm rỗng sau khi lọc") continue;
    removedByRule.set(rule, (removedByRule.get(rule) ?? 0) + 1);
  }
  const emptyGroups = [...dropReason].filter(([c, r]) => BY_CODE.get(c)!.kind === "summary" && r === "Nhóm rỗng sau khi lọc").length;
  const removedList = [...removedByRule].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count);
  if (emptyGroups) removedList.push({ rule: "Nhóm cha rỗng sau khi lọc", count: emptyGroups });

  const conflicts = ordered.filter((n) => n.conflict);
  if (conflicts.length) warnings.push(`${conflicts.length} công việc/mốc vi phạm ràng buộc mốc — xem cột “Cảnh báo” trong lưới WBS.`);
  const noDur = leafInsts.filter((i) => !baseOf.get(i.id)).length;
  if (noDur) warnings.push(`${noDur} công việc chưa có định mức trong template (tạm 1 ngày) [CẦN BỔ SUNG].`);
  if (A.type === "mixed_use") warnings.push("Phức hợp thương mại: template Excel chưa có cột hệ số riêng — tạm dùng bộ định mức chung cư cao tầng [CẦN XÁC NHẬN].");
  const supp = [...instById.values()].filter((i) => i.tpl.demoSupplement).length;
  if (supp) warnings.push(`${supp} tác vụ tầng hầm là MINH HỌA do demo bổ sung (không có trong Excel) — để chứng minh quy tắc “hầm = 0”.`);
  if (isHigh && A.openSale && sched.results.get("M_MB")?.conflict) warnings.push("Điều kiện mở bán: phần móng chưa hoàn thành trước ngày mở bán mục tiêu.");

  const report: GenerationReport = {
    generatedAt: new Date().toISOString(),
    templateTasks: TEMPLATE.length,
    included: ordered.filter((n) => n.kind !== "milestone" && n.id !== "M_ROOT").length,
    removed: dropReason.size,
    duplicated: stagger.reduce((s, x) => s + x.added, 0),
    removedByRule: removedList,
    duplications: stagger.map((s) => ({ rule: s.rule, copies: s.copies, addedTasks: s.added })),
    warnings,
    projectStart: sched.projectStart,
    projectFinish: sched.projectFinish,
    criticalCount: ordered.filter((n) => n.critical && n.kind === "task").length,
  };
  return { tasks: ordered, report };
}

// ============================================================================
// GỢI Ý MỐC KHẢ THI — chạy tính xuôi (forward) với mốc nới lỏng để biết
// khung thời gian tối thiểu mà template + tham số hiện tại đòi hỏi.
//   Khởi công >= xong toàn bộ pháp lý/thiết kế cổng
//   Mở bán    >= xong phần móng (điều kiện mở bán theo luật KDBĐS)
//   Bàn giao  >= xong thi công + nghiệm thu
//   Kết thúc  >= xong thanh quyết toán / cấp sổ
// ============================================================================
export interface AnchorSuggestion {
  startConstruction: string;
  openSale: string;
  handover: string;
  closeOut: string;
  note: string;
}
export function suggestAnchors(params: ProjectParameters, config: DurationConfig): AnchorSuggestion {
  const cal = new WorkCalendar({ workWeek: config.workWeek, holidays: config.holidays });
  const t0 = params.anchors.t0;
  const FAR = cal.shift(t0, 12000);
  const run = (kc: string, bg: string, kt: string) =>
    generate({ params: { ...params, anchors: { ...params.anchors, startConstruction: kc, openSale: FAR, handover: bg, closeOut: kt } }, config }).tasks;
  const maxFin = (ts: TaskNode[], f: (t: TaskNode) => boolean, key: "earlyFinish" | "finish" = "earlyFinish") =>
    ts.filter((t) => f(t) && (t.kind === "task")).reduce<string>((m, t) => ((t[key] ?? "") > m ? (t[key] as string) : m), t0);

  const p1 = run(FAR, FAR, FAR);
  const gateFin = maxFin(p1, (t) => !!t.tags?.includes("gate_kc"));
  const kc = cal.shift(gateFin, 2);

  const p2 = run(kc, FAR, FAR);
  const mb = cal.shift(maxFin(p2, (t) => !!t.tags?.includes("foundation")), 2);
  const bg = cal.shift(maxFin(p2, (t) => t.templateCode.startsWith("13.") && !t.tags?.includes("handover_chain") && t.kind === "task"), 45 + 2);

  const p3 = run(kc, bg, FAR);
  const kt = cal.shift(
    maxFin(p3, (t) => !!t.tags?.includes("closeout") || !!t.tags?.includes("handover_chain"), "earlyFinish"), 5,
  );
  return {
    startConstruction: kc, openSale: mb, handover: bg, closeOut: kt > bg ? kt : cal.shift(bg, 130),
    note: "Mốc tối thiểu để template + tham số hiện tại không xung đột (đã cộng đệm ~2 ngày; bàn giao +45 ngày nghiệm thu). Có thể nới rộng theo chiến lược của dự án.",
  };
}

// ============================================================================
// TÍNH LẠI LỊCH khi người dùng sửa thời lượng / liên kết / trạng thái (không sinh lại cây)
// ============================================================================
export function reschedule(tasks: TaskNode[], anchors: ProjectParameters["anchors"], config: DurationConfig): { tasks: TaskNode[]; warnings: string[]; projectStart: string; projectFinish: string } {
  const cal = new WorkCalendar({ workWeek: config.workWeek, holidays: config.holidays });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const leaves = tasks.filter((t) => t.kind !== "summary");
  const fixed: Record<string, string> = { M_T0: anchors.t0, M_KC: anchors.startConstruction, M_MB: anchors.openSale, M_BG: anchors.handover, M_KT: anchors.closeOut };

  // vùng tiền Khởi công: tác vụ cổng + toàn bộ tiền nhiệm
  const pre = new Set<string>();
  const stack = leaves.filter((t) => t.tags?.includes("gate_kc")).map((t) => t.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (pre.has(id)) continue;
    pre.add(id);
    for (const d of byId.get(id)?.deps ?? []) stack.push(d.predId);
  }
  const nodes: SNode[] = leaves.map((t) => {
    const isMs = t.kind === "milestone";
    const n: SNode = {
      id: t.id, dur: isMs ? 0 : t.status === "closed" ? 0 : Math.max(1, t.durationDays), milestone: isMs,
      fixed: isMs ? fixed[t.id] ?? t.start : undefined,
      periodic: t.kind === "periodic", postProject: !!t.tags?.includes("post_project"),
      deps: t.deps.map((d) => ({ ...d })),
    };
    if (!isMs && pre.has(t.id) && !n.periodic) n.alap = true;
    if (t.tags?.includes("handover_chain")) { n.alap = true; n.deadline = fixed.M_BG; }
    return n;
  });
  const sched = schedule(nodes, cal, { t0: anchors.t0, end: anchors.closeOut });
  for (const t of leaves) {
    const r = sched.results.get(t.id)!;
    t.start = r.start; t.finish = r.finish; t.earlyStart = r.earlyStart; t.earlyFinish = r.earlyFinish;
    t.lateStart = r.lateStart; t.lateFinish = r.lateFinish; t.floatDays = r.floatDays; t.critical = r.critical; t.conflict = r.conflict;
  }
  // tổng hợp lại nhóm cha
  const kids = new Map<string, TaskNode[]>();
  for (const t of tasks) if (t.parentId) { if (!kids.has(t.parentId)) kids.set(t.parentId, []); kids.get(t.parentId)!.push(t); }
  const roll = (t: TaskNode): void => {
    if (t.kind !== "summary") return;
    let s: string | undefined, f: string | undefined, crit = false;
    for (const k of kids.get(t.id) ?? []) {
      roll(k);
      if (k.start && (!s || k.start < s)) s = k.start;
      if (k.finish && (!f || k.finish > f)) f = k.finish;
      crit = crit || !!k.critical;
    }
    t.start = s; t.finish = f; t.critical = crit; t.durationDays = s && f ? cal.count(s, f) : 0;
  };
  for (const t of tasks.filter((x) => !x.parentId)) roll(t);
  return { tasks, warnings: sched.warnings, projectStart: sched.projectStart, projectFinish: sched.projectFinish };
}
