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
};
