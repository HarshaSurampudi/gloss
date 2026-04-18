import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  outDir: 'output',
  manifest: {
    name: 'Gloss',
    description: 'Explain anything in any YouTube video.',
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['*://*.youtube.com/*'],
    action: {
      default_title: 'Gloss',
    },
    minimum_chrome_version: '116',
  },
  vite: () => ({
    plugins: [preact(), tailwindcss()],
  }),
});
