import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Model dosyaları HASH'SİZ adlarla sunuluyor (ps-01.glb) ve içerikleri
// üretici çalıştıkça değişiyor. Bu damga her derlemede yenilenir ve model
// URL'lerine ?v= olarak eklenir; böylece tarayıcı eski modeli göstermez.
// Sahada tam bu oldu: arazi katmanı Pi'ye gitti, ekranda çıkmadı.
const BUILD_ID = Date.now().toString(36)

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react()],
  // Göreli yollar: aynı derleme hem kökte (nginx, /) hem JACE'in dosya
  // alanında (/file/twin/) çalışır.
  base: './',
  server: {
    host: true,
    port: Number(process.env.PORT) || 5173,   // harness PORT atarsa ona uy
    proxy: {
      // API ve WebSocket aynı origin'den görünsün — Pi'de nginx de böyle davranacak
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,          // .glb ve dokular ayrı dosya kalsın
    rollupOptions: {
      output: {
        // three.js'i ayır: uygulama kodu güncellenince Pi bu 700 KB'ı
        // yeniden indirmesin, tarayıcı önbelleğinden gelsin.
        manualChunks: { three: ['three'] },
      },
    },
  },
})
