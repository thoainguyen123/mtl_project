import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lập và Thẩm định Master Timeline",
  description: "Tạo nhiều dự án và tự động sinh cây công việc MTL theo mẫu NVLG Microsoft Project.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Roboto:ital,wght@0,300;0,400;0,500;0,700;0,900;1,400;1,700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
