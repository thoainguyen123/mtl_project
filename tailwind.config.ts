import type { Config } from "tailwindcss";

// Token lấy trực tiếp từ giao diện https://gmsp-dev.novagroup.vn
// (sidebar 250px, topbar 56px, bo góc 6px, nền #F7F9FB, xanh chủ đạo #2DB34B)
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#2DB34B", dark: "#249A3F", soft: "#E8F7EC" },
        sidebar: { DEFAULT: "#002B60", hover: "#0A3A78", border: "#0B3F80" },
        surface: { DEFAULT: "#F7F9FB", card: "#FFFFFF", head: "#F1F5F9", line: "#E2E8F0" },
        ink: { DEFAULT: "#1E293B", soft: "#334155", mute: "#64748B", head: "#475569" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      borderRadius: { DEFAULT: "6px" },
      width: { sidebar: "250px" },
      height: { topbar: "56px" },
      spacing: { sidebar: "250px", topbar: "56px" },
    },
  },
  plugins: [],
} satisfies Config;
