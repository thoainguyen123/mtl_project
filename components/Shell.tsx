"use client";
// Khung giao diện 3 khu vực (BRD 2.2), bám layout https://gmsp-dev.novagroup.vn:
//  1. Sidebar cố định bên trái 250px, nền #002B60, mục đang chọn tô xanh lá
//  2. Topbar 56px: nút đóng/mở menu, breadcrumb, người dùng
//  3. Main Workspace chiếm phần còn lại (~85% màn hình)
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarRange, ChevronDown, ChevronRight, Building2, ClipboardList, FileSpreadsheet, FolderKanban, Home, Layers, PanelLeft, Send, ClipboardCheck, Settings2, ShieldCheck, Activity } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import type { Permission, Role, User } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";
import { Badge, ToastProvider, cn } from "./ui";

interface Me { user: User; permissions: Permission[]; users: User[] }
interface MeCtx extends Me { can: (p: Permission) => boolean; reload: () => Promise<void> }
const Ctx = createContext<MeCtx | null>(null);
export function useMe(): MeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useMe ngoài AppShell");
  return c;
}

type NavLeaf = { href: string; label: string; icon: ReactNode; match?: (p: string) => boolean };
type NavGroup = { label: string; icon: ReactNode; children: NavLeaf[] };
const NAV: (NavLeaf | NavGroup)[] = [
  {
    label: "Quản lý dự án", icon: <Home className="h-4 w-4" />,
    children: [
      { href: "/projects", label: "Thông tin dự án", icon: <Building2 className="h-4 w-4" />, match: (p) => p === "/" || p.startsWith("/projects") },
      { href: "/tracking", label: "Theo dõi tiến độ dự án", icon: <Activity className="h-4 w-4" />, match: (p) => p.startsWith("/tracking") },
    ],
  },
  {
    label: "Lập tiến độ Master Timeline", icon: <FolderKanban className="h-4 w-4" />,
    children: [
      { href: "/mtl", label: "Lập Master Timeline", icon: <CalendarRange className="h-4 w-4" />, match: (p) => p.startsWith("/mtl") },
      { href: "/review", label: "Thẩm định", icon: <ClipboardCheck className="h-4 w-4" />, match: (p) => p.startsWith("/review") },
      { href: "/approval", label: "Trình Phê Duyệt", icon: <Send className="h-4 w-4" />, match: (p) => p.startsWith("/approval") },
    ],
  },
  { href: "/design-tasks", label: "Lập Nhiệm vụ Thiết kế", icon: <ClipboardList className="h-4 w-4" /> },
  { href: "/fs", label: "Lập FS Thực thi", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { href: "/pyc", label: "PYC HHDV", icon: <ClipboardCheck className="h-4 w-4" /> },
];
const NAV_BOTTOM = [
  { href: "/templates", label: "Template & Định mức", icon: <Layers className="h-4 w-4" /> },
  { href: "/settings", label: "Cài đặt Hệ thống", icon: <Settings2 className="h-4 w-4" /> },
];

const CRUMBS: Record<string, string> = {
  pyc: "PYC HHDV",
  projects: "Thông tin dự án", mtl: "Lập Master Timeline", new: "Khởi tạo MTL", tracking: "Theo dõi tiến độ dự án", approval: "Trình Phê Duyệt", review: "Thẩm định", templates: "Template & Định mức",
  settings: "Cài đặt Hệ thống", "design-tasks": "Lập Nhiệm vụ Thiết kế", fs: "Lập FS Thực thi", "to-trinh": "Tờ trình E-Approval",
};

function Logo() {
  return (
    <div className="flex flex-col items-center gap-3 px-5 pb-4 pt-5">
      <div className="flex w-full justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/novaland-logo.png" alt="Novaland — Cho cuộc sống bừng sáng" className="h-[78px] w-auto" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[26px] font-extrabold leading-none text-white">PMD</span>
        <span className="text-[10px] font-bold uppercase leading-tight tracking-[0.1em] text-white/80">Project<br />Management</span>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const path = usePathname();
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const isActive = (n: NavLeaf) => (n.match ? n.match(path) : path.startsWith(n.href));
  const leaf = (n: NavLeaf, nested = false) => {
    const active = isActive(n);
    return (
      <Link key={n.href} href={n.href} onClick={onClose} aria-current={active ? "page" : undefined}
        className={cn("flex items-center gap-3 rounded px-3 text-[14px] text-white/85 transition-colors", nested ? "min-h-9 py-1.5 leading-tight" : "h-9", active ? "bg-brand font-medium text-white" : "hover:bg-sidebar-hover")}>
        <span className="shrink-0">{n.icon}</span> <span>{n.label}</span>
      </Link>
    );
  };
  const item = (n: NavLeaf | NavGroup) => {
    if (!("children" in n)) return leaf(n);
    const anyActive = n.children.some(isActive);
    const folded = closedGroups.has(n.label) && !anyActive;
    return (
      <div key={n.label} className="flex flex-col gap-1">
        <button onClick={() => setClosedGroups((c) => { const x = new Set(c); if (x.has(n.label)) x.delete(n.label); else x.add(n.label); return x; })}
          aria-expanded={!folded}
          className={cn("flex h-9 items-center gap-3 rounded px-3 text-left text-[14px] transition-colors hover:bg-sidebar-hover", anyActive ? "font-semibold text-white" : "text-white/85")}>
          <span className="shrink-0">{n.icon}</span><span className="flex-1">{n.label}</span>
          {folded ? <ChevronRight className="h-4 w-4 text-white/60" /> : <ChevronDown className="h-4 w-4 text-white/60" />}
        </button>
        {!folded && <div className="ml-5 flex flex-col gap-1 border-l border-sidebar-border pl-2">{n.children.map((c) => leaf(c, true))}</div>}
      </div>
    );
  };
  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
      <aside className={cn("no-print fixed inset-y-0 left-0 z-40 flex w-sidebar flex-col bg-sidebar transition-transform lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <Logo />
        <div className="mx-4 border-t border-sidebar-border" />
        <nav className="flex flex-1 flex-col gap-1 overflow-auto px-3 py-4" aria-label="Điều hướng chính">{NAV.map(item)}</nav>
        <nav className="flex flex-col gap-1 border-t border-sidebar-border px-3 py-3">{NAV_BOTTOM.map((n) => leaf(n))}</nav>
        <div className="px-5 pb-4 pt-1 text-[11px] text-white/50">Prototype v0.1 · © 2026 Nova Group<br />Dữ liệu minh họa</div>
      </aside>
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { user, users, reload } = useMe();
  const path = usePathname();
  const parts = path.split("/").filter(Boolean);
  const [pick, setPick] = useState(false);
  const switchUser = async (id: string) => {
    await api("/api/me", { method: "POST", json: { userId: id } });
    setPick(false);
    await reload();
    window.location.reload();
  };
  return (
    <header className="no-print sticky top-0 z-20 flex h-topbar items-center justify-between border-b border-surface-line bg-surface px-4">
      <div className="flex items-center gap-3">
        <button onClick={onMenu} className="rounded p-2 hover:bg-surface-head lg:hidden" aria-label="Đóng/mở menu"><PanelLeft className="h-5 w-5" /></button>
        <nav className="flex items-center gap-1 text-ink-mute" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-ink">Trang chủ</Link>
          {parts.map((p, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5" />
              <span className={i === parts.length - 1 ? "font-semibold text-ink" : ""}>{CRUMBS[p] ?? (parts[0] === "mtl" ? "Workspace MTL" : p)}</span>
            </span>
          ))}
        </nav>
      </div>
      <div className="relative flex items-center gap-3">
        <Badge tone="amber" className="hidden sm:inline-flex">PROTOTYPE · demo</Badge>
        <button onClick={() => setPick((v) => !v)} className="flex items-center gap-3 rounded px-2 py-1 text-right hover:bg-surface-head" aria-haspopup="listbox" title="Demo: đổi vai trò để thử phân quyền">
          <div className="leading-tight">
            <div className="font-semibold text-ink">{user.name}</div>
            <div className="text-[12px] text-ink-mute">{ROLE_LABEL[user.role as Role]}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-[13px] font-bold text-white">{user.name.split(" ").slice(-2).map((w) => w[0]).join("").toUpperCase()}</div>
        </button>
        {pick && (
          <div className="card absolute right-0 top-12 z-40 w-72 p-1 shadow-lg" role="listbox">
            <div className="px-3 py-2 text-[12px] font-semibold uppercase text-ink-mute">Demo: chuyển vai trò</div>
            {users.map((u) => (
              <button key={u.id} onClick={() => switchUser(u.id)} className={cn("flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-surface-head", u.id === user.id && "bg-brand-soft")}>
                <span><span className="block font-medium">{u.name}</span><span className="text-[12px] text-ink-mute">{u.title}</span></span>
                <Badge tone={u.role === "admin" ? "violet" : u.role === "viewer" ? "slate" : "blue"}>{ROLE_LABEL[u.role]}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const reload = useCallback(async () => setMe(await api<Me>("/api/me")), []);
  useEffect(() => { reload().catch(() => {}); }, [reload]);
  if (!me) return <div className="flex h-screen items-center justify-center text-ink-mute"><ShieldCheck className="mr-2 h-5 w-5" /> Đang tải hệ thống…</div>;
  return (
    <Ctx.Provider value={{ ...me, can: (p) => me.permissions.includes(p), reload }}>
      <ToastProvider>
        <Sidebar open={open} onClose={() => setOpen(false)} />
        <div className="flex min-h-screen flex-col lg:pl-[250px]">
          <Topbar onMenu={() => setOpen((v) => !v)} />
          <main className="flex-1 p-4 lg:p-6">{children}</main>
        </div>
      </ToastProvider>
    </Ctx.Provider>
  );
}

export { BarChart3 };
