import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
    base: './',
    plugins: [
        svelte({
            compilerOptions: {
                customElement: true,
            },
        }),
    ],
    build: {
        target: 'es2022',
        sourcemap: true,
    },
});
