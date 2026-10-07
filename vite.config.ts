import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        id: '/',
        name: 'Worship Sets',
        short_name: 'Sets',
        description: 'Plan worship sets, share them with your team and play the charts like a music stand.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#14121a',
        theme_color: '#14121a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico}'],
        globIgnores: ['pdfjs/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Chart PDFs never change in place (a replaced chart gets a new path), so cache-first is safe.
            urlPattern: /\/storage\/v1\/object\/public\/charts\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'charts',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/pdfjs\//,
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-data', expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
})
