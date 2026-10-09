"use client";
// Tờ trình điện tử MÔ PHỎNG (BRD bước 5): xem trước & in/lưu PDF bằng trình duyệt.
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { api, fmtDate } from "@/lib/client";
import { Spinner } from "@/components/ui";
import { PROJECT_TYPE_LABEL, type MtlVersion, type Project, type TaskNode } from "@/lib/types";

export default function ToTrinh() {
  const { pid } = useParams<{ pid: string }>();
  const sp = useSearchParams();
  const [d, setD] = useState<{ version: MtlVersion; project: Project } | null>(null);
  useEffect(() => {
    (async () => {
      const p = await api<{ project: Project }>(`/api/projects/${pid}`);
      setD(await api(`/api/versions/${sp.get("v") ?? p.project.currentVersionId}`));
    })();
  }, [pid, sp]);
  if (!d) return <Spinner />;
  const { version: v, project } = d;
  const A = project.params.anchors;
  const ms = v.tasks.filter((t) => t.kind === "milestone");
  const groups = new Map<string, { n: number; s: string; f: string; crit: number }>();
  for (const t of v.tasks.filter((x: TaskNode) => x.kind === "task" && x.ban && x.status !== "closed")) {
    const g = groups.get(t.ban!) ?? { n: 0, s: t.start!, f: t.finish!, crit: 0 };
    g.n++; if (t.start! < g.s) g.s = t.start!; if (t.finish! > g.f) g.f = t.finish!; if (t.critical) g.crit++;
    groups.set(t.ban!, g);
  }
  const g = v.generation;
  return (
    <div className="mx-auto max-w-[820px]">
      <div className="no-print mb-3 flex justify-end"><button className="btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> In / Lưu PDF</button></div>
      <article className="card bg-white p-10 leading-relaxed" style={{ fontFamily: "'Times New Roman', serif", fontSize: 15 }}>
        <div className="mb-1 text-center text-[12px] uppercase text-ink-mute">Bản xem trước — mô phỏng kết xuất E-Approval (prototype)</div>
        <h1 className="text-center text-[20px] font-bold uppercase">Tờ trình phê duyệt Master Timeline</h1>
        <p className="text-center">Mã tờ trình: <b>{v.approval?.ticket ?? "(chưa trình — sẽ cấp khi trình E-Approval)"}</b> · Phiên bản: <b>{v.label}</b></p>
        <p className="mt-4"><b>Kính gửi:</b> Ban Tổng Giám đốc.</p>
        <p className="mt-2 text-justify">Phòng Quản lý dự án (PMD) kính trình Ban Tổng Giám đốc xem xét, phê duyệt Master Timeline (MTL) của dự án <b>{A.name}</b> ({A.code}) với các nội dung chính như sau:</p>
        <h2 className="mt-4 font-bold">1. Thông tin dự án</h2>
        <table className="mt-1 w-full border-collapse text-[14px]"><tbody>
          {[["Chủ đầu tư / Pháp nhân", A.investor], ["Loại hình", PROJECT_TYPE_LABEL[A.type]], ["Vùng / Địa bàn", A.region], ["Thời gian dự kiến", `${fmtDate(g?.projectStart ?? A.t0)} → ${fmtDate(g?.projectFinish ?? A.closeOut)}`], ["Số công việc trong MTL", `${v.tasks.filter((t) => t.kind === "task").length} (đường găng: ${g?.criticalCount ?? 0})`]].map(([k, val]) => <tr key={k}><td className="w-56 border border-slate-400 px-2 py-1 font-semibold">{k}</td><td className="border border-slate-400 px-2 py-1">{val}</td></tr>)}
        </tbody></table>
        <h2 className="mt-4 font-bold">2. Các mốc dự án chính</h2>
        <table className="mt-1 w-full border-collapse text-[14px]"><thead><tr className="bg-slate-100"><th className="border border-slate-400 px-2 py-1 text-left">Mốc</th><th className="border border-slate-400 px-2 py-1">Ngày</th><th className="border border-slate-400 px-2 py-1 text-left">Ghi chú</th></tr></thead><tbody>
          {ms.map((m) => <tr key={m.id}><td className="border border-slate-400 px-2 py-1">{m.name}</td><td className="border border-slate-400 px-2 py-1 text-center">{fmtDate(m.start)}</td><td className="border border-slate-400 px-2 py-1">{m.conflict ?? "Đạt"}</td></tr>)}
        </tbody></table>
        <h2 className="mt-4 font-bold">3. Tiến độ theo Ban / Phòng chịu trách nhiệm</h2>
        <table className="mt-1 w-full border-collapse text-[14px]"><thead><tr className="bg-slate-100"><th className="border border-slate-400 px-2 py-1 text-left">Ban / Phòng</th><th className="border border-slate-400 px-2 py-1">Số việc</th><th className="border border-slate-400 px-2 py-1">Bắt đầu</th><th className="border border-slate-400 px-2 py-1">Kết thúc</th><th className="border border-slate-400 px-2 py-1">Việc găng</th></tr></thead><tbody>
          {[...groups].sort((a, b) => b[1].n - a[1].n).map(([ban, x]) => <tr key={ban}><td className="border border-slate-400 px-2 py-1">{ban}</td><td className="border border-slate-400 px-2 py-1 text-center">{x.n}</td><td className="border border-slate-400 px-2 py-1 text-center">{fmtDate(x.s)}</td><td className="border border-slate-400 px-2 py-1 text-center">{fmtDate(x.f)}</td><td className="border border-slate-400 px-2 py-1 text-center">{x.crit}</td></tr>)}
        </tbody></table>
        {g && g.warnings.length > 0 && (<><h2 className="mt-4 font-bold">4. Lưu ý</h2><ul className="list-inside list-disc text-[14px]">{g.warnings.map((w) => <li key={w}>{w}</li>)}</ul></>)}
        <p className="mt-4">Kính trình Ban Tổng Giám đốc xem xét, phê duyệt.</p>
        <div className="mt-8 grid grid-cols-4 gap-2 text-center text-[13px]">
          {[["Đề xuất", "HEAD PHÒNG"], ["Xem xét", "GĐ ĐIỀU HÀNH KHU VỰC"], ["Xem xét", "PHÓ TỔNG GIÁM ĐỐC"], ["Phê duyệt", "TỔNG GIÁM ĐỐC"]].map(([a, b]) => <div key={b}><div className="font-bold">{a}</div><div>{b}</div><div className="mt-14 text-ink-mute">Ngày: …/…/……</div></div>)}
        </div>
      </article>
    </div>
  );
}
