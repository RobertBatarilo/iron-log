/// <reference path="../pb_data/types.d.ts" />

// WICHTIG: config.local.js wird NICHT mitgeliefert (enthaelt Secrets) -
// muss direkt auf dem Server angelegt werden, siehe config.local.example.js
// require() bewusst INNERHALB des Handlers (nicht auf Modul-Ebene): pb_hooks-Handler koennen
// in einer anderen JSVM-Runtime aus dem Pool ausgefuehrt werden als der, die die Datei beim
// Start geladen hat - ein auf Modul-Ebene gecapturtes const ist dort ggf. "not defined".

// Proxy-Route: Client -> PocketBase (Auth + Pro-Check) -> ai-photo-service -> Anthropic API.
// So bleibt der Anthropic-Key serverseitig und der Pro-Zugang wird serverseitig geprueft,
// nicht nur clientseitig vertraut.
routerAdd("POST", "/ai-photo-parse", (e) => {
  const aiPhotoCfg = require(`${__hooks}/config.local.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  let hasPro = !!(user.getBool("isAppAdmin") || user.getBool("isProStandalone"));
  if (!hasPro) {
    const memberships = $app.findRecordsByFilter(
      "memberships",
      `user = {:uid} && status = "active"`,
      "",
      1, 0,
      { uid: user.id }
    );
    hasPro = memberships.length > 0;
  }
  if (!hasPro) return e.json(403, { ok: false, error: "Pro-Zugang erforderlich" });

  const data = new DynamicModel({ imageBase64: "", mimeType: "" });
  e.bindBody(data);
  if (!data.imageBase64 || !data.mimeType) {
    return e.json(400, { ok: false, error: "Bild fehlt" });
  }

  try {
    const res = $http.send({
      url: aiPhotoCfg.aiPhotoServiceUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": aiPhotoCfg.aiPhotoInternalSecret
      },
      body: JSON.stringify({ imageBase64: data.imageBase64, mimeType: data.mimeType })
    });
    const parsed = JSON.parse(res.raw || "{}");
    return e.json(res.statusCode || 502, parsed);
  } catch (err) {
    console.log("ai-photo-parse Hook-Fehler", err);
    return e.json(502, { ok: false, error: "KI-Erkennung fehlgeschlagen" });
  }
}, $apis.requireAuth("users"));
