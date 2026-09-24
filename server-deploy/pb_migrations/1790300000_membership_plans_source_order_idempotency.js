/// <reference path="../pb_data/types.d.ts" />

// Idempotenz-Schutz fuer /credit/plan-order-fulfilled (credit_plan_checkout.pb.js), analog zum
// bereits bewaehrten Unique-Index auf credit_transactions.operationId in
// 1790000000_credit_cards_system.js: der in-Transaktion-Check "status==='paid'?" allein reicht
// nicht als Schutz gegen eine echte parallele Stripe-Webhook-Zustellung (beide Aufrufe koennten
// den Status vor dem jeweils anderen Commit noch als "pending" sehen). Statt eines eigenen
// Ledgers wie bei credit_cards bekommt membership_plans ein optionales sourceOrderId-Feld
// (= plan_orders.id, NUR bei Stripe-Selbstkauf gesetzt), abgesichert durch einen PARTIELLEN
// Unique-Index (SQLite: "WHERE sourceOrderId != ''") - manuell vom Coach angelegte Kontingente
// lassen das Feld leer und kollidieren dadurch NICHT untereinander (ein normaler, nicht-
// partieller Unique-Index wuerde das faelschlich verhindern, da PocketBase optionale Text-
// Felder als leeren String statt NULL speichert).
migrate((app) => {
  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.fields.add(new TextField({ name: "sourceOrderId", required: false }));
  plans.indexes.push("CREATE UNIQUE INDEX idx_membership_plans_source_order ON membership_plans (sourceOrderId) WHERE sourceOrderId != ''");
  app.save(plans);
}, (app) => {
  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.indexes = plans.indexes.filter((idx) => !idx.includes("idx_membership_plans_source_order"));
  plans.fields.removeByName("sourceOrderId");
  app.save(plans);
});
