"use client";
// Biểu đồ SVG nhẹ (không phụ thuộc thư viện ngoài) cho Dashboard.
import { useState } from "react";

export interface BarRow { label: string; plan: number; actual: number; sub?: string }

/** So sánh Kế hoạch (xám) vs Thực tế (xanh nếu đạt, đỏ nếu chưa đạt) — cột đôi theo nhóm */
export function PlanActualBars({ rows, height = 260 }: { rows: BarRow[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <div className="py-10 text-center text-ink-mute">Chưa có dữ liệu</div>;
  const W = Math.max(520, rows.length * 78);
  const pad = { l: 40, r: 10, t: 22, b: 46 };
  const ih = height - pad.t - pad.b;
  const bw = (W - pad.l - pad.r) / rows.length;
  const y = (v: number) => pad.t + ih - (v / 100) * ih;
  return (
    <div className="overflow-x-auto">
      <svg width={W} height={height} role="img" aria-label="So sánh kế hoạch và thực tế">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="#e8edf3" strokeDasharray={g === 0 ? "" : "3 3"} />
            <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" fontSize="10" fill="#64748b">{g}%</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x0 = pad.l + i * bw + bw * 0.16;
          const w = bw * 0.32;
          const ok = r.actual >= r.plan - 2;
          return (
            <g key={r.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill={hover === i ? "#f1f5f9" : "transparent"} />
              <rect x={x0} y={y(r.plan)} width={w} height={ih - (y(r.plan) - pad.t)} rx="2" fill="#cbd5e1" />
              <rect x={x0 + w + 3} y={y(r.actual)} width={w} height={ih - (y(r.actual) - pad.t)} rx="2" fill={ok ? "#2DB34B" : "#ef4444"} />
              <text x={x0 + w / 2} y={y(r.plan) - 4} textAnchor="middle" fontSize="10" fill="#475569">{r.plan}</text>
              <text x={x0 + w * 1.5 + 3} y={y(r.actual) - 4} textAnchor="middle" fontSize="10" fontWeight="600" fill={ok ? "#15803d" : "#dc2626"}>{r.actual}</text>
              <text x={pad.l + i * bw + bw / 2} y={height - 24} textAnchor="middle" fontSize="11" fontWeight="600" fill="#334155">{r.label}</text>
              {r.sub && <text x={pad.l + i * bw + bw / 2} y={height - 10} textAnchor="middle" fontSize="9" fill="#94a3b8">{r.sub}</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-ink-mute">
        <Legend color="#cbd5e1" label="Kế hoạch (%)" />
        <Legend color="#2DB34B" label="Thực tế — đạt kế hoạch" />
        <Legend color="#ef4444" label="Thực tế — chưa đạt" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}</span>;
}

/** Đường cong S (kế hoạch lũy kế vs thực tế hiện tại) — dựng từ ngày bắt đầu/kết thúc & trọng số thời lượng */
export function SCurve({ points, today }: { points: { date: string; plan: number }[]; today: { date: string; actual: number } }) {
  if (points.length < 2) return null;
  const W = 640, H = 220, pad = { l: 40, r: 14, t: 14, b: 28 };
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const x = (d: string) => pad.l + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / 100);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.plan).toFixed(1)}`).join(" ");
  const yr = (iso: string) => iso.slice(0, 4);
  const ticks = points.filter((_, i) => i % Math.ceil(points.length / 6) === 0);
  const tx = x(today.date);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Đường cong S">
      {[0, 25, 50, 75, 100].map((g) => (<g key={g}><line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke="#e8edf3" /><text x={pad.l - 6} y={y(g) + 4} textAnchor="end" fontSize="10" fill="#64748b">{g}%</text></g>))}
      {ticks.map((p) => (<text key={p.date} x={x(p.date)} y={H - 8} textAnchor="middle" fontSize="10" fill="#64748b">{p.date.slice(5, 7)}/{yr(p.date).slice(2)}</text>))}
      <path d={path} fill="none" stroke="#94a3b8" strokeWidth="2" />
      <line x1={tx} x2={tx} y1={pad.t} y2={H - pad.b} stroke="#2563eb" strokeDasharray="4 3" />
      <circle cx={tx} cy={y(today.actual)} r="5" fill="#2DB34B" stroke="#fff" strokeWidth="2" />
      <text x={Math.min(W - 90, tx + 8)} y={y(today.actual) - 8} fontSize="11" fontWeight="700" fill="#15803d">Thực tế {today.actual}%</text>
    </svg>
  );
}
