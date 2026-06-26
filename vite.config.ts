import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Load .env files into process.env (all keys, no VITE_ prefix filter) so
  // server-side modules that read process.env — db, auth, env.ts, and the
  // delivery worker — pick up local config in dev. Real environment variables
  // take precedence over .env file values (loadEnv merges process.env last), so
  // production deployments are unaffected.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    server: {
      port: 3000,
    },
    // Vite 8 resolves the "~/*" tsconfig path alias natively.
    resolve: {
      tsconfigPaths: true,
    },
    plugins: [
      tailwindcss(),
      // TanStack Start must come before the React plugin. The custom server
      // entry starts the in-process delivery worker at boot (src/server.ts).
      tanstackStart({ server: { entry: './src/server.ts' } }),
      viteReact(),
    ],
  }
})
