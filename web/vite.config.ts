/*
 * SutraFlow
 * Copyright (c) 2026-27 Surya Partap Singh
 * Developer: Surya Partap Singh | Website: MixAgile.com
 * File version: 1.7.5
 * License: GNU Affero General Public License v3.0 only (AGPL-3.0-only); see LICENSE.
 * A commercial licence is available for use without the AGPL terms: see COMMERCIAL-LICENSE.md.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    outDir: path.resolve(here, '../dist/web'), emptyOutDir: true,
    // Two pages: the designer (index.html) and the Admin Console (admin.html).
    rollupOptions: { input: { index: path.resolve(here, 'index.html'), admin: path.resolve(here, 'admin.html') } },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:4800', changeOrigin: false }, '/guide': { target: 'http://127.0.0.1:4800', changeOrigin: false }, '/architecture': { target: 'http://127.0.0.1:4800', changeOrigin: false } },
  },
});
