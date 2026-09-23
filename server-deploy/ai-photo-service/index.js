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
{"format":"amrap","name":"<Name oder null>","movements":[{"name":"<Uebungsname>","reps":"<Zahl als String>","unit":"<'m'|'km'|'cal'|null>","weight":"<kg als String oder leer, nur falls im Bild ein Gewicht zu dieser Bewegung steht>"}],"durationMin":"<Zahl als String>","durationSec":"<Zahl als String>","setsCount":"<Zahl als String, NUR falls mehrere AMRAP-Saetze mit Pause dazwischen abgebildet sind, sonst Feld weglassen>","restMin":"<Zahl als String, NUR zusammen mit setsCount>","restSec":"<Zahl als String, NUR zusammen mit setsCount>"}

EMOM:
{"format":"emom","name":"<Name oder null>","movements":[{"name":"<Uebungsname>","reps":"<Zahl als String>","unit":"<'m'|'km'|'cal'|null>","weight":"<kg als String oder leer, nur falls im Bild ein Gewicht zu dieser Bewegung steht>"}],"intervalMin":"<Zahl als String>","intervalSec":"<Zahl als String>","rounds":"<Anzahl Minuten/Intervalle als String>"}

Strength (Sets x Reps, ggf. mit Gewicht/Prozent):
{"format":"strength","name":"<Name oder null>","moves":[{"name":"<Uebungsname>","setsCount":"<Zahl als String>","repsTarget":"<Reps als String, z.B. '5' bei gleicher Wiederholungszahl in jedem Satz, ODER kommagetrennt z.B. '7,5,3,5,3' wenn jeder Satz eine ANDERE Wiederholungszahl hat - IMMER in derselben Reihenfolge und mit derselben Anzahl an Werten wie pctList>","pctList":"<z.B. '70' oder '70,75,80,75,80' oder leer>","weight":"<kg als String oder leer>"}]}

For Load (1RM-Testtag, z.B. "Find your 1RM Back Squat"):
{"format":"for-load","name":"<Uebungsname>","timeCapMin":"<Zahl oder '10'>","timeCapSec":"<Zahl oder '0'>"}

Regeln:
- Uebungsnamen auf Englisch in der ueblichen CrossFit-Schreibweise (z.B. "Pull-ups", "Air Squats", "Power Clean").
- Erkennst du "16/12 Calorie Air Bike" o.ae. (Maenner/Frauen-Kalorienangabe), nimm die erste (Maenner-)Zahl als reps und "cal" als unit.
- Erkennst du bei Gewichtsangaben ein Maenner/Frauen-Splitformat wie "61/43 kg" oder "61/43kg", nimm NUR die erste (Maenner-)Zahl als weight (also "61", nicht "61/43") - weight muss immer eine einzelne reine Zahl als String sein, niemals ein Bruch/Slash.
- Zeigt das Bild fuer "for-time"/"amrap"/"emom" GETRENNTE Angaben fuer mehrere Skalierungsstufen (z.B. "Rx: 42.5/30kg", "Intermediate: 30/20kg, 30/22 cal", "Basic: 20/15kg 25/18 cal", "Int: 9 Pull-Ups" - "Scaled"/"Beginner" zaehlt ebenfalls als "scaled"), fuege zusaetzlich ein Top-Level-Feld "scalingTiers" hinzu: {"rx":{"male":"<kg>","female":"<kg>","calMale":"<cal>","calFemale":"<cal>","moves":[{"name":"<Uebungsname EXAKT wie im zugehoerigen movements[]-Eintrag>","reps":"<Zahl als String>"}]},"intermediate":{...},"scaled":{...}} - "male"/"female" fuer Gewichtsabweichungen bei Hantel-Uebungen, "calMale"/"calFemale" fuer Kalorien-Abweichungen bei Cardio-Maschinen (Air Bike, Row, Ski Erg etc.), "moves" fuer reine Wiederholungszahl-Abweichungen bei einzelnen (meist Koerpergewichts-)Uebungen wie "Int: 9 Pull-Ups" (NICHT fuer eine komplette Ersatzuebung wie "12 Ring Rows or Jumping Pull-Ups" - das ist keine reine Reps-Abweichung, dort "moves" weglassen). Nur die Stufen UND Felder eintragen, die im Bild tatsaechlich vorkommen (leeres Feld weglassen statt raten), Zahlenfelder jeweils als reine Zahl (kein Bruch/Slash). Die normalen movements[].weight/reps-Felder bleiben davon unberuehrt und zeigen weiterhin die Rx- bzw. erste im Bild genannte Angabe (Maenner-Wert).
- Wenn eine Angabe nicht im Bild steht, verwende einen sinnvollen Default (rounds:"1", timeCapMin/Sec:"", etc.) statt das Feld wegzulassen.
- Bei AMRAP: Steht dort ein Muster wie "3 Sets 5:00 AMRAP ... Rest 1:00 b/t Sets" oder "3 Runden je 5 Min. AMRAP, 1 Min. Pause zwischen den Saetzen" (WIEDERHOLTE AMRAP-Saetze mit Pause dazwischen, NICHT ein einzelnes AMRAP-Fenster), dann: durationMin/durationSec = Dauer EINES einzelnen Satzes (im Beispiel "5:00", NICHT die Gesamtzeit); setsCount = Anzahl der Saetze (im Beispiel "3"); restMin/restSec = Pause ZWISCHEN den Saetzen (im Beispiel "1:00"). Steht zusaetzlich eine explizite Gesamt-Clock-Zeit dabei (z.B. "17:00 Clock"), nutze sie NUR als Plausibilitaets-Check gegen setsCount*durationMin+durationSec je Satz plus (setsCount-1)*restMin+restSec - trage im Zweifel NICHT die Gesamtzeit als durationMin ein. Ist nur ein einzelnes AMRAP-Zeitfenster ohne Wiederholung/Pause abgebildet (Normalfall), lasse setsCount/restMin/restSec komplett weg statt "1"/"0" einzutragen.
- Bei "strength": steht dort z.B. "Set 1: 7 Reps @ 70%, Set 2: 5 Reps @ 75%, Set 3: 3 Reps @ 80%" (unterschiedliche Reps pro Satz), dann NICHT nur die erste Zahl fuer repsTarget nehmen, sondern ALLE Wiederholungszahlen kommagetrennt in der Reihenfolge der Saetze auflisten (hier also "7,5,3"), passend zur ebenfalls kommagetrennten pctList ("70,75,80").
- Bei "for-time": Nutze repScheme NUR, wenn in JEDER Runde DIESELBE Wiederholungszahl fuer ALLE Bewegungen gilt und sich diese Zahl von Runde zu Runde aendert (klassisches Benchmark-Schema wie "21-15-9", z.B. Fran) - in diesem Fall lasse reps bei den einzelnen movements leer. Hat dagegen jede Bewegungszeile ihre EIGENE, unterschiedliche Wiederholungszahl (z.B. eine Checkliste/Chipper mit vielen einzelnen Zeilen), trage diese Zahl bei jeder Bewegung einzeln in reps ein und lasse repScheme leer.
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
  if (parsed.scalingTiers && typeof parsed.scalingTiers === 'object') {
    Object.values(parsed.scalingTiers).forEach(tier => {
      if (!tier || typeof tier !== 'object') return;
      if (tier.male !== undefined) tier.male = normalizeWeight(tier.male);
      if (tier.female !== undefined) tier.female = normalizeWeight(tier.female);
      if (tier.calMale !== undefined) tier.calMale = normalizeWeight(tier.calMale);
      if (tier.calFemale !== undefined) tier.calFemale = normalizeWeight(tier.calFemale);
    });
  }
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

  const { imageBase64, mimeType, text } = payload || {};
  const hasImage = !!imageBase64 && typeof imageBase64 === 'string' && !!mimeType && /^image\//.test(mimeType);
  const hasText = !!text && typeof text === 'string' && text.trim().length > 0;
  if (!hasImage && !hasText) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'missing imageBase64/mimeType or text' }));
    return;
  }
  if (hasImage && imageBase64.length > MAX_BASE64_LEN) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'image too large' }));
    return;
  }
  if (hasText && text.length > 20000) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'text too large' }));
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
          content: hasImage
            ? [
                { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
                { type: 'text', text: 'Lies dieses Workout-Foto aus und gib das JSON gemaess Systemanweisung zurueck.' }
              ]
            : [
                { type: 'text', text: `Lies diesen (kopierten) Workout-Text aus und gib das JSON gemaess Systemanweisung zurueck:\n\n${text}` }
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
