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
- Zeigt das Bild fuer "for-time"/"amrap"/"emom" GETRENNTE Angaben fuer mehrere Skalierungsstufen (z.B. "Rx: 42.5/30kg", "Intermediate: 30/20kg, 30/22 cal", "Basic: 20/15kg 25/18 cal", "Int: 9 Pull-Ups", "Bas: 12 Ring Rows or Jumping Pull-Ups" - "Scaled"/"Beginner" zaehlt ebenfalls als "scaled"), fuege zusaetzlich ein Top-Level-Feld "scalingTiers" hinzu: {"rx":{"male":"<kg>","female":"<kg>","calMale":"<cal>","calFemale":"<cal>","moves":[{"name":"<ORIGINAL-Uebungsname EXAKT wie im zugehoerigen movements[]-Eintrag, NIE der Ersatzuebungs-Name>","reps":"<Zahl als String, nur bei reiner Wiederholungs-Abweichung>","substitutes":["<Ersatzuebungsname>", "<zweite Alternative, NUR falls im Bild ein 'oder' zwischen zwei Uebungen steht>"]}]},"intermediate":{...},"scaled":{...}} - "male"/"female" fuer Gewichtsabweichungen bei Hantel-Uebungen, "calMale"/"calFemale" fuer Kalorien-Abweichungen bei Cardio-Maschinen (Air Bike, Row, Ski Erg etc.), "moves[].reps" fuer reine Wiederholungszahl-Abweichungen bei GLEICHER Uebung wie "Int: 9 Pull-Ups", "moves[].substitutes" fuer eine KOMPLETTE Ersatzuebung wie "Bas: 12 Ring Rows or Jumping Pull-Ups" (hier ist "Pull-Ups" der "name" trotz nicht im selben Satz genannt - nutze dein Verstaendnis des Bildes/ueblicher CrossFit-Skalierungen, um zu erkennen WELCHE Bewegung ersetzt wird, z.B. an der Position der Zeile im Bild oder daran dass es die einzige Koerpergewichts-Bewegung ohne sonstige Rx-Abweichung ist; bist du dir nicht sicher welche Bewegung gemeint ist, lasse den kompletten moves-Eintrag lieber weg statt zu raten). Ein einzelner moves-Eintrag kann "reps" UND "substitutes" gleichzeitig haben (z.B. eine Ersatzuebung MIT geaenderter Wiederholungszahl). Nur die Stufen UND Felder eintragen, die im Bild tatsaechlich vorkommen (leeres Feld weglassen statt raten), Zahlenfelder jeweils als reine Zahl (kein Bruch/Slash). Die normalen movements[].weight/reps-Felder bleiben davon unberuehrt und zeigen weiterhin die Rx- bzw. erste im Bild genannte Angabe (Maenner-Wert).
- Wenn eine Angabe nicht im Bild steht, verwende einen sinnvollen Default (rounds:"1", timeCapMin/Sec:"", etc.) statt das Feld wegzulassen.
- Bei AMRAP: Steht dort ein Muster wie "3 Sets 5:00 AMRAP ... Rest 1:00 b/t Sets" oder "3 Runden je 5 Min. AMRAP, 1 Min. Pause zwischen den Saetzen" (WIEDERHOLTE AMRAP-Saetze mit Pause dazwischen, NICHT ein einzelnes AMRAP-Fenster), dann: durationMin/durationSec = Dauer EINES einzelnen Satzes (im Beispiel "5:00", NICHT die Gesamtzeit); setsCount = Anzahl der Saetze (im Beispiel "3"); restMin/restSec = Pause ZWISCHEN den Saetzen (im Beispiel "1:00"). Steht zusaetzlich eine explizite Gesamt-Clock-Zeit dabei (z.B. "17:00 Clock"), nutze sie NUR als Plausibilitaets-Check gegen setsCount*durationMin+durationSec je Satz plus (setsCount-1)*restMin+restSec - trage im Zweifel NICHT die Gesamtzeit als durationMin ein. Ist nur ein einzelnes AMRAP-Zeitfenster ohne Wiederholung/Pause abgebildet (Normalfall), lasse setsCount/restMin/restSec komplett weg statt "1"/"0" einzutragen.
- Bei "strength": steht dort z.B. "Set 1: 7 Reps @ 70%, Set 2: 5 Reps @ 75%, Set 3: 3 Reps @ 80%" (unterschiedliche Reps pro Satz), dann NICHT nur die erste Zahl fuer repsTarget nehmen, sondern ALLE Wiederholungszahlen kommagetrennt in der Reihenfolge der Saetze auflisten (hier also "7,5,3"), passend zur ebenfalls kommagetrennten pctList ("70,75,80").
- Bei "for-time": Nutze repScheme NUR, wenn in JEDER Runde DIESELBE Wiederholungszahl fuer ALLE Bewegungen gilt und sich diese Zahl von Runde zu Runde aendert (klassisches Benchmark-Schema wie "21-15-9", z.B. Fran) - in diesem Fall lasse reps bei den einzelnen movements leer. Hat dagegen jede Bewegungszeile ihre EIGENE, unterschiedliche Wiederholungszahl (z.B. eine Checkliste/Chipper mit vielen einzelnen Zeilen), trage diese Zahl bei jeder Bewegung einzeln in reps ein und lasse repScheme leer.
- Gib IMMER gueltiges JSON zurueck, keine zusaetzlichen Kommentare oder Codeblock-Markierungen.`;

const TRAINING_PLAN_SYSTEM_PROMPT = `Du bist ein erfahrener CrossFit-Coach und erstellst einen individuellen woechentlichen Trainingsplan fuer einen Athleten. Du bekommst als Kontext: Ziel, Schwerpunkt, Trainingsstand, Trainingsort (bestimmt verfuegbares Equipment), gewuenschte Trainingshaeufigkeit pro Woche, die Anzahl an Trainingseinheiten der letzten 14 Tage pro Muskelgruppe (arme/brust/bauch/beine/ruecken) sowie die Namen der zuletzt trainierten Uebungen.

Gib NUR ein einziges JSON-Objekt zurueck (kein Markdown, kein Fliesstext, keine Codeblock-Markierung) in exakt dieser Form:
{"days":[{"kind":"wod"|"strength","wod":{"name":"<kurzer Name>","format":"for-time"|"amrap","movements":[{"name":"<Uebungsname>","reps":<Zahl>}],"rounds":<Zahl, NUR bei format "for-time", sonst weglassen>,"repScheme":"<z.B. '21-15-9', NUR bei format 'for-time' mit gleichem Rep-Schema pro Runde, sonst leer>","durationSec":<Gesamtdauer in Sekunden, NUR bei format 'amrap'>},"prog":{"name":"<kurzer Name>","exerciseName":"<Uebungsname>","setsCount":<Zahl>,"pctList":"<z.B. '70,75,80,80,80', kommagetrennt, ein Wert pro Satz, oder leer wenn kein Prozent-Bezug sinnvoll ist>"}}],"summaryNote":"<1-2 Saetze auf Deutsch, die kurz erklaeren warum der Plan so aussieht>"}

Regeln:
- Erzeuge GENAU so viele Eintraege in "days" wie die angegebene Haeufigkeit pro Woche - nicht mehr, nicht weniger.
- Jeder Eintrag hat entweder "wod" (kind:"wod", "prog" dann weglassen) ODER "prog" (kind:"strength", "wod" dann weglassen), nie beides.
- Uebungsnamen auf Englisch in ueblicher CrossFit-Schreibweise (z.B. "Pull-up", "Air Squat", "Back Squat", "Kettlebell Swing").
- Trainingsort bestimmt verfuegbares Equipment - benutze AUSSCHLIESSLICH dazu passende Uebungen: "box" = Langhantel, Klimmzugstange, Kettlebell und alles Bodyweight; "zuhause-geraete" = NUR Klimmzugstange, Kettlebell und Bodyweight (KEINE Langhantel-Uebungen); "zuhause-ohne" = NUR Bodyweight-Uebungen (Air Squat, Push-up, Sit-up, Burpee, Lunge, Mountain Climber etc.), keine Geraete jeglicher Art.
- Trainingsstand bestimmt Komplexitaet: "anfaenger" = einfache Grundbewegungen, keine komplexen olympischen Kombinationen (kein Clean & Jerk / Snatch in voller Technik, stattdessen z.B. Kettlebell Swing/Goblet Squat); "fortgeschritten" = Grundbewegungen plus einfachere olympische Varianten (Power Clean, Push Press); "profi" = alles inkl. voller olympischer Bewegungen (Snatch, Clean & Jerk) und hoeherer Intensitaet.
- Ziel bestimmt den Mix aus "wod" (Konditionierung) und "strength" (Kraftaufbau) Einheiten: "staerker" = mehrheitlich "strength" mit hoeheren Prozentsaetzen (75-90%); "schneller" = mehrheitlich "wod" mit kurzen, intensiven Formaten; "ausdauer" = mehrheitlich "wod" mit hoeheren Wiederholungszahlen/laengerer AMRAP-Dauer; "ausgewogen" = ca. 50/50-Mix aus beiden.
- Schwerpunkt "luecken": bevorzuge bei der Uebungsauswahl gezielt Bewegungsmuster, die zu Muskelgruppen mit NIEDRIGER Trainingseinheiten-Anzahl der letzten 14 Tage passen (Zuordnung: Kniebeuge/Kreuzheben/Olympisches Heben -> "beine", Druckbewegungen wie Bankdruecken/Liegestuetz/Dips -> "brust", Zugbewegungen wie Klimmzug/Rudern -> "ruecken", Sit-up/Toes-to-Bar/Plank -> "bauch", Muscle-up/Handstand/Rope Climb/Pistol -> "arme") - vernachlaessigte Muskelgruppen (niedrige Zahl) sollen im Plan bewusst mehr Gewicht bekommen als bereits stark trainierte.
- Schwerpunkt "fortsetzen": baue auf den zuletzt trainierten Uebungen sinnvoll auf (aehnliche Bewegungsmuster/Progression fortsetzen), ohne die Uebungen 1:1 zu wiederholen - Ziel ist ein natuerlicher naechster Trainingsschritt, keine Neuausrichtung.
- Bei "wod": setze "rounds" NUR bei format "for-time", "durationSec" NUR bei format "amrap" (sinnvoller Bereich 600-1500 Sekunden), niemals beide gleichzeitig.
- Bei "strength": "pctList" muss genau "setsCount" kommagetrennte Werte enthalten, falls gesetzt.
- Gib IMMER gueltiges JSON zurueck, keine zusaetzlichen Kommentare.`;

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
  if (req.method === 'POST' && req.url === '/parse-photo') {
    if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) { res.writeHead(401); res.end(); return; }
    return handleParsePhoto(req, res);
  }
  if (req.method === 'POST' && req.url === '/generate-training-plan') {
    if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) { res.writeHead(401); res.end(); return; }
    return handleGenerateTrainingPlan(req, res);
  }
  res.writeHead(404); res.end();
});

async function handleParsePhoto(req, res) {
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
}

const PLAN_GOALS = ['staerker', 'schneller', 'ausdauer', 'ausgewogen'];
const PLAN_FOCUSES = ['luecken', 'fortsetzen'];
const PLAN_STATUSES = ['anfaenger', 'fortgeschritten', 'profi'];
const PLAN_LOCATIONS = ['box', 'zuhause-geraete', 'zuhause-ohne'];

async function handleGenerateTrainingPlan(req, res) {
  let payload;
  try { payload = await readBody(req); } catch (e) {
    res.writeHead(400); res.end('invalid json'); return;
  }

  const { goal, focus, status, location, frequency, muscleGroupLoad, recentExercises } = payload || {};
  if (!PLAN_GOALS.includes(goal) || !PLAN_FOCUSES.includes(focus) || !PLAN_STATUSES.includes(status) || !PLAN_LOCATIONS.includes(location)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'ungueltige Plan-Parameter' }));
    return;
  }
  const freq = Math.min(7, Math.max(1, parseInt(frequency) || 3));
  const load = (muscleGroupLoad && typeof muscleGroupLoad === 'object') ? muscleGroupLoad : {};
  const recent = Array.isArray(recentExercises) ? recentExercises.slice(0, 60).map(String) : [];

  const userText = `Ziel: ${goal}\nSchwerpunkt: ${focus}\nTrainingsstand: ${status}\nTrainingsort: ${location}\nHaeufigkeit pro Woche: ${freq}\nTrainingseinheiten je Muskelgruppe (letzte 14 Tage): ${JSON.stringify(load)}\nZuletzt trainierte Uebungen (letzte 14 Tage): ${recent.length ? recent.join(', ') : '(keine)'}\n\nErstelle den Trainingsplan gemaess Systemanweisung und gib das JSON zurueck.`;

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
        max_tokens: 2048,
        temperature: 0.4,
        system: TRAINING_PLAN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }]
      })
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text().catch(() => '');
      console.error('Anthropic API Fehler (training-plan)', anthropicRes.status, errBody);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'AI-Anfrage fehlgeschlagen' }));
      return;
    }

    const data = await anthropicRes.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    let parsed;
    try { parsed = extractJson(text); } catch (e) {
      console.error('Konnte KI-Plan-Antwort nicht als JSON parsen', text);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'KI-Antwort ungueltig' }));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.days) || !parsed.days.length) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'KI-Antwort ungueltig' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, days: parsed.days, summaryNote: parsed.summaryNote || '' }));
  } catch (e) {
    console.error('ai-photo-service Fehler (training-plan)', e);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'unerwarteter Fehler' }));
  }
}

server.listen(PORT, () => console.log('AI-Photo-Dienst laeuft auf Port ' + PORT));
