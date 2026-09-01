const http = require('http');
const webpush = require('web-push');

const PORT = 3001;
const INTERNAL_SECRET = process.env.INTERNAL_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:robert.batarilo@formelfuchs.at';

if (!INTERNAL_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Fehlende Umgebungsvariablen (INTERNAL_SECRET/VAPID_*), beende.');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }
  if (req.method !== 'POST' || req.url !== '/send-push') {
    res.writeHead(404); res.end(); return;
  }
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    res.writeHead(401); res.end(); return;
  }

  let payload;
  try { payload = await readBody(req); } catch (e) {
    res.writeHead(400); res.end('invalid json'); return;
  }

  const { subscription, title, body, url } = payload || {};
  if (!subscription || !subscription.endpoint || !subscription.keys) {
    res.writeHead(400); res.end('missing subscription'); return;
  }

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title: title || 'WOD Ledger', body: body || '', url: url || './index.html' })
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    // 404/410 = Subscription ist ungueltig/abgelaufen -> vom Aufrufer (PB-Hook) ignorierbar
    console.error('web-push Fehler', e.statusCode, e.body);
    res.writeHead(e.statusCode === 404 || e.statusCode === 410 ? 410 : 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, statusCode: e.statusCode || 0 }));
  }
});

server.listen(PORT, () => console.log('Push-Dienst laeuft auf Port ' + PORT));
