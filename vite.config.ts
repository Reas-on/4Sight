import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv, type ProxyOptions } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.BACKEND_API_TARGET || "http://127.0.0.1:3001";
  const proxy: Record<string, ProxyOptions> = { "/api": {
    target, changeOrigin: false,
    ...(env.SIMULATION_ACCESS_TOKEN ? { headers: { authorization: `Bearer ${env.SIMULATION_ACCESS_TOKEN}` } } : {}),
  } };
  return {
    plugins: [react()],
    server: { host: "127.0.0.1", proxy },
    preview: { host: "127.0.0.1", proxy },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
