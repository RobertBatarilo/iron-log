/// <reference path="../pb_data/types.d.ts" />

// Guthabenkarten & Bonusprogramme (Phase 1 - Prototyp): Boxen verkaufen vorausbezahlte
// Produktpakete (z.B. "10er Shake-Karte"), Athleten kaufen sie ueber Stripe Checkout,
// Einloesung erfolgt per QR-Code an der Theke (echtes NFC ist eine spaetere Erweiterung,
// siehe credit_redemption_proofs.method).
//
// Wie bei membership_plans (1789504472_membership_plans_and_booking_quota.js) wird das
// "verbleibende Guthaben" NICHT als Zaehler gespeichert, sondern aus credit_transactions
// (Ledger, append-only) berechnet - clientseitig fuer die Anzeige (computeCardBalance() in
// index.html), serverseitig erneut und verbindlich im Einloese-Hook selbst.
//
// Neue Konventionen in diesem Modul (bisher ungenutzt im Repo):
// - Geld als Integer-Cent (Felder mit "Cents"-Suffix), da amount-Felder bisher nie echtes
//   Geld mit Rundungsanforderung abbildeten.
// - Unique-Index als Idempotenz-Schluessel (stripeCheckoutSessionId, operationId, token) -
//   verhindert Doppel-Gutschrift/-Abbuchung bei doppelt zugestellten Webhooks oder
//   gleichzeitigen Requests, selbst wenn die Anwendungslogik einen Fehler haette.
//
// Alle sechs Collections sind ausschliesslich serverseitig beschreibbar (createRule/
// updateRule/deleteRule: null) - jede Mutation laeuft ueber einen routerAdd-Hook, der
// $app.save() nutzt (umgeht die API-Regeln) und VOR dem Schreiben serverseitig prueft.
// Ausnahme: credit_offers (Coach verwaltet Angebote direkt per REST, kein Atomaritaets-
// Risiko) und box_payment_accounts/-lesen (nur Owner).
//
// Unique-Index-Syntax (indexes-Array) und JSONField gegen PocketBase 0.40.1 (Live-Server,
// Stand 2026-09-22) via /pb_data/types.d.ts verifiziert.
migrate((app) => {
  const boxes = app.findCollectionByNameOrId("boxes");
  const users = app.findCollectionByNameOrId("users");

  // 1) credit_offers - das verkaufbare Angebot einer Box.
  const offers = new Collection({
    type: "base",
    name: "credit_offers",
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    updateRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    deleteRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    fields: [
      { name: "box", type: "relation", required: true, collectionId: boxes.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
      { name: "title", type: "text", required: true },
      { name: "description", type: "text", required: false },
      { name: "unitLabel", type: "text", required: true },
      { name: "unitsGranted", type: "number", required: true },
      // "Zusaetzliche Gratiseinheiten" aus der Angebots-Tabelle: Paketbonus-Modell
      // ("10 kaufen, 11 erhalten") direkt am Angebot, unabhaengig vom spaeteren
      // Sammelbonus-Regelwerk (bonus_rules, Phase 2).
      { name: "bonusUnitsIncluded", type: "number", required: false },
      { name: "priceCents", type: "number", required: true },
      { name: "currency", type: "select", required: true, maxSelect: 1, values: ["eur"] },
      // "active"/"paused" = Verkaufsstatus, vom Coach umschaltbar (Angebot bleibt dieselbe
      // Version). "archived" = durch eine neue Version ersetzt (Preis/Menge geaendert),
      // nie wieder aktivierbar - siehe Kommentarkopf ("Preisaenderungen mutieren nie...").
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "paused", "archived"] },
      // Phase 2: Relation auf eine noch nicht existierende bonus_rules-Collection kommt
      // erst mit dem Bonusprogramm-Modul dazu (Relation-Felder brauchen eine echte
      // collectionId, die es fuer bonus_rules in Phase 1 noch nicht gibt).
      { name: "locationId", type: "text", required: false },
      { name: "createdBy", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    ],
  });
  offers.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  offers.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(offers);

  // 2) box_payment_accounts - Stripe-Connect-Zuordnung, eigene Collection statt Felder auf
  // "boxes" (breit gelesen), damit Connect-Status nicht ungewollt mitgelesen wird.
  const paymentAccounts = new Collection({
    type: "base",
    name: "box_payment_accounts",
    listRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    viewRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "box", type: "relation", required: true, collectionId: boxes.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
      { name: "stripeAccountId", type: "text", required: false },
      { name: "onboardingStatus", type: "select", required: true, maxSelect: 1, values: ["not_started", "pending", "complete", "restricted"] },
      { name: "chargesEnabled", type: "bool", required: false },
      { name: "payoutsEnabled", type: "bool", required: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_box_payment_accounts_box ON box_payment_accounts (box)",
    ],
  });
  paymentAccounts.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  paymentAccounts.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(paymentAccounts);

  // 3) credit_orders - ein Kaufversuch, Idempotenz-Anker fuer den Stripe-Webhook.
  const orders = new Collection({
    type: "base",
    name: "credit_orders",
    listRule: '@request.auth.id != "" && (buyer = @request.auth.id || box.owner = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (buyer = @request.auth.id || box.owner = @request.auth.id)',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "box", type: "relation", required: true, collectionId: boxes.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "buyer", type: "relation", required: true, collectionId: users.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "offer", type: "relation", required: true, collectionId: offers.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      // Eingefrorene Konditionen zum Kaufzeitpunkt (title/unitLabel/unitsGranted/
      // bonusUnitsIncluded/priceCents) - spaetere Angebotsaenderungen duerfen diesen
      // Kauf nie ruckwirkend veraendern.
      { name: "offerSnapshot", type: "json", required: true, maxSize: 20000 },
      { name: "stripeCheckoutSessionId", type: "text", required: true },
      { name: "stripePaymentIntentId", type: "text", required: false },
      { name: "amountCents", type: "number", required: true },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "paid", "failed", "expired"] },
      // "card" kommt erst weiter unten dazu, NACHDEM credit_cards existiert (siehe dort) -
      // ein Platzhalter-Feld, das anschliessend auf eine andere Collection "umgebogen"
      // wuerde, lehnt PocketBase ab ("the relation collection cannot be changed").
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_credit_orders_stripe_session ON credit_orders (stripeCheckoutSessionId)",
    ],
  });
  orders.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  orders.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(orders);

  // 4) credit_cards - die gekaufte Karte. Bewusst KEIN Balance-Feld (siehe Kommentarkopf).
  const cards = new Collection({
    type: "base",
    name: "credit_cards",
    listRule: '@request.auth.id != "" && (owner = @request.auth.id || box.owner = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (owner = @request.auth.id || box.owner = @request.auth.id)',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "box", type: "relation", required: true, collectionId: boxes.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "owner", type: "relation", required: true, collectionId: users.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "offer", type: "relation", required: true, collectionId: offers.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "offerSnapshot", type: "json", required: true, maxSize: 20000 },
      { name: "order", type: "relation", required: true, collectionId: orders.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["active", "expired", "revoked"] },
      { name: "expiresAt", type: "date", required: false },
    ],
  });
  cards.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  cards.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(cards);

  // credit_orders.card erst jetzt als GANZ NEUES Feld hinzufuegen (nicht vorher als
  // Platzhalter angelegt und "umgebogen", siehe Kommentar oben) - credit_cards existiert
  // erst ab hier, also war das vorher schlicht nicht moeglich.
  orders.fields.add(new RelationField({ name: "card", required: false, collectionId: cards.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 }));
  app.save(orders);

  // 5) credit_transactions - das Ledger, append-only (keine updateRule, kein "updated"-Feld).
  const transactions = new Collection({
    type: "base",
    name: "credit_transactions",
    listRule: '@request.auth.id != "" && (card.owner = @request.auth.id || card.box.owner = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (card.owner = @request.auth.id || card.box.owner = @request.auth.id)',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "card", type: "relation", required: true, collectionId: cards.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "type", type: "select", required: true, maxSelect: 1, values: ["purchase_grant", "bonus_grant", "redemption", "correction"] },
      { name: "deltaUnits", type: "number", required: true },
      { name: "operationId", type: "text", required: true },
      // "redemptionProof" kommt erst weiter unten dazu, NACHDEM credit_redemption_proofs
      // existiert (gleicher Grund wie bei credit_orders.card oben).
      { name: "performedBy", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "note", type: "text", required: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_credit_transactions_operation ON credit_transactions (operationId)",
    ],
  });
  transactions.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  app.save(transactions);

  // 6) credit_redemption_proofs - der QR-/(spaeter NFC-)Nachweis, bewusst vom Ledger
  // getrennt, damit der Nachweis-Mechanismus austauschbar bleibt (method: qr|nfc).
  const proofs = new Collection({
    type: "base",
    name: "credit_redemption_proofs",
    listRule: '@request.auth.id != "" && (card.owner = @request.auth.id || card.box.owner = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (card.owner = @request.auth.id || card.box.owner = @request.auth.id)',
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "card", type: "relation", required: true, collectionId: cards.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "box", type: "relation", required: true, collectionId: boxes.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
      { name: "method", type: "select", required: true, maxSelect: 1, values: ["qr", "nfc"] },
      { name: "token", type: "text", required: true },
      { name: "unitsRequested", type: "number", required: true },
      { name: "expiresAt", type: "date", required: true },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["issued", "consumed", "expired", "cancelled"] },
      { name: "consumedAt", type: "date", required: false },
      { name: "consumedBy", type: "relation", required: false, collectionId: users.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_credit_redemption_proofs_token ON credit_redemption_proofs (token)",
    ],
  });
  proofs.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  app.save(proofs);

  // credit_transactions.redemptionProof erst jetzt als GANZ NEUES Feld hinzufuegen (gleicher
  // Grund wie bei credit_orders.card oben).
  transactions.fields.add(new RelationField({ name: "redemptionProof", required: false, collectionId: proofs.id, cascadeDelete: false, minSelect: 0, maxSelect: 1 }));
  app.save(transactions);
}, (app) => {
  const names = [
    "credit_redemption_proofs",
    "credit_transactions",
    "credit_cards",
    "credit_orders",
    "box_payment_accounts",
    "credit_offers",
  ];
  for (const name of names) {
    const c = app.findCollectionByNameOrId(name);
    if (c) app.delete(c);
  }
});
