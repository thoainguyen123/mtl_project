"use client";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const cn = clsx;

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card", className)}>{children}</div>;
}

// ----- Badge -----
const TONES: Record<string, string> = {
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  slate: "bg-slate-100 text-slate-600",
  violet: "bg-violet-100 text-violet-700",
};
export function Badge({ tone = "slate", children, className }: { tone?: keyof typeof TONES; children: ReactNode; className?: string }) {
  return <span className={cn("badge", TONES[tone], className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const m: Record<string, [string, keyof typeof TONES]> = {
    draft: ["Đang soạn thảo", "amber"],
    approval_pending: ["Đang trình E-Approval", "blue"],
    approved: ["Đã duyệt", "green"],
    cancelled: ["Hủy", "slate"],
  };
  const [label, tone] = m[status] ?? [status, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}

// ----- Progress -----
export function Progress({ value, plan, tone = "green" }: { value: number; plan?: number; tone?: "green" | "red" | "blue" }) {
  const color = tone === "red" ? "bg-red-500" : tone === "blue" ? "bg-blue-500" : "bg-brand";
  return (
    <div className="relative h-2 w-full rounded-full bg-slate-100">
      <div className={cn("h-2 rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      {plan !== undefined && <div className="absolute -top-0.5 h-3 w-0.5 bg-slate-500" style={{ left: `${Math.min(100, plan)}%` }} title={`Kế hoạch ${plan}%`} />}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-ink-mute">
      <Loader2 className="h-5 w-5 animate-spin" /> {label ?? "Đang tải…"}
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <div className="text-[15px] font-semibold text-ink-soft">{title}</div>
      {hint && <div className="max-w-md text-ink-mute">{hint}</div>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-bold text-ink">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ----- Modal / Drawer -----
export function Modal({ open, onClose, title, children, footer, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className={cn("card max-h-[90vh] w-full overflow-hidden flex flex-col", width)} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-surface-line px-4 py-3">
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <button className="rounded p-1 hover:bg-surface-head" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-surface-line bg-surface px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = "w-[460px]" }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onMouseDown={onClose}>
      <div className={cn("flex h-full max-w-full flex-col bg-white shadow-xl", width)} onMouseDown={(e) => e.stopPropagation()} role="dialog">
        <div className="flex items-start justify-between gap-3 border-b border-surface-line px-4 py-3">
          <div className="min-w-0 flex-1">{title}</div>
          <button className="rounded p-1 hover:bg-surface-head" onClick={onClose} aria-label="Đóng"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}

// ----- Tabs -----
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="flex gap-1 border-b border-surface-line">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={cn("-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 font-semibold", value === t.key ? "border-brand text-brand" : "border-transparent text-ink-mute hover:text-ink")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ----- Toast -----
interface Toast { id: number; msg: string; tone: "ok" | "err" | "warn" }
const ToastCtx = createContext<(msg: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((msg: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, msg, tone }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === "err" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[92vw] flex-col gap-2">
        {list.map((t) => (
          <div key={t.id} className={cn("card border-l-4 px-3 py-2 shadow-lg", t.tone === "ok" && "border-l-brand", t.tone === "err" && "border-l-red-500", t.tone === "warn" && "border-l-amber-500")}>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Field({ label, error, hint, required, children }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="label">{label} {required && <span className="text-red-500">*</span>}</label>
      {children}
      {hint && !error && <div className="mt-1 text-[12px] text-ink-mute">{hint}</div>}
      {error && <div className="mt-1 text-[12px] font-medium text-red-600">{error}</div>}
    </div>
  );
}
