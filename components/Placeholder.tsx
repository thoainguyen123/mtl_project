import { Construction } from "lucide-react";

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto max-w-xl">
      <div className="card flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100"><Construction className="h-6 w-6 text-amber-600" /></div>
        <h1 className="text-[20px] font-bold">{title}</h1>
        <p className="text-ink-mute">{note}</p>
      </div>
    </div>
  );
}
