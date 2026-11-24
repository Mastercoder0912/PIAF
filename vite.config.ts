import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app works from any folder or sub-path.
  base: "./",
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    css: false,
  },
});
