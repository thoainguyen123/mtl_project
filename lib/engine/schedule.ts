// ============================================================================
// THUẬT TOÁN TÍNH TIẾN ĐỘ HAI CHIỀU (Forward & Backward Scheduling)
//  1. Forward pass: tính ES/EF từ mốc T0, tuân thủ quan hệ FS/SS/FF/SF + lag/lead
//     và ràng buộc "không bắt đầu sớm hơn" (SNET) cho từng tác vụ.
//  2. Backward pass: tính LS/LF lùi từ các hạn chót (Khởi công, Bàn giao, Kết thúc).
//  3. Các tác vụ đánh dấu ALAP (chuỗi pháp lý/thiết kế phải xong trước Khởi công,
//     chuỗi nghiệm thu trước Bàn giao) được đặt lại sát hạn rồi tính xuôi lần 2.
//  4. Float = LS - ES; float <= 0 => găng; float < 0 => xung đột mốc.
// ============================================================================
import type { Dependency } from "@/lib/types";
import { WorkCalendar, type Iso, maxIso, minIso, cmp } from "./calendar";

export interface SNode {
  id: string;
  dur: number; // ngày làm việc; 0 = mốc
  milestone?: boolean;
  fixed?: Iso; // mốc cố định (ngày)
  snet?: Iso; // không bắt đầu sớm hơn
  deadline?: Iso; // phải kết thúc không muộn hơn
  alap?: boolean; // đặt sát hạn (tính lùi)
  periodic?: boolean; // việc định kỳ: không tham gia đường găng
  postProject?: boolean; // việc vận hành sau Bàn giao: không tính vào Kết thúc dự án
  deps: Dependency[];
}

export interface SResult {
  start: Iso;
  finish: Iso;
  earlyStart: Iso; // lịch sớm nhất (trước khi đặt lại ALAP)
  earlyFinish: Iso;
  lateStart: Iso;
  lateFinish: Iso;
  floatDays: number;
  critical: boolean;
  conflict?: string;
}

export interface ScheduleOutput {
  results: Map<string, SResult>;
  warnings: string[];
  projectStart: Iso;
  projectFinish: Iso;
}

export function schedule(
  nodes: SNode[],
  cal: WorkCalendar,
  opts: { t0: Iso; end: Iso },
): ScheduleOutput {
  const warnings: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // loại bỏ phụ thuộc trỏ tới node không tồn tại
  for (const n of nodes) n.deps = n.deps.filter((d) => byId.has(d.predId) && d.predId !== n.id);

  // ---- sắp xếp topo (Kahn) + phát hiện vòng lặp ----
  const succ = new Map<string, { id: string; dep: Dependency }[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    succ.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const n of nodes) for (const d of n.deps) {
    succ.get(d.predId)!.push({ id: n.id, dep: d });
    indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
  }
  let order: string[] = [];
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of succ.get(id)!) {
      indeg.set(s.id, indeg.get(s.id)! - 1);
      if (indeg.get(s.id) === 0) queue.push(s.id);
    }
  }
  if (order.length < nodes.length) {
    const inOrder = new Set(order);
    const stuck = nodes.filter((n) => !inOrder.has(n.id));
    warnings.push(`Phát hiện vòng lặp phụ thuộc ở ${stuck.length} công việc — đã bỏ qua liên kết gây vòng để tính lịch.`);
    for (const n of stuck) n.deps = n.deps.filter((d) => inOrder.has(d.predId));
    order = [...order, ...stuck.map((n) => n.id)];
  }

  const start = new Map<string, Iso>();
  const finish = new Map<string, Iso>();

  const forward = () => {
    for (const id of order) {
      const n = byId.get(id)!;
      if (n.fixed) {
        start.set(id, n.fixed);
        finish.set(id, n.fixed);
        continue;
      }
      let es: Iso = maxIso(opts.t0, n.snet ?? opts.t0);
      for (const d of n.deps) {
        const p = byId.get(d.predId)!;
        const ps = start.get(p.id)!;
        const pf = finish.get(p.id)!;
        let cand: Iso;
        if (d.rel === "FS") {
          const base = p.milestone ? pf : cal.shift(pf, 1);
          cand = cal.shift(base, d.lag);
        } else if (d.rel === "SS") {
          cand = cal.shift(ps, d.lag);
        } else if (d.rel === "FF") {
          cand = cal.startOf(cal.shift(pf, d.lag), Math.max(1, n.dur));
        } else {
          cand = cal.startOf(cal.shift(ps, d.lag), Math.max(1, n.dur));
        }
        es = maxIso(es, cand);
      }
      es = cal.nextWork(es);
      start.set(id, es);
      finish.set(id, n.dur === 0 ? es : cal.finishOf(es, n.dur));
    }
  };

  // ---- Forward pass lần 1 ----
  forward();

  // ---- Backward pass ----
  const lateS = new Map<string, Iso>();
  const lateF = new Map<string, Iso>();
  const endLF = cal.prevWork(opts.end);
  for (const id of [...order].reverse()) {
    const n = byId.get(id)!;
    if (n.fixed) {
      lateS.set(id, n.fixed);
      lateF.set(id, n.fixed);
      continue;
    }
    const dur = Math.max(1, n.dur);
    const free = n.periodic || n.postProject;
    let lf: Iso = free ? cal.shift(endLF, 5000) : n.deadline ? minIso(n.deadline, endLF) : endLF;
    for (const s of succ.get(id)!) {
      const sn = byId.get(s.id)!;
      const sls = lateS.get(s.id)!;
      const slf = lateF.get(s.id)!;
      const d = s.dep;
      if (d.rel === "FS") {
        const lim = sn.milestone ? cal.shift(sls, -d.lag - 1) : cal.shift(sls, -1 - d.lag);
        lf = minIso(lf, lim);
      } else if (d.rel === "SS") {
        const lsLim = cal.shift(sls, -d.lag);
        lf = minIso(lf, cal.finishOf(lsLim, dur));
      } else if (d.rel === "FF") {
        lf = minIso(lf, cal.shift(slf, -d.lag));
      } else {
        lf = minIso(lf, cal.finishOf(cal.shift(slf, -d.lag), dur));
      }
    }
    lateF.set(id, lf);
    lateS.set(id, cal.startOf(lf, dur));
  }

  // ---- Đặt lại các tác vụ ALAP sát hạn (tính lùi) rồi tính xuôi lần 2 ----
  const earlyFirst = new Map(start);
  const earlyFinishMap = new Map(finish);
  for (const n of nodes) {
    if (!n.alap || n.fixed) continue;
    const ls = lateS.get(n.id)!;
    if (cmp(ls, earlyFirst.get(n.id)!) >= 0) n.snet = maxIso(n.snet ?? opts.t0, ls);
  }
  forward();

  // ---- Kết quả ----
  const results = new Map<string, SResult>();
  let pStart: Iso = opts.t0;
  let pFinish: Iso = opts.t0;
  let firstTask = true;
  for (const n of nodes) {
    const s = start.get(n.id)!;
    const f = finish.get(n.id)!;
    const ls = lateS.get(n.id)!;
    const lf = lateF.get(n.id)!;
    const fl = cal.signedDiff(earlyFirst.get(n.id)!, ls); // float theo lịch sớm nhất
    let conflict: string | undefined;
    if (!n.fixed && n.deadline && cmp(f, n.deadline) > 0) {
      conflict = `Kết thúc ${f} vượt hạn ${n.deadline} (${cal.count(n.deadline, f) - 1} ngày làm việc)`;
    } else if (!n.fixed && cmp(f, endLF) > 0 && !n.periodic && !n.postProject) {
      conflict = `Kết thúc ${f} vượt mốc Kết thúc dự án ${opts.end}`;
    } else if (!n.fixed && fl < 0 && !n.periodic && !n.postProject) {
      conflict = `Thiếu ${-fl} ngày làm việc so với hạn chót mốc`;
    }
    if (n.fixed) {
      // mốc cố định: báo xung đột nếu các việc tiền nhiệm không kịp
      let need: Iso = n.fixed;
      for (const d of n.deps) need = maxIso(need, cal.shift(finish.get(d.predId)!, 1));
      if (cmp(need, n.fixed) > 0) conflict = `Các công việc tiền nhiệm chỉ xong ${need}, chậm ${cal.count(n.fixed, need) - 1} ngày làm việc so với mục tiêu`;
    }
    const es0 = earlyFirst.get(n.id)!;
    results.set(n.id, {
      start: s, finish: f, earlyStart: es0, earlyFinish: earlyFinishMap.get(n.id)!,
      lateStart: ls, lateFinish: lf,
      floatDays: fl, critical: !n.periodic && !n.postProject && !n.fixed && fl <= 0, conflict,
    });
    if (!n.periodic && !n.postProject && !n.milestone) {
      if (firstTask || cmp(s, pStart) < 0) pStart = s;
      if (firstTask || cmp(f, pFinish) > 0) pFinish = f;
      firstTask = false;
    }
  }
  // Đường găng tương đối: chuỗi công việc có float nhỏ nhất (chuỗi quyết định ngày kết thúc dự án)
  let minFl = Infinity;
  for (const n of nodes) {
    if (n.periodic || n.postProject || n.fixed) continue;
    const r = results.get(n.id)!;
    if (r.floatDays < minFl) minFl = r.floatDays;
  }
  if (Number.isFinite(minFl)) {
    for (const n of nodes) {
      if (n.periodic || n.postProject || n.fixed) continue;
      const r = results.get(n.id)!;
      r.critical = r.floatDays <= minFl;
    }
  }
  return { results, warnings, projectStart: pStart, projectFinish: pFinish };
}
