import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      VITE_SUPABASE_URL: 'https://test-supabase-url.com'
    }
  }
});
