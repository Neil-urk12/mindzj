import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import UnoCSS from "unocss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;
const isTauriBuild = Boolean(process.env.TAURI_ENV_PLATFORM);

export default defineConfig(async () => ({
  plugins: [UnoCSS(), solidPlugin({ generate: "dom", ssr: false })],

  cacheDir: ".vite-cache",

  clearScreen: false,

  server: {
    port: 1430,
    strictPort: false,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1431 }
      : undefined,
    watch: {
      ignored: [
        "**/src-tauri/**",
        "**/target/**",
        "**/target-codex-check*/**",
        "**/vault1/**",
        "**/.mindzj/**",
        "**/dist/**",
        "**/.git/**",
      ],
    },
  },

  optimizeDeps: {
    entries: ["src/index.tsx", "src/App.tsx"],
    include: [
      "solid-js",
      "solid-js/web",
      "katex",
      "lucide-solid",
      "@tauri-apps/api/core",
      "@tauri-apps/api/window",
      "@tauri-apps/api/event",
    ],
  },

  build: {
    target: "esnext",
    minify: isTauriBuild ? false : "esbuild",
    sourcemap: "hidden",
  },

  resolve: {
    alias: {
      "@": "/src",
    },
    conditions: ["browser", "import", "default"],
  },

  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
    resolve: {
      conditions: ["browser"],
    },
    deps: {
      registerNodeLoader: true,
      inline: [/solid-js/, /@solidjs/, /lucide-solid/],
    },
  },
}));
