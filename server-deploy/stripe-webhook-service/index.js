const http = require('http');
const Stripe = require('stripe');

// Nimmt Stripe-Webhooks entgegen und prueft ihre Signatur mit dem echten stripe-npm-Paket
// (PocketBase's JSVM hat weder HMAC-Primitive noch npm-Pakete - eine handgestrickte
// Nachbildung von stripe.webhooks.constructEvent waere fuer eine Zahlungs-
// Vertrauensgrenze zu riskant, siehe Plan). Nach erfolgreicher Pruefung ruft dieser
// Dienst per X-Internal-Secret-Header zurueck in PocketBase (server-deploy/pb_hooks/
// credit_checkout.pb.js), das die eigentliche, transaktionale Gutschrift vornimmt.
//
// WICHTIG: braucht die ROHEN Bytes des Request-Bodys fuer die Signaturpruefung, deshalb
// kein express.json() o.ae. - reiner Node-http-Server wie ai-photo-service/push-service.

const PORT = 3003;
const INTERNAL_SECRET = process.env.STRIPE_WEBHOOK_INTERNAL_SECRET;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SIGNING_SECRET = process.env.STRIPE_WEBHOOK_SIGNING_SECRET;
const PB_BASE_URL = process.env.PB_BASE_URL; // z.B. http://pocketbase:8090

if (!INTERNAL_SECRET || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SIGNING_SECRET || !PB_BASE_URL) {
  console.error('Fehlende Umgebungsvariablen (STRIPE_WEBHOOK_INTERNAL_SECRET/STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SIGNING_SECRET/PB_BASE_URL), beende.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function callPocketBase(path, payload) {
  const res = await fetch(PB_BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('PocketBase-Callback fehlgeschlagen (' + path + '): ' + res.status + ' ' + text);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }
  if (req.method !== 'POST' || req.url !== '/stripe-webhook') {
    res.writeHead(404); res.end(); return;
  }

  const rawBody = await readRawBody(req);
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SIGNING_SECRET);
  } catch (err) {
    console.error('Stripe-Signaturpruefung fehlgeschlagen', err.message);
    res.writeHead(400); res.end('invalid signature'); return;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const creditOrderId = session.metadata && session.metadata.creditOrderId;
      if (creditOrderId) {
        await callPocketBase('/credit/order-fulfilled', {
          creditOrderId,
          stripeSessionId: session.id,
          stripePaymentIntentId: session.payment_intent || '',
        });
      }
    } else if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const creditOrderId = session.metadata && session.metadata.creditOrderId;
      if (creditOrderId) {
        await callPocketBase('/credit/order-expired', { creditOrderId, stripeSessionId: session.id });
      }
    } else if (event.type === 'account.updated') {
      const account = event.data.object;
      await callPocketBase('/credit/connect-account-updated', {
        stripeAccountId: account.id,
        chargesEnabled: !!account.charges_enabled,
        payoutsEnabled: !!account.payouts_enabled,
        detailsSubmitted: !!account.details_submitted,
      });
    }
    // Andere Event-Typen bewusst ignoriert (Stripe schickt deutlich mehr, als dieses
    // Modul braucht) - Stripe erwartet trotzdem eine 2xx-Antwort dafuer.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  } catch (err) {
    console.error('stripe-webhook-service Verarbeitungsfehler', err);
    // 500 -> Stripe wiederholt die Zustellung automatisch; der PocketBase-seitige
    // Idempotenz-Schutz (operationId/status-Checks) macht erneute Zustellungen sicher.
    res.writeHead(500); res.end();
  }
});

server.listen(PORT, () => console.log('Stripe-Webhook-Dienst laeuft auf Port ' + PORT));
