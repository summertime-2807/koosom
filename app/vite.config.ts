/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build`            -> ปกติ (dist/)
// `npm run build:single`     -> ไฟล์ HTML ไฟล์เดียว (dist-single/) ใช้เปิดออฟไลน์/แชร์ได้
export default defineConfig(({ mode }) => ({
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  base: './',
  build: { chunkSizeWarningLimit: 1500, ...(mode === 'single' ? { outDir: 'dist-single' } : {}) },
  test: { environment: 'node' },
}))
