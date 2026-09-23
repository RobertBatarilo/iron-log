/// <reference path="../pb_data/types.d.ts" />

// Guthabenkarten-Kauf: Stripe Checkout (Connect Destination Charges, ein Konto pro Box)
// + Stripe-Connect-Onboarding fuer Boxen. Die eigentliche Webhook-Signaturpruefung
// passiert NICHT hier (PocketBase-JSVM hat kein HMAC-Primitiv/keine npm-Pakete), sondern
// im separaten Sidecar-Dienst stripe-webhook-service/, der nach erfolgreicher Pruefung
// per internem X-Internal-Secret-Header hierher zurueckruft (/credit/order-fulfilled,
// /credit/connect-account-updated) - Muster wie push-service/ai-photo-service, nur in
// umgekehrter Richtung (Sidecar -> PocketBase statt PocketBase -> Sidecar).
//
// require() bewusst INNERHALB jedes Handlers (JSVM-Runtime-Pooling-Gotcha, siehe
// ai_photo_parse.pb.js). WICHTIG, hier am eigenen Leib erlebt: die Pooling-Falle betrifft
// NICHT nur require()-Aufrufe, sondern auch ganz normale function-Deklarationen auf
// Modul-Ebene einer .pb.js-Datei - ein Handler kann in einer anderen JSVM-Instanz laufen,
// die diese Funktion nie gesehen hat ("ReferenceError: x is not defined" in Produktion,
// obwohl es beim Schreiben/Testen des Hooks unauffaellig war). Deshalb liegen
// toStripeFormBody()/stripeRequest() in credit_helpers.js und werden hier IMMER frisch
// per require() geholt, nie als lokale Funktion definiert.
// e.request.header.get(...) (kleines "g" - Go-Methode Header.Get wird im JSVM lowercase
// gebunden) und $app.runInTransaction(...) gegen PocketBase 0.40.1 (Live-Server, Stand
// 2026-09-22) via /pb_data/types.d.ts verifiziert.

routerAdd("POST", "/credit/checkout-session", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const helpers = require(`${__hooks}/credit_helpers.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const data = new DynamicModel({ offerId: "" });
  e.bindBody(data);
  if (!data.offerId) return e.json(400, { ok: false, error: "offerId fehlt" });

  let offer;
  try { offer = $app.findRecordById("credit_offers", data.offerId); }
  catch (err) { return e.json(404, { ok: false, error: "Angebot nicht gefunden" }); }
  if (offer.getString("status") !== "active") {
    return e.json(400, { ok: false, error: "Angebot ist nicht mehr aktiv" });
  }

  const boxId = offer.getString("box");
  let paymentAccount;
  try {
    paymentAccount = $app.findFirstRecordByFilter("box_payment_accounts", `box = {:boxId}`, { boxId });
  } catch (err) {
    return e.json(400, { ok: false, error: "Zahlungen fuer diese Box noch nicht eingerichtet" });
  }
  if (!paymentAccount.getBool("chargesEnabled")) {
    return e.json(400, { ok: false, error: "Zahlungen fuer diese Box noch nicht eingerichtet" });
  }

  const offerSnapshot = {
    title: offer.getString("title"),
    unitLabel: offer.getString("unitLabel"),
    unitsGranted: offer.getInt("unitsGranted"),
    bonusUnitsIncluded: offer.getInt("bonusUnitsIncluded") || 0,
    priceCents: offer.getInt("priceCents"),
    currency: offer.getString("currency"),
  };

  const orders = $app.findCollectionByNameOrId("credit_orders");
  const order = new Record(orders);
  order.set("box", boxId);
  order.set("buyer", user.id);
  order.set("offer", offer.id);
  order.set("offerSnapshot", offerSnapshot);
  order.set("stripeCheckoutSessionId", "pending-" + order.id); // Platzhalter, unten ueberschrieben
  order.set("amountCents", offerSnapshot.priceCents);
  order.set("status", "pending");
  $app.save(order);

  let session;
  try {
    session = helpers.stripeRequest(cfg, "checkout/sessions", helpers.toStripeFormBody({
      mode: "payment",
      "line_items[0][price_data][currency]": offerSnapshot.currency,
      "line_items[0][price_data][unit_amount]": offerSnapshot.priceCents,
      "line_items[0][price_data][product_data][name]": offerSnapshot.title,
      "line_items[0][quantity]": 1,
      "payment_intent_data[transfer_data][destination]": paymentAccount.getString("stripeAccountId"),
      "metadata[creditOrderId]": order.id,
      success_url: cfg.appBaseUrl + "?creditOrder=" + order.id + "&status=success",
      cancel_url: cfg.appBaseUrl + "?creditOrder=" + order.id + "&status=cancel",
    }));
  } catch (err) {
    console.log("credit_checkout Stripe-Fehler", err);
    $app.delete(order);
    return e.json(502, { ok: false, error: "Zahlungsanbieter nicht erreichbar" });
  }

  order.set("stripeCheckoutSessionId", session.id);
  $app.save(order);

  return e.json(200, { ok: true, checkoutUrl: session.url, orderId: order.id });
}, $apis.requireAuth("users"));

// Wird vom stripe-webhook-service NACH erfolgreicher Signaturpruefung aufgerufen.
// Idempotent: ein bereits "paid" Order-Datensatz fuehrt zu keiner erneuten Gutschrift -
// macht Stripes automatische Webhook-Redeliveries sicher.
routerAdd("POST", "/credit/order-fulfilled", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const helpers = require(`${__hooks}/credit_helpers.js`);
  if (e.request.header.get("X-Internal-Secret") !== cfg.stripeWebhookInternalSecret) {
    return e.json(401, { ok: false, error: "unauthorized" });
  }

  const data = new DynamicModel({ creditOrderId: "", stripeSessionId: "", stripePaymentIntentId: "" });
  e.bindBody(data);

  let order;
  try { order = $app.findRecordById("credit_orders", data.creditOrderId); }
  catch (err) { return e.json(404, { ok: false, error: "Order nicht gefunden" }); }

  if (order.getString("stripeCheckoutSessionId") !== data.stripeSessionId) {
    return e.json(409, { ok: false, error: "Session-Mismatch" });
  }
  if (order.getString("status") === "paid") {
    return e.json(200, { ok: true, alreadyProcessed: true });
  }

  try {
    $app.runInTransaction((txApp) => {
      const freshOrder = txApp.findRecordById("credit_orders", order.id);
      if (freshOrder.getString("status") === "paid") return; // Race: parallele Zustellung war schneller

      const snapshot = freshOrder.get("offerSnapshot") || {};
      const cardsCollection = txApp.findCollectionByNameOrId("credit_cards");
      const card = new Record(cardsCollection);
      card.set("box", freshOrder.getString("box"));
      card.set("owner", freshOrder.getString("buyer"));
      card.set("offer", freshOrder.getString("offer"));
      card.set("offerSnapshot", snapshot);
      card.set("order", freshOrder.id);
      card.set("status", "active");
      txApp.save(card);

      const txCollection = txApp.findCollectionByNameOrId("credit_transactions");
      const grantTx = new Record(txCollection);
      grantTx.set("card", card.id);
      grantTx.set("type", "purchase_grant");
      grantTx.set("deltaUnits", snapshot.unitsGranted || 0);
      grantTx.set("operationId", helpers.operationIdForOrder(freshOrder.id));
      txApp.save(grantTx);

      if (snapshot.bonusUnitsIncluded > 0) {
        const bonusTx = new Record(txCollection);
        bonusTx.set("card", card.id);
        bonusTx.set("type", "bonus_grant");
        bonusTx.set("deltaUnits", snapshot.bonusUnitsIncluded);
        bonusTx.set("operationId", helpers.operationIdForOrder(freshOrder.id) + ":bonus");
        bonusTx.set("note", "Im Paket enthaltene Gratiseinheiten");
        txApp.save(bonusTx);
      }

      freshOrder.set("status", "paid");
      freshOrder.set("card", card.id);
      freshOrder.set("stripePaymentIntentId", data.stripePaymentIntentId || "");
      txApp.save(freshOrder);
    });
  } catch (err) {
    // Unique-Index-Kollision (operationId) bedeutet: eine parallele Zustellung hat
    // bereits gebucht - das ist der Idempotenz-Mechanismus, kein echter Fehler.
    console.log("credit_checkout order-fulfilled Konflikt (vermutlich Doppel-Zustellung)", err);
    return e.json(200, { ok: true, alreadyProcessed: true });
  }

  return e.json(200, { ok: true });
});

// Wird vom stripe-webhook-service bei "checkout.session.expired" aufgerufen.
routerAdd("POST", "/credit/order-expired", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  if (e.request.header.get("X-Internal-Secret") !== cfg.stripeWebhookInternalSecret) {
    return e.json(401, { ok: false, error: "unauthorized" });
  }

  const data = new DynamicModel({ creditOrderId: "", stripeSessionId: "" });
  e.bindBody(data);

  let order;
  try { order = $app.findRecordById("credit_orders", data.creditOrderId); }
  catch (err) { return e.json(200, { ok: true }); } // Order unbekannt -> nichts zu tun

  if (order.getString("stripeCheckoutSessionId") !== data.stripeSessionId) {
    return e.json(200, { ok: true });
  }
  if (order.getString("status") === "pending") {
    order.set("status", "expired");
    $app.save(order);
  }
  return e.json(200, { ok: true });
});

// Stripe-Connect-Onboarding: Box-Owner fordert einen Onboarding-Link an.
routerAdd("POST", "/credit/connect-onboarding-link", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const helpers = require(`${__hooks}/credit_helpers.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const data = new DynamicModel({ boxId: "" });
  e.bindBody(data);
  if (!data.boxId) return e.json(400, { ok: false, error: "boxId fehlt" });

  let box;
  try { box = $app.findRecordById("boxes", data.boxId); }
  catch (err) { return e.json(404, { ok: false, error: "Box nicht gefunden" }); }
  if (box.getString("owner") !== user.id) {
    return e.json(403, { ok: false, error: "Nur der Box-Owner darf Zahlungen einrichten" });
  }

  let account;
  try {
    account = $app.findFirstRecordByFilter("box_payment_accounts", `box = {:boxId}`, { boxId: data.boxId });
  } catch (err) {
    const collection = $app.findCollectionByNameOrId("box_payment_accounts");
    account = new Record(collection);
    account.set("box", data.boxId);
    account.set("onboardingStatus", "not_started");
    $app.save(account);
  }

  if (!account.getString("stripeAccountId")) {
    let stripeAccount;
    try {
      stripeAccount = helpers.stripeRequest(cfg, "accounts", helpers.toStripeFormBody({
        type: "express",
        country: "AT",
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
      }));
    } catch (err) {
      console.log("credit_checkout Connect-Account-Fehler", err);
      return e.json(502, { ok: false, error: "Zahlungsanbieter nicht erreichbar" });
    }
    account.set("stripeAccountId", stripeAccount.id);
    account.set("onboardingStatus", "pending");
    $app.save(account);
  }

  let link;
  try {
    link = helpers.stripeRequest(cfg, "account_links", helpers.toStripeFormBody({
      account: account.getString("stripeAccountId"),
      refresh_url: cfg.appBaseUrl + "?stripeOnboarding=retry",
      return_url: cfg.appBaseUrl + "?stripeOnboarding=done",
      type: "account_onboarding",
    }));
  } catch (err) {
    console.log("credit_checkout Account-Link-Fehler", err);
    return e.json(502, { ok: false, error: "Zahlungsanbieter nicht erreichbar" });
  }

  return e.json(200, { ok: true, url: link.url });
}, $apis.requireAuth("users"));

// Aktiver Status-Refresh, wenn der Box-Owner vom Stripe-Onboarding zurueckkehrt (return_url
// mit ?stripeOnboarding=done, siehe index.html) - fragt den Kontostatus direkt bei Stripe
// ab, statt ausschliesslich auf den account.updated-Webhook zu warten (siehe Kommentar in
// credit_helpers.js:stripeGetRequest). Der Webhook bleibt zusaetzlich fuer SPAETERE
// Statusaenderungen (z.B. nachtraegliche Sperrung) aktiv.
routerAdd("POST", "/credit/connect-refresh-status", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const helpers = require(`${__hooks}/credit_helpers.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const data = new DynamicModel({ boxId: "" });
  e.bindBody(data);
  if (!data.boxId) return e.json(400, { ok: false, error: "boxId fehlt" });

  let box;
  try { box = $app.findRecordById("boxes", data.boxId); }
  catch (err) { return e.json(404, { ok: false, error: "Box nicht gefunden" }); }
  if (box.getString("owner") !== user.id) {
    return e.json(403, { ok: false, error: "Nur der Box-Owner darf das abfragen" });
  }

  let account;
  try {
    account = $app.findFirstRecordByFilter("box_payment_accounts", `box = {:boxId}`, { boxId: data.boxId });
  } catch (err) {
    return e.json(404, { ok: false, error: "Noch keine Zahlungseinrichtung gestartet" });
  }
  const stripeAccountId = account.getString("stripeAccountId");
  if (!stripeAccountId) return e.json(400, { ok: false, error: "Noch kein Stripe-Konto verknuepft" });

  let stripeAccount;
  try {
    stripeAccount = helpers.stripeGetRequest(cfg, "accounts/" + stripeAccountId);
  } catch (err) {
    console.log("credit_checkout Status-Refresh-Fehler", err);
    return e.json(502, { ok: false, error: "Zahlungsanbieter nicht erreichbar" });
  }

  account.set("chargesEnabled", !!stripeAccount.charges_enabled);
  account.set("payoutsEnabled", !!stripeAccount.payouts_enabled);
  account.set("onboardingStatus", stripeAccount.charges_enabled ? "complete" : (stripeAccount.details_submitted ? "restricted" : "pending"));
  $app.save(account);

  return e.json(200, { ok: true, chargesEnabled: account.getBool("chargesEnabled") });
}, $apis.requireAuth("users"));

// Wird vom stripe-webhook-service bei "account.updated" aufgerufen.
routerAdd("POST", "/credit/connect-account-updated", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  if (e.request.header.get("X-Internal-Secret") !== cfg.stripeWebhookInternalSecret) {
    return e.json(401, { ok: false, error: "unauthorized" });
  }

  const data = new DynamicModel({ stripeAccountId: "", chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false });
  e.bindBody(data);

  let account;
  try {
    account = $app.findFirstRecordByFilter("box_payment_accounts", `stripeAccountId = {:id}`, { id: data.stripeAccountId });
  } catch (err) {
    return e.json(404, { ok: false, error: "Kein passendes Konto gefunden" });
  }

  account.set("chargesEnabled", !!data.chargesEnabled);
  account.set("payoutsEnabled", !!data.payoutsEnabled);
  account.set("onboardingStatus", data.chargesEnabled ? "complete" : (data.detailsSubmitted ? "restricted" : "pending"));
  $app.save(account);

  return e.json(200, { ok: true });
});
