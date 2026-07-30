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
// fail if the runtime `process.env` is not populated. We define the public Supabase variables as
// static replacements so the server-side code can resolve them without depending on runtime env.
const env = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
const supabaseUrl =
  env.SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  "https://nglirfhptuctfeebrtap.supabase.co";
const supabaseKey =
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_12wGvWpw5vh2uZAqrC8A3Q_Km6xgjAq";

const serverOnlySecretNames: string[] = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "INTEGRATIONS_ENC_KEY",
  "PINTEREST_APP_ID",
  "PINTEREST_APP_SECRET",
  "PINTEREST_REDIRECT_URI",
  // Not actually a secret -- a plain "true"/unset feature flag gating
  // the dev-only manual sandbox-token form -- but it's read via
  // process.env server-side just like the real secrets above, and the
  // Cloudflare Worker runtime doesn't inherit the host process env any
  // more for this than it does for those, so it needs the same
  // build-time inlining to actually be readable at runtime.
  "PINTEREST_SANDBOX_TOOLS_ENABLED",
];

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
      "process.env.SUPABASE_URL": JSON.stringify(supabaseUrl),
      "process.env.SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
    },
    // Server-only secrets: the SSR/worker runtime does not inherit the host
    // process env, so these must be injected statically -- but ONLY into the
    // ssr environment, never the browser bundle.
    environments: {
      ssr: {
        define: Object.fromEntries(
          serverOnlySecretNames
            .map((name) => [name, env[name] ?? process.env[name]] as const)
            .filter(([, value]) => Boolean(value))
            .map(([name, value]) => [`process.env.${name}`, JSON.stringify(value)]),
        ),
      },
    },
  },
});

