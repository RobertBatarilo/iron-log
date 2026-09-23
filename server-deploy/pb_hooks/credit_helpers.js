/// <reference path="../pb_data/types.d.ts" />

// Gemeinsame Hilfsfunktionen fuer das Guthabenkarten-Modul (credit_checkout.pb.js,
// credit_redemption.pb.js). Wird per require() geladen (Muster wie notify_helper.js).
//
// computeCardBalance() ist die serverseitige Entsprechung von computePlanQuota() in
// index.html: verbleibendes Guthaben wird NIE aus einem gespeicherten Zaehler gelesen,
// sondern hier UND im Client jedes Mal frisch aus credit_transactions aufsummiert. Diese
// Funktion ist die einzige Quelle der Wahrheit fuer die tatsaechliche Abbuchungs-
// Entscheidung (im Client berechnete Werte dienen nur der Anzeige).
module.exports = {
  // appInstance optional: innerhalb einer Transaktion IMMER die txApp aus
  // $app.runInTransaction((txApp) => {...}) uebergeben, nicht das globale $app - sonst
  // sieht die Neuberechnung ggf. nicht die noch nicht committeten Schreibvorgaenge
  // derselben Transaktion (siehe credit_redemption.pb.js: letzte-Einheit-Pruefung).
  computeCardBalance(cardId, appInstance) {
    const app = appInstance || $app;
    const txs = app.findRecordsByFilter(
      "credit_transactions",
      `card = {:cardId}`,
      "",
      0, 0,
      { cardId }
    );
    let grantedUnits = 0;
    let redeemedUnits = 0;
    let correctionUnits = 0;
    for (const tx of txs) {
      const delta = tx.getFloat("deltaUnits") || 0;
      const type = tx.getString("type");
      if (type === "purchase_grant" || type === "bonus_grant") grantedUnits += delta;
      else if (type === "redemption") redeemedUnits += Math.abs(delta);
      else if (type === "correction") correctionUnits += delta;
    }
    const remaining = grantedUnits - redeemedUnits + correctionUnits;
    return { grantedUnits, redeemedUnits, correctionUnits, remaining: Math.max(0, remaining) };
  },

  // Deterministische operationId, damit doppelte Aufrufe (Webhook-Redelivery, doppelter
  // Confirm-Request) am Unique-Index von credit_transactions.operationId scheitern statt
  // doppelt zu buchen.
  operationIdForOrder(orderId) {
    return "order:" + orderId;
  },
  operationIdForRedemption(proofId) {
    return "redeem:" + proofId;
  },

  // Baut einen application/x-www-form-urlencoded Body im von der Stripe-REST-API
  // erwarteten Bracket-Notation-Stil (z.B. line_items[0][price_data][currency]=eur),
  // da im JSVM-Sandbox kein Stripe-SDK verfuegbar ist. Hierher verschoben (statt
  // Modul-Ebene in credit_checkout.pb.js), weil top-level Funktionen einer .pb.js-Datei
  // in einer ANDEREN JSVM-Pool-Instanz als "not defined" auftauchen koennen - dieselbe
  // Pooling-Falle wie bei require() (siehe Kommentarkopf), betrifft aber auch normale
  // Funktionsdeklarationen, nicht nur require(). Deshalb: immer per require() aus dem
  // Handler heraus verwenden, nie als Modul-Level-Funktion in einer .pb.js-Datei.
  toStripeFormBody(obj, prefix) {
    const parts = [];
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      const value = obj[key];
      const fullKey = prefix ? `${prefix}[${key}]` : key;
      if (value === undefined || value === null) continue;
      if (typeof value === "object") {
        parts.push(this.toStripeFormBody(value, fullKey));
      } else {
        parts.push(encodeURIComponent(fullKey) + "=" + encodeURIComponent(String(value)));
      }
    }
    return parts.filter(Boolean).join("&");
  },

  stripeRequest(cfg, path, formBody) {
    const res = $http.send({
      url: "https://api.stripe.com/v1/" + path,
      method: "POST",
      headers: {
        Authorization: "Bearer " + cfg.stripeSecretKey,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody,
    });
    const parsed = JSON.parse(res.raw || "{}");
    if (res.statusCode >= 400) {
      throw new Error("Stripe-Fehler (" + path + "): " + (parsed.error && parsed.error.message || res.raw));
    }
    return parsed;
  },

  // Fuer den aktiven Status-Refresh nach dem Stripe-Onboarding-Rueckkehr-Redirect (statt
  // sich ausschliesslich auf den account.updated-Webhook zu verlassen, der fuer frisch
  // angelegte verbundene Konten je nach Event-Ziel-Konfiguration verzoegert/gar nicht
  // ankommen kann - siehe Plan/Fehlersuche).
  stripeGetRequest(cfg, path) {
    const res = $http.send({
      url: "https://api.stripe.com/v1/" + path,
      method: "GET",
      headers: { Authorization: "Bearer " + cfg.stripeSecretKey },
    });
    const parsed = JSON.parse(res.raw || "{}");
    if (res.statusCode >= 400) {
      throw new Error("Stripe-Fehler (" + path + "): " + (parsed.error && parsed.error.message || res.raw));
    }
    return parsed;
  },
};
