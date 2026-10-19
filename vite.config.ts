import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
    },
    resolve: {
        alias: {
            '@': '/src',
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/setupTests.ts',

        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: [
                'src/assets/**',
                'src/**/*.css',
                'src/tests/**',
                'src/**/*.d.ts',
                'src/types/**',
                'src/main.tsx',
                'src/App.tsx',
                'src/contexts/Providers.tsx',
                'src/setupTests.ts',
            ],
        },
    },
})
