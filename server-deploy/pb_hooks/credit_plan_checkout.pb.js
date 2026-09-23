/// <reference path="../pb_data/types.d.ts" />

// Athleten kaufen einmalige Kontingent-Pakete (membership_plan_templates.type=="one-time",
// priceCents gesetzt) direkt per Stripe Checkout - laufende (recurring) Pakete bleiben
// bewusst nur vom Coach zuteilbar (siehe Migration 1790100000). Reine Wiederverwendung der
// bereits bewaehrten Stripe-Bausteine aus credit_checkout.pb.js/credit_helpers.js, aber als
// eigene, additive Route/Collection (plan_orders statt credit_orders) - Details siehe
// Kommentarkopf der Migration.
//
// require() bewusst INNERHALB jedes Handlers, keine Modul-Ebene-Funktionen/Konstanten
// (JSVM-Pooling-Falle, heute live als ReferenceError erlebt, siehe credit_checkout.pb.js).

routerAdd("POST", "/credit/plan-checkout-session", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  const helpers = require(`${__hooks}/credit_helpers.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const data = new DynamicModel({ planTemplateId: "" });
  e.bindBody(data);
  if (!data.planTemplateId) return e.json(400, { ok: false, error: "planTemplateId fehlt" });

  let template;
  try { template = $app.findRecordById("membership_plan_templates", data.planTemplateId); }
  catch (err) { return e.json(404, { ok: false, error: "Paket nicht gefunden" }); }
  if (template.getString("type") !== "one-time") {
    return e.json(400, { ok: false, error: "Nur einmalige Pakete koennen gekauft werden" });
  }
  const priceCents = template.getInt("priceCents");
  if (!priceCents || priceCents <= 0) {
    return e.json(400, { ok: false, error: "Dieses Paket ist nicht kaeuflich" });
  }

  const boxId = template.getString("box");
  let membership;
  try {
    membership = $app.findFirstRecordByFilter("memberships", `box = {:boxId} && user = {:userId} && status = "active"`, { boxId, userId: user.id });
  } catch (err) {
    return e.json(403, { ok: false, error: "Keine aktive Mitgliedschaft in dieser Box" });
  }

  let paymentAccount;
  try {
    paymentAccount = $app.findFirstRecordByFilter("box_payment_accounts", `box = {:boxId}`, { boxId });
  } catch (err) {
    return e.json(400, { ok: false, error: "Zahlungen fuer diese Box noch nicht eingerichtet" });
  }
  if (!paymentAccount.getBool("chargesEnabled")) {
    return e.json(400, { ok: false, error: "Zahlungen fuer diese Box noch nicht eingerichtet" });
  }

  const templateSnapshot = {
    name: template.getString("name"),
    type: template.getString("type"),
    amount: template.getInt("amount"),
    priceCents,
  };

  const ordersCollection = $app.findCollectionByNameOrId("plan_orders");
  const order = new Record(ordersCollection);
  order.set("box", boxId);
  order.set("buyer", user.id);
  order.set("membership", membership.id);
  order.set("planTemplate", template.id);
  order.set("templateSnapshot", templateSnapshot);
  order.set("stripeCheckoutSessionId", "pending-" + order.id); // Platzhalter, unten ueberschrieben
  order.set("amountCents", priceCents);
  order.set("status", "pending");
  $app.save(order);

  let session;
  try {
    session = helpers.stripeRequest(cfg, "checkout/sessions", helpers.toStripeFormBody({
      mode: "payment",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": priceCents,
      "line_items[0][price_data][product_data][name]": templateSnapshot.name,
      "line_items[0][quantity]": 1,
      "payment_intent_data[transfer_data][destination]": paymentAccount.getString("stripeAccountId"),
      "metadata[planOrderId]": order.id,
      success_url: cfg.appBaseUrl + "?planOrder=" + order.id + "&status=success",
      cancel_url: cfg.appBaseUrl + "?planOrder=" + order.id + "&status=cancel",
    }));
  } catch (err) {
    console.log("credit_plan_checkout Stripe-Fehler", err);
    $app.delete(order);
    return e.json(502, { ok: false, error: "Zahlungsanbieter nicht erreichbar" });
  }

  order.set("stripeCheckoutSessionId", session.id);
  $app.save(order);

  return e.json(200, { ok: true, checkoutUrl: session.url, orderId: order.id });
}, $apis.requireAuth("users"));

// Wird vom stripe-webhook-service NACH erfolgreicher Signaturpruefung aufgerufen, sobald das
// metadata-Feld "planOrderId" (statt "creditOrderId") im Checkout-Event steht.
routerAdd("POST", "/credit/plan-order-fulfilled", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  if (e.request.header.get("X-Internal-Secret") !== cfg.stripeWebhookInternalSecret) {
    return e.json(401, { ok: false, error: "unauthorized" });
  }

  const data = new DynamicModel({ planOrderId: "", stripeSessionId: "", stripePaymentIntentId: "" });
  e.bindBody(data);

  let order;
  try { order = $app.findRecordById("plan_orders", data.planOrderId); }
  catch (err) { return e.json(404, { ok: false, error: "Order nicht gefunden" }); }

  if (order.getString("stripeCheckoutSessionId") !== data.stripeSessionId) {
    return e.json(409, { ok: false, error: "Session-Mismatch" });
  }
  if (order.getString("status") === "paid") {
    return e.json(200, { ok: true, alreadyProcessed: true });
  }

  try {
    $app.runInTransaction((txApp) => {
      const freshOrder = txApp.findRecordById("plan_orders", order.id);
      if (freshOrder.getString("status") === "paid") return; // Race: parallele Zustellung war schneller

      // Byte-Array-artiges JSON-Feld -> String() -> JSON.parse(), siehe credit_checkout.pb.js.
      let snapshot = {};
      try { snapshot = JSON.parse(String(freshOrder.get("templateSnapshot") || "{}")); }
      catch (parseErr) { snapshot = {}; }

      const plansCollection = txApp.findCollectionByNameOrId("membership_plans");
      const plan = new Record(plansCollection);
      plan.set("membership", freshOrder.getString("membership"));
      plan.set("type", "one-time");
      plan.set("amount", snapshot.amount || 0);
      plan.set("startDate", new Date().toISOString().slice(0, 10));
      plan.set("status", "active");
      plan.set("name", snapshot.name || "");
      plan.set("note", "Selbst gekauft");
      txApp.save(plan);

      freshOrder.set("status", "paid");
      freshOrder.set("membershipPlan", plan.id);
      freshOrder.set("stripePaymentIntentId", data.stripePaymentIntentId || "");
      txApp.save(freshOrder);
    });
  } catch (err) {
    console.log("credit_plan_checkout plan-order-fulfilled ECHTER FEHLER", err);
    return e.json(500, { ok: false, error: "Verarbeitung fehlgeschlagen" });
  }

  return e.json(200, { ok: true });
});

// Wird vom stripe-webhook-service bei "checkout.session.expired" aufgerufen.
routerAdd("POST", "/credit/plan-order-expired", (e) => {
  const cfg = require(`${__hooks}/config.local.js`);
  if (e.request.header.get("X-Internal-Secret") !== cfg.stripeWebhookInternalSecret) {
    return e.json(401, { ok: false, error: "unauthorized" });
  }

  const data = new DynamicModel({ planOrderId: "", stripeSessionId: "" });
  e.bindBody(data);

  let order;
  try { order = $app.findRecordById("plan_orders", data.planOrderId); }
  catch (err) { return e.json(200, { ok: true }); }

  if (order.getString("stripeCheckoutSessionId") !== data.stripeSessionId) {
    return e.json(200, { ok: true });
  }
  if (order.getString("status") === "pending") {
    order.set("status", "expired");
    $app.save(order);
  }
  return e.json(200, { ok: true });
});
