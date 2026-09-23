/// <reference path="../pb_data/types.d.ts" />

// Athleten koennen einmalige Kontingent-Pakete (membership_plan_templates.type=="one-time")
// jetzt selbst per Stripe kaufen - laufende (recurring) Pakete bleiben bewusst dem Coach
// vorbehalten (monatliche Zahlung/Kuendigung soll nicht selbstbedient sein).
//
// Bewusst eine EIGENE, neue Collection "plan_orders" statt credit_orders wiederzuverwenden:
// credit_orders.offer/card sind "required:true" - das nachtraeglich auf "required:false"
// umzustellen haette dieselbe Risikoklasse wie der Migrationsfehler von vorhin
// (1790000000_credit_cards_system.js, "the relation collection cannot be changed"). Eine
// komplett neue, rein additive Collection ist hier das sicherere Muster. Die Stripe-API-
// Aufrufe (credit_helpers.js: stripeRequest/toStripeFormBody) und der Sidecar fuer die
// Webhook-Signaturpruefung werden trotzdem 1:1 wiederverwendet, nur die Fulfillment-Logik
// ist neu (hier: ein einzelner membership_plans-Datensatz statt Karte+Ledger-Buchungen).
//
// "priceCents" auf membership_plan_templates ist optional: leer/0 = weiterhin nur vom
// Coach manuell zuteilbar (bestehendes Verhalten unveraendert), gesetzt = fuer Athleten
// kaeuflich. listRule/viewRule der Templates werden dafuer von "nur Coach" auf "jeder
// eingeloggte Nutzer" gelockert (gleiches, bereits bewaehrtes Muster wie bei credit_offers -
// Templates enthalten keine sensiblen Daten).
migrate((app) => {
  const boxes = app.findCollectionByNameOrId("boxes");
  const users = app.findCollectionByNameOrId("users");
  const memberships = app.findCollectionByNameOrId("memberships");
  const templates = app.findCollectionByNameOrId("membership_plan_templates");
  const plans = app.findCollectionByNameOrId("membership_plans");

  templates.fields.add(new NumberField({ name: "priceCents", required: false }));
  templates.listRule = '@request.auth.id != ""';
  templates.viewRule = '@request.auth.id != ""';
  app.save(templates);

  const orders = new Collection({
    type: "base",
    name: "plan_orders",
    listRule: '@request.auth.id != "" && (buyer = @request.auth.id || box.owner = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (buyer = @request.auth.id || box.owner = @request.auth.id)',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "box", type: "relation", required: true, collectionId: boxes.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "buyer", type: "relation", required: true, collectionId: users.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "membership", type: "relation", required: true, collectionId: memberships.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "planTemplate", type: "relation", required: true, collectionId: templates.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      // Eingefrorene Konditionen zum Kaufzeitpunkt (name/type/amount/priceCents) - spaetere
      // Aenderungen an der Vorlage duerfen einen bereits laufenden Kauf nie beeinflussen.
      { name: "templateSnapshot", type: "json", required: true, maxSize: 20000 },
      { name: "stripeCheckoutSessionId", type: "text", required: true },
      { name: "stripePaymentIntentId", type: "text", required: false },
      { name: "amountCents", type: "number", required: true },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "paid", "failed", "expired"] },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_plan_orders_stripe_session ON plan_orders (stripeCheckoutSessionId)",
    ],
  });
  orders.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  orders.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(orders);

  // membershipPlan-Relation erst jetzt hinzufuegen (Collection "plans" existierte vorher
  // schon, aber "orders" musste zuerst existieren, bevor wir hierher zurueckverweisen -
  // reine Reihenfolge, kein Problem wie beim letzten Mal).
  orders.fields.add(new RelationField({ name: "membershipPlan", required: false, collectionId: plans.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 }));
  app.save(orders);
}, (app) => {
  const orders = app.findCollectionByNameOrId("plan_orders");
  if (orders) app.delete(orders);

  const templates = app.findCollectionByNameOrId("membership_plan_templates");
  templates.listRule = '@request.auth.id != "" && box.owner = @request.auth.id';
  templates.viewRule = '@request.auth.id != "" && box.owner = @request.auth.id';
  templates.fields.removeByName("priceCents");
  app.save(templates);
});
