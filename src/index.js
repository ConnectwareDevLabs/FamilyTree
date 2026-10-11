import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// Enable standard CORS for Cloudflare Pages / external origins
app.use('*', cors());

// ── HEALTH & STATUS ENDPOINTS ─────────────────────────
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    app: 'FamilyTree Backend API',
    version: '2.2.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/info', (c) => {
  return c.json({
    name: 'FamilyTree API',
    version: '2.2.0',
    environment: c.env ? (c.env.ENVIRONMENT || 'development') : 'development',
    features: ['d1-database', 'visitor-counter', 'tree-sync']
  });
});

// ── TREES API (Phase 2 prep) ───────────────────────────
app.get('/api/trees', async (c) => {
  try {
    if (c.env && c.env.DB) {
      const { results } = await c.env.DB.prepare('SELECT id, name, created_at, updated_at FROM trees ORDER BY updated_at DESC').all();
      return c.json({ success: true, trees: results || [] });
    }
    return c.json({ success: true, trees: [], note: 'Local standalone mode' });
  } catch (err) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// ── VISITOR COUNTER ENDPOINT (Cloudflare D1 & Session Aware) ──
let inMemoryVisitors = 1285;

app.get('/api/visitor-count', async (c) => {
  const isHit = c.req.query('hit') === '1';
  let count = inMemoryVisitors;

  try {
    if (c.env && c.env.DB) {
      await c.env.DB.prepare('CREATE TABLE IF NOT EXISTS stats (key TEXT PRIMARY KEY, value INTEGER)').run();
      const row = await c.env.DB.prepare('SELECT value FROM stats WHERE key = "visitors"').first();
      count = row ? Number(row.value) : 1285;

      if (isHit) {
        count += 1;
        await c.env.DB.prepare('INSERT INTO stats (key, value) VALUES ("visitors", ?) ON CONFLICT(key) DO UPDATE SET value = ?').bind(count, count).run();
      }
      return c.json({ success: true, visitors: count, recorded: isHit });
    }
  } catch (err) {
    console.error('D1 stats error:', err);
  }
  
  if (isHit) inMemoryVisitors += 1;
  return c.json({ success: true, visitors: inMemoryVisitors, recorded: isHit });
});

// ── ADMIN ROUTE ────────────────────────────────────────
app.get('/admin', async (c) => {
  if (c.env && c.env.ASSETS) {
    return c.env.ASSETS.fetch(new Request(new URL('/admin.html', c.req.url)));
  }
  return c.redirect('/admin.html');
});

export default app;
