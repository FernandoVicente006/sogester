import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Aceita ligações da rede local (ex.: telemóvel da portaria a ler o QR Code no ensaio).
    host: true,
    proxy: {
      '/api': 'http://localhost:3100',
      '/uploads': 'http://localhost:3100',
    },
  },
})
