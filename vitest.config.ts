import { defineConfig } from "vitest/config";

// only our tests (vercel build copies files into .vercel/output)
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
