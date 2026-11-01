import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["firebase-handoff/portal-social-ui/src/lib/*.test.ts"] } });