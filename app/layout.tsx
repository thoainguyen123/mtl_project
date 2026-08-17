import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lập và Thẩm định Master Timeline",
  description: "Tạo nhiều dự án và tự động sinh cây công việc MTL theo mẫu NVLG Microsoft Project.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
