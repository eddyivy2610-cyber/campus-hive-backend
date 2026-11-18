import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { SMTPServer } from 'smtp-server';
import http from 'http';

process.on('uncaughtException', (err: any) => {
  if (err?.code === 'ECONNRESET') return;
  console.error('[Test Server] Uncaught exception:', err);
  process.exit(1);
});

interface StoredMessage {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
  Snippet: string;
  Text: string;
  HTML: string;
  Date: string;
}

const capturedMessages: StoredMessage[] = [];

// 1. Real PostgreSQL 16 (embedded-postgres)
const pgDataDir = path.resolve('.pg16-test-data');
fs.rmSync(pgDataDir, { recursive: true, force: true });

const embeddedPg = new EmbeddedPostgres({
  databaseDir: pgDataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: false,
});

await embeddedPg.initialise();
await embeddedPg.start();
await embeddedPg.createDatabase('campus_market_test');

const pgConnectionString = 'postgresql://postgres:postgres@127.0.0.1:5433/campus_market_test?sslmode=disable';
const client = new pg.Client({ connectionString: pgConnectionString });
await client.connect();
const migrationsDir = path.resolve('prisma/migrations');
const migrationFolders = fs.readdirSync(migrationsDir).sort();
for (const folder of migrationFolders) {
  const migPath = path.join(migrationsDir, folder, 'migration.sql');
  if (fs.existsSync(migPath)) {
    const sql = fs.readFileSync(migPath, 'utf8');
    await client.query(sql);
  }
}
const versionRes = await client.query('SELECT version(), current_database() AS db');
await client.end();
console.log(`[Test Server] Real PostgreSQL listening on ${pgConnectionString} (${versionRes.rows[0].db}: ${versionRes.rows[0].version.split(',')[0]})`);

const shutdown = async () => {
  await embeddedPg.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 2. SMTP Server
const smtp = new SMTPServer({
  authOptional: true,
  onData(stream, session, callback) {
    let raw = '';
    stream.on('data', chunk => { raw += chunk; });
    stream.on('end', () => {
      // Simple parse of subject and body
      const subjectMatch = raw.match(/Subject:\s*([^\r\n]+)/i);
      const toMatch = raw.match(/To:\s*([^\r\n]+)/i);
      const subject = subjectMatch ? subjectMatch[1].trim() : '';
      const to = toMatch ? toMatch[1].replace(/.*<([^>]+)>.*/, '$1').trim() : (session.envelope.rcptTo[0]?.address || '');
      
      const id = String(capturedMessages.length + 1);
      capturedMessages.unshift({
        ID: id,
        To: [{ Address: to }],
        Subject: subject,
        Snippet: raw.slice(0, 100),
        Text: raw,
        HTML: raw,
        Date: new Date().toISOString()
      });
      console.log(`[Test Mail] Captured email to ${to}: ${subject}`);
      callback(null);
    });
  }
});

smtp.listen(1025, '127.0.0.1', () => {
  console.log('[Test Server] SMTP listening on 127.0.0.1:1025');
});

// 3. HTTP Mailpit-compatible mock server
const mailpitHttp = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1:8025');
  if (req.method === 'DELETE' && url.pathname === '/api/v1/messages') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const ids: string[] | undefined = parsed.IDs;
        if (Array.isArray(ids) && ids.length > 0) {
          const idSet = new Set(ids);
          for (let i = capturedMessages.length - 1; i >= 0; i--) {
            if (idSet.has(capturedMessages[i].ID)) capturedMessages.splice(i, 1);
          }
        } else {
          capturedMessages.length = 0;
        }
      } catch {
        capturedMessages.length = 0;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, remaining: capturedMessages.length }));
    });
    return;
  }
  if (url.pathname === '/api/v1/search') {
    const q = url.searchParams.get('query') || '';
    const to = q.replace(/^to:/, '').toLowerCase().trim();
    const matches = to ? capturedMessages.filter(m => m.To.some(t => t.Address.toLowerCase().includes(to))) : capturedMessages;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: matches }));
    return;
  }
  const msgMatch = url.pathname.match(/^\/api\/v1\/message\/(.+)$/);
  if (msgMatch) {
    const msg = capturedMessages.find(m => m.ID === msgMatch[1]);
    if (msg) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msg));
      return;
    }
  }
  res.writeHead(404);
  res.end('Not Found');
});

mailpitHttp.listen(8025, '127.0.0.1', () => {
  console.log('[Test Server] Mailpit mock HTTP listening on 127.0.0.1:8025');
});

// 4. Configure env for Backend B
process.env.DATABASE_URL = pgConnectionString;
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1025';
process.env.PORT = '5000';
process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET = 'test_access_secret_12345678901234567890';
process.env.REFRESH_TOKEN_SECRET = 'test_refresh_secret_12345678901234567890';

// 5. Start Backend B express app
await import('../src/index.ts');
console.log('[Test Server] Backend B successfully loaded and running!');
