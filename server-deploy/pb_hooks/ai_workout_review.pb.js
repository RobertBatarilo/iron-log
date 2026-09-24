/// <reference path="../pb_data/types.d.ts" />

// WICHTIG: config.local.js wird NICHT mitgeliefert (enthaelt Secrets) -
// muss direkt auf dem Server angelegt werden, siehe config.local.example.js
// require() bewusst INNERHALB des Handlers (nicht auf Modul-Ebene): pb_hooks-Handler koennen
// in einer anderen JSVM-Runtime aus dem Pool ausgefuehrt werden als der, die die Datei beim
// Start geladen hat - ein auf Modul-Ebene gecapturtes const ist dort ggf. "not defined".

// Proxy-Route: Client -> PocketBase (Auth + Pro-Check) -> ai-photo-service (gleicher Dienst wie
// ai-photo-parse/ai-training-plan, neuer Endpoint /analyze-workout) -> Anthropic API. Gleiches
// Muster wie ai_photo_parse.pb.js/ai_training_plan.pb.js.
routerAdd("POST", "/ai-workout-review", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const hasPro = !!(user.getBool("isAppAdmin") || user.getBool("isPro"));
  if (!hasPro) return e.json(403, { ok: false, error: "Pro-Zugang erforderlich" });

  const data = new DynamicModel({ workoutText: "", priorAttemptsText: "" });
  e.bindBody(data);
  if (!data.workoutText || !data.workoutText.trim()) {
    return e.json(400, { ok: false, error: "workoutText fehlt" });
  }

  try {
    const res = $http.send({
      // aiPhotoServiceUrl zeigt auf .../parse-photo (siehe config.local.example.js) - gleicher
      // Dienst, anderer Endpoint, daher hier umgehaengt statt eines zweiten Config-Felds.
      url: cfg.aiPhotoServiceUrl.replace(/\/parse-photo$/, "/analyze-workout"),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": cfg.aiPhotoInternalSecret
      },
      body: JSON.stringify({ workoutText: data.workoutText, priorAttemptsText: data.priorAttemptsText })
    });
    const parsed = JSON.parse(res.raw || "{}");
    return e.json(res.statusCode || 502, parsed);
  } catch (err) {
    console.log("ai-workout-review Hook-Fehler", err);
    return e.json(502, { ok: false, error: "KI-Auswertung fehlgeschlagen" });
  }
}, $apis.requireAuth("users"));
