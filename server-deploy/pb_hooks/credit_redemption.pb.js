/// <reference path="../pb_data/types.d.ts" />

// QR-Einloesung (Phase 1 - echtes NFC folgt spaeter auf derselben credit_redemption_proofs
// -Struktur, siehe Migration 1790000000). Ablauf: Athlet fordert einen kurzlebigen,
// einmaligen Code an (issue) -> Box-Owner scannt ihn an der Zaehltheke (confirm).
//
// Phase 1 hat noch KEIN eigenes Mitarbeiterkonto - /credit/redemption/confirm ist deshalb
// bewusst auf den Box-Owner beschraenkt (isBoxOwner-Aequivalent), siehe index.html
// isBoxAdminView(). Ein Mitarbeiter-PIN-Zugang ist eine spaetere, optionale Erweiterung.
//
// require() bewusst INNERHALB jedes Handlers (JSVM-Runtime-Pooling-Gotcha, siehe
// ai_photo_parse.pb.js). $security.randomString(...) und $app.runInTransaction(...)
// gegen PocketBase 0.40.1 (Live-Server, Stand 2026-09-22) via /pb_data/types.d.ts
// verifiziert.

routerAdd("POST", "/credit/redemption/issue", (e) => {
  const helpers = require(`${__hooks}/credit_helpers.js`);
  // Lokal statt Modul-Ebene (gleicher Grund wie in credit_checkout.pb.js dokumentiert -
  // dort live als ReferenceError aufgetreten): top-level Bindings einer .pb.js-Datei
  // koennen in einer anderen JSVM-Pool-Instanz fehlen.
  const QR_REDEMPTION_TTL_SECONDS = 180;
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const data = new DynamicModel({ cardId: "", unitsRequested: 0 });
  e.bindBody(data);
  const unitsRequested = parseInt(data.unitsRequested) || 0;
  if (!data.cardId || unitsRequested < 1) {
    return e.json(400, { ok: false, error: "cardId/unitsRequested ungueltig" });
  }

  let card;
  try { card = $app.findRecordById("credit_cards", data.cardId); }
  catch (err) { return e.json(404, { ok: false, error: "Karte nicht gefunden" }); }
  if (card.getString("owner") !== user.id) {
    return e.json(403, { ok: false, error: "Nicht deine Karte" });
  }
  if (card.getString("status") !== "active") {
    return e.json(400, { ok: false, error: "Karte ist nicht aktiv" });
  }
  // Echter Date-Vergleich statt Text-Vergleich: PocketBase speichert Datumsfelder mit
  // Leerzeichen statt "T" als Trenner (z.B. "2026-09-23 12:35:18.266Z"), das sortiert
  // als Text IMMER "kleiner" als ein ISO-"T"-String - live beobachtet als Bug, bei dem
  // ein Code sofort als abgelaufen galt, egal wie kurz die tatsaechliche Zeit war.
  const expiresAt = card.getString("expiresAt");
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return e.json(400, { ok: false, error: "Karte ist abgelaufen" });
  }

  const balance = helpers.computeCardBalance(card.id);
  if (unitsRequested > balance.remaining) {
    return e.json(400, { ok: false, error: "Nicht genug Guthaben (noch " + balance.remaining + ")" });
  }

  const proofsCollection = $app.findCollectionByNameOrId("credit_redemption_proofs");
  const proof = new Record(proofsCollection);
  proof.set("card", card.id);
  proof.set("box", card.getString("box"));
  proof.set("method", "qr");
  proof.set("token", $security.randomString(32));
  proof.set("unitsRequested", unitsRequested);
  proof.set("expiresAt", new Date(Date.now() + QR_REDEMPTION_TTL_SECONDS * 1000).toISOString());
  proof.set("status", "issued");
  $app.save(proof);

  return e.json(200, {
    ok: true,
    token: proof.getString("token"),
    cardId: card.id,
    unitsRequested,
    expiresAt: proof.getString("expiresAt"),
    remainingBeforeRedemption: balance.remaining,
  });
}, $apis.requireAuth("users"));

routerAdd("POST", "/credit/redemption/confirm", (e) => {
  const helpers = require(`${__hooks}/credit_helpers.js`);
  const staff = e.auth;
  if (!staff) return e.json(401, { ok: false, error: "unauthorized" });

  const data = new DynamicModel({ token: "" });
  e.bindBody(data);
  if (!data.token) return e.json(400, { ok: false, error: "token fehlt" });

  let proof;
  try {
    proof = $app.findFirstRecordByFilter("credit_redemption_proofs", `token = {:token}`, { token: data.token });
  } catch (err) {
    return e.json(404, { ok: false, error: "Ungueltiger Code" });
  }

  let box;
  try { box = $app.findRecordById("boxes", proof.getString("box")); }
  catch (err) { return e.json(404, { ok: false, error: "Box nicht gefunden" }); }
  // Phase 1: nur der Box-Owner darf einloesen (kein Mitarbeiterkonto, siehe Kommentarkopf).
  if (box.getString("owner") !== staff.id) {
    return e.json(403, { ok: false, error: "Nicht deine Box" });
  }

  // Echter Date-Vergleich, gleicher Grund wie oben bei card.expiresAt.
  if (new Date(proof.getString("expiresAt")).getTime() < Date.now()) {
    if (proof.getString("status") === "issued") {
      proof.set("status", "expired");
      $app.save(proof);
    }
    return e.json(410, { ok: false, error: "Code abgelaufen" });
  }

  let result;
  try {
    result = $app.runInTransaction((txApp) => {
      const freshProof = txApp.findRecordById("credit_redemption_proofs", proof.id);
      if (freshProof.getString("status") !== "issued") {
        return { conflict: true };
      }

      const cardId = freshProof.getString("card");
      const unitsRequested = freshProof.getInt("unitsRequested");
      // Letzte-Einheit-Schutz: Neuberechnung INNERHALB derselben Transaktion (txApp),
      // damit eine parallele Einloesung desselben Guthabens hier sicher sichtbar ist -
      // siehe Kommentar in credit_helpers.js.
      const balance = helpers.computeCardBalance(cardId, txApp);
      if (unitsRequested > balance.remaining) {
        return { insufficientBalance: true, remaining: balance.remaining };
      }

      freshProof.set("status", "consumed");
      freshProof.set("consumedAt", new Date().toISOString());
      freshProof.set("consumedBy", staff.id);
      txApp.save(freshProof);

      const txCollection = txApp.findCollectionByNameOrId("credit_transactions");
      const redemptionTx = new Record(txCollection);
      redemptionTx.set("card", cardId);
      redemptionTx.set("type", "redemption");
      redemptionTx.set("deltaUnits", -unitsRequested);
      redemptionTx.set("operationId", helpers.operationIdForRedemption(freshProof.id));
      redemptionTx.set("redemptionProof", freshProof.id);
      redemptionTx.set("performedBy", staff.id);
      txApp.save(redemptionTx);

      const newBalance = helpers.computeCardBalance(cardId, txApp);
      return { ok: true, cardId, unitsRedeemed: unitsRequested, remaining: newBalance.remaining };
    });
  } catch (err) {
    console.log("credit_redemption confirm Konflikt", err);
    return e.json(409, { ok: false, error: "Code bereits verwendet" });
  }

  if (result.conflict) return e.json(409, { ok: false, error: "Code bereits verwendet" });
  if (result.insufficientBalance) return e.json(400, { ok: false, error: "Nicht genug Guthaben (noch " + result.remaining + ")" });
  return e.json(200, result);
}, $apis.requireAuth("users"));
