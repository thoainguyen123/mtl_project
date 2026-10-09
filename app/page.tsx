import { redirect } from "next/navigation";

// Trang chủ = Thông tin dự án (sau này sẽ làm thành dashboard). Dashboard cũ còn ở /dashboard, không hiện trên menu.
export default function Home() {
  redirect("/projects");
}
