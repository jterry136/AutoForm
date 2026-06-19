import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  // Vite 8 resolves the "~/*" tsconfig path alias natively.
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    tailwindcss(),
    // TanStack Start must come before the React plugin.
    tanstackStart(),
    viteReact(),
  ],
})
