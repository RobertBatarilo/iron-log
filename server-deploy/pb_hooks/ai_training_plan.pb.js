/// <reference path="../pb_data/types.d.ts" />

// WICHTIG: config.local.js wird NICHT mitgeliefert (enthaelt Secrets) -
// muss direkt auf dem Server angelegt werden, siehe config.local.example.js
// require() bewusst INNERHALB des Handlers (nicht auf Modul-Ebene): pb_hooks-Handler koennen
// in einer anderen JSVM-Runtime aus dem Pool ausgefuehrt werden als der, die die Datei beim
// Start geladen hat - ein auf Modul-Ebene gecapturtes const ist dort ggf. "not defined".

// Proxy-Route: Client -> PocketBase (Auth + Pro-Check) -> ai-photo-service (gleicher Dienst wie
// ai-photo-parse, neuer Endpoint /generate-training-plan) -> Anthropic API. Gleiches Muster wie
// ai_photo_parse.pb.js, damit der Anthropic-Key serverseitig bleibt und der Pro-Zugang
// serverseitig geprueft wird, nicht nur clientseitig vertraut.
routerAdd("POST", "/ai-training-plan", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const hasPro = !!(user.getBool("isAppAdmin") || user.getBool("isPro"));
  if (!hasPro) return e.json(403, { ok: false, error: "Pro-Zugang erforderlich" });

  const data = new DynamicModel({
    goal: "", focus: "", status: "", location: "", frequency: 0,
    muscleGroupLoad: {}, recentExercises: []
  });
  e.bindBody(data);

  try {
    const res = $http.send({
      // aiPhotoServiceUrl zeigt auf .../parse-photo (siehe config.local.example.js) - gleicher
      // Dienst, anderer Endpoint, daher hier umgehaengt statt eines zweiten Config-Felds.
      url: cfg.aiPhotoServiceUrl.replace(/\/parse-photo$/, "/generate-training-plan"),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": cfg.aiPhotoInternalSecret
      },
      body: JSON.stringify({
        goal: data.goal, focus: data.focus, status: data.status, location: data.location,
        frequency: data.frequency, muscleGroupLoad: data.muscleGroupLoad, recentExercises: data.recentExercises
      })
    });
    const parsed = JSON.parse(res.raw || "{}");
    return e.json(res.statusCode || 502, parsed);
  } catch (err) {
    console.log("ai-training-plan Hook-Fehler", err);
    return e.json(502, { ok: false, error: "KI-Plan konnte nicht erstellt werden" });
  }
}, $apis.requireAuth("users"));
