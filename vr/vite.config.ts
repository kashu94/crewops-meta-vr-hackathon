import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';

// Built into the web app and served at /vr/, from the same origin as the console, so the
// headset uses the console's sign-in cookie and tool routes. The built base is absolute
// because Next.js redirects /vr/ to /vr, which would break relative asset URLs. The dev
// server stays at / for the IWSDK tooling.
export default defineConfig(({ command }) => ({
  plugins: [iwsdkDev()],
  base: command === 'build' ? '/vr/' : '/',
  server: {
    host: '0.0.0.0',
    port: 8081,
    open: false,
    // `npm run dev` in web/ on :3000 answers the tool and speech routes.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: {
    outDir: '../web/public/vr',
    emptyOutDir: true,
    sourcemap: false,
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph, and duplicate
  // Component classes break uikit's instanceof checks.
  resolve: {
    dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
}));
