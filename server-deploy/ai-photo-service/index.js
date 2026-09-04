const http = require('http');

const PORT = 3002;
const INTERNAL_SECRET = process.env.AI_PHOTO_INTERNAL_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_BASE64_LEN = 11 * 1024 * 1024; // ~8MB Rohbild als Base64

if (!INTERNAL_SECRET || !ANTHROPIC_API_KEY) {
  console.error('Fehlende Umgebungsvariablen (AI_PHOTO_INTERNAL_SECRET/ANTHROPIC_API_KEY), beende.');
  process.exit(1);
}

const SYSTEM_PROMPT = `Du liest ein Foto eines CrossFit-Whiteboards oder Workout-Zettels und gibst NUR ein einziges JSON-Objekt zurueck (kein Markdown, kein Fliesstext, keine Erklaerung) mit exakt einer dieser Formen, je nachdem was fuer ein Workout-Format abgebildet ist:

For Time:
{"format":"for-time","name":"<Name oder null>","movements":[{"name":"<Uebungsname>","reps":"<Zahl als String>","unit":"<'m'|'km'|'cal'|null>","weight":"<kg als String oder leer, nur falls im Bild ein Gewicht zu dieser Bewegung steht>"}],"rounds":"<Zahl als String>","repScheme":"<z.B. '21-15-9' oder leer>","timeCapMin":"<Zahl oder leer>","timeCapSec":"<Zahl oder leer>"}

AMRAP:
{"format":"amrap","name":"<Name oder null>","movements":[{"name":"<Uebungsname>","reps":"<Zahl als String>","unit":"<'m'|'km'|'cal'|null>","weight":"<kg als String oder leer, nur falls im Bild ein Gewicht zu dieser Bewegung steht>"}],"durationMin":"<Zahl als String>","durationSec":"<Zahl als String>"}

EMOM:
{"format":"emom","name":"<Name oder null>","movements":[{"name":"<Uebungsname>","reps":"<Zahl als String>","unit":"<'m'|'km'|'cal'|null>","weight":"<kg als String oder leer, nur falls im Bild ein Gewicht zu dieser Bewegung steht>"}],"intervalMin":"<Zahl als String>","intervalSec":"<Zahl als String>","rounds":"<Anzahl Minuten/Intervalle als String>"}

Strength (Sets x Reps, ggf. mit Gewicht/Prozent):
{"format":"strength","name":"<Name oder null>","moves":[{"name":"<Uebungsname>","setsCount":"<Zahl als String>","repsTarget":"<Zahl als String>","pctList":"<z.B. '70' oder '70,75,80' oder leer>","weight":"<kg als String oder leer>"}]}

For Load (1RM-Testtag, z.B. "Find your 1RM Back Squat"):
{"format":"for-load","name":"<Uebungsname>","timeCapMin":"<Zahl oder '10'>","timeCapSec":"<Zahl oder '0'>"}

Regeln:
- Uebungsnamen auf Englisch in der ueblichen CrossFit-Schreibweise (z.B. "Pull-ups", "Air Squats", "Power Clean").
- Erkennst du "16/12 Calorie Air Bike" o.ae. (Maenner/Frauen-Kalorienangabe), nimm die erste (Maenner-)Zahl als reps und "cal" als unit.
- Erkennst du bei Gewichtsangaben ein Maenner/Frauen-Splitformat wie "61/43 kg" oder "61/43kg", nimm NUR die erste (Maenner-)Zahl als weight (also "61", nicht "61/43") - weight muss immer eine einzelne reine Zahl als String sein, niemals ein Bruch/Slash.
- Wenn eine Angabe nicht im Bild steht, verwende einen sinnvollen Default (rounds:"1", timeCapMin/Sec:"", etc.) statt das Feld wegzulassen.
- Gib IMMER gueltiges JSON zurueck, keine zusaetzlichen Kommentare oder Codeblock-Markierungen.`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > MAX_BASE64_LEN + 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Sicherheitsnetz falls die KI trotz Prompt-Anweisung ein "61/43"-Splitformat statt
// einer reinen Zahl liefert: nur den ersten (Maenner-)Wert behalten.
function normalizeWeight(w) {
  if (w === undefined || w === null || w === '') return w;
  const first = String(w).split('/')[0].trim();
  return /^\d+(\.\d+)?$/.test(first) ? first : w;
}
function sanitizeWeights(parsed) {
  (parsed.movements || []).forEach(mv => { if (mv.weight !== undefined) mv.weight = normalizeWeight(mv.weight); });
  (parsed.moves || []).forEach(mv => { if (mv.weight !== undefined) mv.weight = normalizeWeight(mv.weight); });
}
function extractJson(text) {
  const trimmed = (text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : trimmed;
  return JSON.parse(raw);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }
  if (req.method !== 'POST' || req.url !== '/parse-photo') {
    res.writeHead(404); res.end(); return;
  }
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    res.writeHead(401); res.end(); return;
  }

  let payload;
  try { payload = await readBody(req); } catch (e) {
    res.writeHead(400); res.end('invalid json'); return;
  }

  const { imageBase64, mimeType } = payload || {};
  if (!imageBase64 || typeof imageBase64 !== 'string' || !mimeType || !/^image\//.test(mimeType)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'missing imageBase64/mimeType' }));
    return;
  }
  if (imageBase64.length > MAX_BASE64_LEN) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'image too large' }));
    return;
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
            { type: 'text', text: 'Lies dieses Workout-Foto aus und gib das JSON gemaess Systemanweisung zurueck.' }
          ]
        }]
      })
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => '');
      console.error('Anthropic API Fehler', anthropicRes.status, errBody);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'AI-Anfrage fehlgeschlagen' }));
      return;
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    let parsed;
    try { parsed = extractJson(text); } catch (e) {
      console.error('Konnte KI-Antwort nicht als JSON parsen', text);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'KI-Antwort ungueltig' }));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.format) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'KI-Antwort ungueltig' }));
      return;
    }
    sanitizeWeights(parsed);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...parsed }));
  } catch (e) {
    console.error('ai-photo-service Fehler', e);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unerwarteter Fehler' }));
  }
});

server.listen(PORT, () => console.log('AI-Photo-Dienst laeuft auf Port ' + PORT));
