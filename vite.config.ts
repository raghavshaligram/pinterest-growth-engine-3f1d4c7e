// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

// Lovable Cloud injects Supabase secrets as environment variables, but the generated server-side
// Supabase integrations (auth-middleware.ts / client.server.ts) read them from `process.env`.
// Vite only exposes `VITE_*` variables via `import.meta.env` by default, so server functions can
// fail if the runtime `process.env` is not populated. We define the public variables as static
// replacements and keep the service role key inside the SSR bundle only.
const env = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL || "";
const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
const supabaseServiceRole = env.SUPABASE_SERVICE_ROLE_KEY || "";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "process.env.SUPABASE_URL": JSON.stringify(supabaseUrl),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
    },
    environments: supabaseServiceRole
      ? {
          ssr: {
            define: {
              "process.env.SUPABASE_SERVICE_ROLE_KEY": JSON.stringify(supabaseServiceRole),
            },
          },
        }
      : undefined,
  },
});
