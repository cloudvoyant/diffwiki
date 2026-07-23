import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  base: process.env.DIFFWIKI_BASE || '/',
  resolve: { tsconfigPaths: true },
  plugins: [...(process.env.NODE_ENV !== 'production' ? [devtools()] : []), tailwindcss(), tanstackStart(), viteReact()],
})

export default config
