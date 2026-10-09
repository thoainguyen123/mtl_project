// Dữ liệu mẫu (SEED) cho demo. TẤT CẢ là dữ liệu MINH HỌA, không phải số liệu thật.
import type { Db, MtlVersion, Project, ProjectParameters, Role, RoleMatrix, TaskTracking, User, Permission } from "@/lib/types";
import { ALL_PERMISSIONS } from "@/lib/types";
import { generate, suggestAnchors } from "@/lib/engine/generate";
import { DEFAULT_CONFIG } from "@/lib/engine/config";
import { WorkCalendar } from "@/lib/engine/calendar";

export const USERS: User[] = [
  { id: "u-admin", name: "Quản trị hệ thống", email: "admin@demo.local", role: "admin", title: "Admin hệ thống" },
  { id: "u-region", name: "Nguyễn Minh Khoa", email: "khoa.region@demo.local", role: "region_admin", title: "GĐ Vùng TP.HCM", region: "TP.HCM" },
  { id: "u-pm", name: "Trần Thị Lan", email: "lan.pm@demo.local", role: "project_admin", title: "Chuyên viên PMD", projectIds: ["p-aqc", "p-gmh"] },
  { id: "u-view", name: "Lê Quốc Việt", email: "viet.view@demo.local", role: "viewer", title: "Chuyên viên QSB" },
];

const all = ALL_PERMISSIONS.map((p) => p.key);
const pick = (...k: Permission[]) => k;
export const ROLE_MATRIX: RoleMatrix = {
  admin: all,
  region_admin: pick("project.create", "project.edit", "mtl.generate", "mtl.edit_task", "mtl.submit_approval", "mtl.approve", "mtl.export", "tracking.update", "tracking.comment", "design.edit", "fs.edit", "fs.approve"),
  project_admin: pick("project.edit", "mtl.generate", "mtl.edit_task", "mtl.submit_approval", "mtl.export", "tracking.update", "tracking.comment", "design.edit", "fs.edit"),
  viewer: pick("mtl.export", "tracking.comment"),
};

export const CORE_PROJECTS = [
  { code: "AQC", name: "Aqua City - Phân khu Đảo 3", investor: "Công ty CP Đầu tư Bất động sản Aqua", region: "Đồng Nai", type: "low_rise" },
  { code: "GMH", name: "Grand Manhattan - Khối B", investor: "Công ty TNHH Đầu tư Manhattan", region: "TP.HCM", type: "high_rise" },
  { code: "NWP", name: "Novaworld Phan Thiết - Giai đoạn 2", investor: "Công ty CP Địa ốc Phan Thiết", region: "Bình Thuận", type: "resort_urban" },
  { code: "PAV", name: "Park Avenue", investor: "Công ty CP Đầu tư Park", region: "TP.HCM", type: "high_rise" },
  { code: "WSB", name: "Waterside Bay", investor: "Công ty CP Waterside", region: "Bà Rịa - Vũng Tàu", type: "mixed_use" },
];
export const INVESTORS = [...new Set(CORE_PROJECTS.map((p) => p.investor)), "Công ty CP Tập đoàn Đầu tư Địa ốc (pháp nhân khác)"];
export const REGIONS = ["TP.HCM", "Đồng Nai", "Bình Thuận", "Bà Rịa - Vũng Tàu"];

const TODAY = () => new Date().toISOString().slice(0, 10);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

function makeVersion(p: ParamsPlus, projectId: string, id: string, label: string, kind: MtlVersion["kind"], rev: number, status: MtlVersion["status"], byId: string): MtlVersion {
  const by = USERS.find((u) => u.id === byId)?.name ?? byId;
  const { tasks, report } = generate({ params: p.params, config: DEFAULT_CONFIG });
  return {
    id, projectId, label, kind, rev, status, createdAt: new Date().toISOString(), createdBy: by, tasks, generation: report,
    approval: status === "approved" ? { submittedAt: new Date().toISOString(), ticket: `EA-2026-${1000 + rev}`, approvedAt: new Date().toISOString(), approver: "BOD (mô phỏng)" }
      : status === "approval_pending" ? { submittedAt: new Date().toISOString(), ticket: "EA-2026-1207" } : undefined,
  };
}

interface ParamsPlus { params: ProjectParameters }

function withSuggestedAnchors(params: ProjectParameters, extraMonths = 0): ProjectParameters {
  const s = suggestAnchors(params, DEFAULT_CONFIG);
  const cal = new WorkCalendar({ workWeek: DEFAULT_CONFIG.workWeek, holidays: DEFAULT_CONFIG.holidays });
  const pad = (d: string, n: number) => (n ? cal.shift(d, Math.round(n * 26)) : d);
  return { ...params, anchors: { ...params.anchors, startConstruction: pad(s.startConstruction, extraMonths), openSale: pad(s.openSale, extraMonths), handover: pad(s.handover, extraMonths), closeOut: pad(s.closeOut, extraMonths + 2) } };
}

export function buildSeed(): Db {
  const today = TODAY();
  const aqc = withSuggestedAnchors({
    anchors: { name: "Aqua City - Phân khu Đảo 3", code: "AQC", investor: CORE_PROJECTS[0].investor, type: "low_rise", region: "Đồng Nai", t0: "2025-08-01", startConstruction: "", openSale: "", handover: "", closeOut: "" },
    low: { units: 420, phases: 2, landHa: 38, parkM2: 12000, clubhouse: true },
    hangMuc: ["san_lap", "xu_ly_nen", "htkt", "tien_ich", "canh_quan", "tram_dien"],
  }, 1);
  const gmh = withSuggestedAnchors({
    anchors: { name: "Grand Manhattan - Khối B", code: "GMH", investor: CORE_PROJECTS[1].investor, type: "high_rise", region: "TP.HCM", t0: "2026-10-15", startConstruction: "", openSale: "", handover: "", closeOut: "" },
    high: { towers: 2, basements: 3, floors: 32, gfa: 78000, pool: true, landHa: 1.8 },
    hangMuc: ["htkt", "coc", "tien_ich", "canh_quan"],
  }, 2);
  const nwp = withSuggestedAnchors({
    anchors: { name: "Novaworld Phan Thiết - Giai đoạn 2", code: "NWP", investor: CORE_PROJECTS[2].investor, type: "resort_urban", region: "Bình Thuận", t0: "2026-06-01", startConstruction: "", openSale: "", handover: "", closeOut: "" },
    low: { units: 800, phases: 3, landHa: 120, parkM2: 30000, clubhouse: true },
    hangMuc: ["san_lap", "xu_ly_nen", "htkt", "ke", "tien_ich", "canh_quan", "tram_dien", "tram_xlnt"],
  }, 1);

  const projects: Project[] = [];
  const versions: MtlVersion[] = [];
  const mk = (id: string, params: ProjectParameters, vs: { id: string; label: string; kind: MtlVersion["kind"]; rev: number; status: MtlVersion["status"] }[], by: string) => {
    for (const v of vs) versions.push(makeVersion({ params }, id, v.id, v.label, v.kind, v.rev, v.status, by));
    projects.push({ id, params, createdAt: new Date().toISOString(), createdBy: USERS.find((u) => u.id === by)?.name ?? by, currentVersionId: vs[vs.length - 1].id });
  };
  mk("p-aqc", aqc, [
    { id: "v-aqc-1", label: "Baseline v1.0", kind: "baseline", rev: 0, status: "approved" },
    { id: "v-aqc-2", label: "REV 01 (bản thảo)", kind: "rev", rev: 1, status: "draft" },
  ], "u-pm");
  mk("p-gmh", gmh, [{ id: "v-gmh-1", label: "Bản thảo", kind: "draft", rev: 0, status: "draft" }], "u-pm");
  mk("p-nwp", nwp, [{ id: "v-nwp-1", label: "Bản thảo (đã trình)", kind: "draft", rev: 0, status: "approval_pending" }], "u-region");

  // ---- tracking giả lập cho các MTL đã duyệt / đang trình ----
  const tracking: TaskTracking[] = [];
  const comments = ["Đã nhận hồ sơ, đang rà soát.", "Chờ ý kiến phòng PLP về điều kiện cấp phép.", "Nhà thầu đã nộp bản vẽ, đang thẩm tra.", "Đề nghị gia hạn 5 ngày do thay đổi thiết kế."];
  for (const v of versions.filter((x) => x.status === "approved" || x.status === "approval_pending")) {
    for (const t of v.tasks.filter((x) => x.kind === "task")) {
      const r = hash(v.id + t.id);
      let pct = 0;
      if (t.finish! < today) pct = r < 0.94 ? 100 : Math.round(60 + r * 35);
      else if (t.start! <= today) {
        const el = (new Date(today).getTime() - new Date(t.start!).getTime()) / Math.max(86400000, new Date(t.finish!).getTime() - new Date(t.start!).getTime());
        pct = Math.max(0, Math.min(95, Math.round(el * 100 * (0.7 + r * 0.5))));
      }
      if (pct === 100) t.status = "done";
      if (pct > 0) {
        const tr: TaskTracking = { taskId: `${v.id}:${t.id}`, percent: pct, updatedAt: new Date().toISOString(), updatedBy: "Trần Thị Lan", evidence: [], comments: [] };
        if (r > 0.93) tr.comments.push({ id: `c-${t.id}`, at: new Date().toISOString(), by: "Trần Thị Lan", role: "project_admin", text: comments[Math.floor(r * 100) % comments.length] });
        if (pct < 100 && t.finish! < today) tr.issue = "Chậm do chờ phê duyệt cơ quan nhà nước";
        if (pct === 100) {
          const off = r < 0.78 ? -Math.floor(r * 4) : Math.floor(r * 7) + 1; // đa số xong đúng/sớm hạn, một phần trễ
          const d = new Date(new Date(t.finish!).getTime() + off * 86400000).toISOString().slice(0, 10);
          tr.doneAt = d > today ? today : d;
          if (r > 0.3) tr.quality = r > 0.85 ? 3 : r > 0.55 ? 4 : 5;
        }
        tracking.push(tr);
      }
    }
  }

  return {
    projects, versions, tracking, designBriefs: [], fsVersions: [], users: USERS, roleMatrix: ROLE_MATRIX, config: DEFAULT_CONFIG, templateOverrides: {},
    auditLog: [{ at: new Date().toISOString(), by: "system", action: "seed", detail: "Khởi tạo dữ liệu mẫu" }],
  };
}
export type { Role };
