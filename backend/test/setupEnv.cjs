process.env.NODE_ENV = 'test';
process.env.PORT = '0';

process.env.DATABASE_HOST = '127.0.0.1';
process.env.DATABASE_PORT = '5432';
process.env.DATABASE_NAME = 'postgres';
process.env.DATABASE_USER = 'postgres';
process.env.DATABASE_PASSWORD = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:test@127.0.0.1:5432/postgres';

process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-service';
process.env.PUBLIC_APP_URL = 'http://localhost:5173';
