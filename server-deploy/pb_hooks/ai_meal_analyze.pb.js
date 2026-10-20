/// <reference path="../pb_data/types.d.ts" />

// Mahlzeit-Analyse (Pro): Client -> PocketBase (Auth + Pro-Check + Tageskontingent) ->
// ai-photo-service (/analyze-meal) -> Anthropic API. Foto UND/ODER Text; liefert eine Liste
// geschaetzter Lebensmittel mit kcal/Eiweiss/KH/Fett, die der Nutzer vor dem Speichern prueft.
//
// Tageskontingent pro Nutzer (Kostenschutz): config.local.js -> mealAnalysesPerDay (Standard 30),
// gezaehlt in der Collection "ai_usage" (Tag = UTC-Datum). Gezaehlt werden nur erfolgreiche Analysen.
//
// require()/Helfer bewusst INNERHALB des Handlers (pb_hooks-Dateien teilen sich einen globalen
// Scope bzw. laufen in einem JSVM-Pool - siehe ai_workout_review.pb.js).
routerAdd("POST", "/ai-meal-analyze", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const hasPro = !!(user.getBool("isAppAdmin") || user.getBool("isPro"));
  if (!hasPro) return e.json(403, { ok: false, error: "Pro-Zugang erforderlich" });

  const data = new DynamicModel({ imageBase64: "", mimeType: "", text: "" });
  e.bindBody(data);
  const hasImage = !!(data.imageBase64 && data.mimeType);
  const hasText = !!(data.text && data.text.trim());
  if (!hasImage && !hasText) return e.json(400, { ok: false, error: "Foto oder Text fehlt" });

  const limit = Math.max(1, parseInt(cfg.mealAnalysesPerDay) || 30);
  const day = new Date().toISOString().slice(0, 10);
  let usage = null;
  try {
    usage = $app.findFirstRecordByFilter("ai_usage", "user = {:u} && day = {:d} && kind = 'meal'", { u: user.id, d: day });
  } catch (_) {
    usage = null;
  }
  const used = usage ? (usage.getInt("count") || 0) : 0;
  if (used >= limit) {
    return e.json(429, { ok: false, error: "Tageslimit erreicht (" + limit + " KI-Analysen pro Tag). Morgen geht's weiter – oder trage manuell ein." });
  }

  let res;
  try {
    res = $http.send({
      url: cfg.aiPhotoServiceUrl.replace(/\/parse-photo$/, "/analyze-meal"),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": cfg.aiPhotoInternalSecret
      },
      body: JSON.stringify({ imageBase64: data.imageBase64, mimeType: data.mimeType, text: data.text }),
      timeout: 60
    });
  } catch (err) {
    console.log("ai-meal-analyze Hook-Fehler", err);
    return e.json(502, { ok: false, error: "KI-Analyse fehlgeschlagen" });
  }

  let parsed = {};
  try { parsed = JSON.parse(res.raw || "{}"); } catch (_) { parsed = { ok: false, error: "KI-Analyse fehlgeschlagen" }; }

  if (res.statusCode === 200 && parsed.ok) {
    try {
      const rec = usage || new Record($app.findCollectionByNameOrId("ai_usage"));
      if (!usage) { rec.set("user", user.id); rec.set("day", day); rec.set("kind", "meal"); }
      rec.set("count", used + 1);
      $app.save(rec);
    } catch (err) {
      console.log("ai-meal-analyze Kontingent-Fehler", err);
    }
    parsed.remaining = Math.max(0, limit - used - 1);
  }
  return e.json(res.statusCode || 502, parsed);
}, $apis.requireAuth("users"));
