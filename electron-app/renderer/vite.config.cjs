const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');
const path = require('node:path');

module.exports = defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  envDir: path.resolve(__dirname, '..', '..'),
  base: './',
  build: {
    outDir: path.resolve(__dirname, '..', 'renderer-dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
