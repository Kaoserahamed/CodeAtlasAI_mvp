import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Demo build configuration for static deployment (GitHub Pages, Netlify, Vercel, etc.)
export default defineConfig({
  plugins: [react()],
  base: '/CodeAtlasAI_mvp/', // GitHub Pages repository name
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  define: {
    'import.meta.env.VITE_DEMO_MODE': JSON.stringify('true'),
  },
})
