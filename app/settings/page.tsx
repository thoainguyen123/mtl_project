"use client";
// Module Phân quyền (BRD 3.6) + nhật ký hoạt động. Ma trận: 4 vai trò x 12 quyền.
import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { api, fmtTime } from "@/lib/client";
import { useMe } from "@/components/Shell";
import { Badge, Card, PageTitle, Spinner, useToast, cn } from "@/components/ui";
import { ROLE_LABEL, type Permission, type Role, type RoleMatrix, type User } from "@/lib/types";

interface Resp { users: User[]; roleMatrix: RoleMatrix; permissions: { key: Permission; label: string }[]; audit: { at: string; by: string; action: string; detail?: string }[] }
const ROLES: Role[] = ["admin", "region_admin", "project_admin", "viewer"];
const DESC: Record<Role, string> = {
  admin: "Toàn quyền hệ thống, mọi vùng/dự án",
  region_admin: "Quản trị các dự án thuộc vùng được giao",
  project_admin: "Quản trị các dự án được gán",
  viewer: "Chỉ xem, trao đổi và xuất dữ liệu",
};

export default function Settings() {
  const { can, user } = useMe();
  const toast = useToast();
  const [d, setD] = useState<Resp | null>(null);
  const [m, setM] = useState<RoleMatrix | null>(null);
  const [busy, setBusy] = useState("");
  const load = () => api<Resp>("/api/users").then((r) => { setD(r); setM(structuredClone(r.roleMatrix)); });
  useEffect(() => { load(); }, []);
  if (!d || !m) return <Spinner />;
  const manage = can("users.manage");
  const dirty = JSON.stringify(m) !== JSON.stringify(d.roleMatrix);
  const toggle = (r: Role, p: Permission) => { if (!manage || r === "admin") return; setM({ ...m, [r]: m[r].includes(p) ? m[r].filter((x) => x !== p) : [...m[r], p] }); };
  const save = async () => { setBusy("save"); try { await api("/api/users", { method: "PUT", json: { roleMatrix: m } }); toast("Đã lưu ma trận phân quyền"); await load(); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); } };
  const reset = async () => {
    if (!confirm("Đặt lại toàn bộ dữ liệu demo về trạng thái ban đầu? Mọi MTL tạo thêm và tracking sẽ mất.")) return;
    setBusy("reset"); try { await api("/api/reset", { method: "POST" }); toast("Đã đặt lại dữ liệu mẫu"); setTimeout(() => window.location.assign("/"), 600); } catch (e) { toast((e as Error).message, "err"); } finally { setBusy(""); }
  };
  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      <PageTitle title="Cài đặt Hệ thống" sub="Người dùng, ma trận phân quyền (RoleMatrix) và nhật ký hoạt động" actions={can("settings.manage") ? <button className="btn-danger" disabled={busy === "reset"} onClick={reset}><RotateCcw className="h-4 w-4" /> Đặt lại dữ liệu demo</button> : undefined} />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4"><div><h2 className="text-[16px] font-semibold">Ma trận phân quyền</h2><p className="text-ink-mute">Tick để cấp quyền cho vai trò. Admin luôn đủ quyền.{!manage && " Bạn chỉ có quyền xem."}</p></div>
          {manage && <button className="btn-primary" disabled={!dirty || busy === "save"} onClick={save}>{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu thay đổi</button>}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="th"><tr><th className="px-4 py-2">Quyền</th>{ROLES.map((r) => <th key={r} className="px-4 py-2 text-center"><div>{ROLE_LABEL[r]}</div><div className="text-[10px] font-normal normal-case text-ink-mute">{DESC[r]}</div></th>)}</tr></thead>
            <tbody>
              {d.permissions.map((p) => (
                <tr key={p.key} className="border-t border-surface-line">
                  <td className="px-4 py-2">{p.label}<div className="font-mono text-[11px] text-ink-mute">{p.key}</div></td>
                  {ROLES.map((r) => <td key={r} className="px-4 py-2 text-center"><input type="checkbox" className="h-4 w-4 accent-[#2DB34B]" checked={m[r].includes(p.key)} disabled={!manage || r === "admin"} onChange={() => toggle(r, p.key)} aria-label={`${ROLE_LABEL[r]} - ${p.label}`} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden"><div className="th px-4 py-2">Người dùng (demo)</div>
          {d.users.map((u) => (
            <div key={u.id} className="flex items-center justify-between border-t border-surface-line px-4 py-2.5">
              <div><div className="font-medium">{u.name} {u.id === user.id && <Badge tone="green">Bạn</Badge>}</div><div className="text-[12px] text-ink-mute">{u.title} · {u.email}{u.region ? ` · Vùng ${u.region}` : ""}{u.projectIds ? ` · ${u.projectIds.length} dự án` : ""}</div></div>
              <Badge tone={u.role === "admin" ? "violet" : u.role === "viewer" ? "slate" : "blue"}>{ROLE_LABEL[u.role]}</Badge>
            </div>
          ))}
          <div className="border-t border-surface-line p-3 text-[12px] text-ink-mute">Prototype không có đăng nhập thật: đổi vai trò ở góc phải trên để thử quyền. Bản thật cần SSO/RBAC.</div>
        </Card>
        <Card className="overflow-hidden"><div className="th flex items-center gap-2 px-4 py-2"><ShieldCheck className="h-4 w-4" /> Nhật ký hoạt động gần đây</div>
          <div className="max-h-[360px] overflow-auto">
            {d.audit.map((a, i) => <div key={i} className={cn("border-t border-surface-line px-4 py-2 text-[13px]")}><div className="flex justify-between"><b>{a.action}</b><span className="text-ink-mute">{fmtTime(a.at)}</span></div><div className="text-ink-mute">{a.by}{a.detail ? ` — ${a.detail}` : ""}</div></div>)}
          </div>
        </Card>
      </div>
    </div>
  );
}
