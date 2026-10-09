import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/Shell";

export const metadata: Metadata = {
  title: "MTL Workspace — Prototype demo",
  description: "Hệ thống Lập và Theo dõi Master Timeline (prototype demo, không phải bản sản xuất)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
