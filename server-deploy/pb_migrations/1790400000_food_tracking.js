/// <reference path="../pb_data/types.d.ts" />

// Ernaehrungstracking: eigene Datensaetze statt eines Sync-Blobs (user_data), weil ein Tagebuch
// mehrmals taeglich beschrieben wird und ein Blob bei jedem Eintrag komplett ueberschrieben
// wuerde (last-write-wins zwischen Geraeten). Rein additiv: drei neue Collections, keine
// bestehende wird veraendert (siehe Hinweis in 1790100000_plan_orders_and_template_pricing.js).
//
// - food_entries: ein Eintrag = eine gegessene Portion in einem frei benennbaren Mahlzeiten-Slot.
//   Naehrwerte sind SUMMEN fuer die gegessene Menge (nicht je 100 g), damit spaetere Aenderungen
//   an Produktdaten die Historie nie veraendern. slotName ist ein Snapshot, damit geloeschte/
//   umbenannte Slots alte Eintraege nicht "verwaist" zurueckLassen.
// - custom_foods: eigene Produkte/Mahlzeiten-Vorlagen des Nutzers (Naehrwerte je 100 g/ml).
// - barcode_cache: globaler Cache fuer Open-Food-Facts-Antworten, nur vom Server-Hook genutzt
//   (keine API-Rules = nur Superuser/Hooks).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const ownRule = '@request.auth.id != "" && user = @request.auth.id';

  const entries = new Collection({
    type: "base",
    name: "food_entries",
    listRule: ownRule,
    viewRule: ownRule,
    createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
    updateRule: ownRule + ' && (@request.body.user:isset = false || @request.body.user = @request.auth.id)',
    deleteRule: ownRule,
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
      { name: "date", type: "text", required: true, max: 10 },
      { name: "slotId", type: "text", required: false, max: 60 },
      { name: "slotName", type: "text", required: false, max: 80 },
      { name: "name", type: "text", required: true, max: 200 },
      { name: "brand", type: "text", required: false, max: 120 },
      { name: "amount", type: "number", required: false },
      { name: "unit", type: "text", required: false, max: 20 },
      { name: "kcal", type: "number", required: false },
      { name: "protein", type: "number", required: false },
      { name: "carbs", type: "number", required: false },
      { name: "fat", type: "number", required: false },
      { name: "fiber", type: "number", required: false },
      { name: "sugar", type: "number", required: false },
      { name: "salt", type: "number", required: false },
      { name: "barcode", type: "text", required: false, max: 20 },
      { name: "source", type: "text", required: false, max: 20 },
      { name: "note", type: "text", required: false, max: 500 },
    ],
    indexes: [
      "CREATE INDEX idx_food_entries_user_date ON food_entries (user, date)",
    ],
  });
  entries.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  entries.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(entries);

  const customFoods = new Collection({
    type: "base",
    name: "custom_foods",
    listRule: ownRule,
    viewRule: ownRule,
    createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
    updateRule: ownRule + ' && (@request.body.user:isset = false || @request.body.user = @request.auth.id)',
    deleteRule: ownRule,
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
      { name: "name", type: "text", required: true, max: 200 },
      { name: "brand", type: "text", required: false, max: 120 },
      { name: "barcode", type: "text", required: false, max: 20 },
      { name: "unit", type: "text", required: false, max: 20 },
      { name: "kcal100", type: "number", required: false },
      { name: "protein100", type: "number", required: false },
      { name: "carbs100", type: "number", required: false },
      { name: "fat100", type: "number", required: false },
      { name: "servingSize", type: "number", required: false },
      { name: "favorite", type: "bool", required: false },
    ],
    indexes: [
      "CREATE INDEX idx_custom_foods_user ON custom_foods (user)",
      "CREATE INDEX idx_custom_foods_user_barcode ON custom_foods (user, barcode)",
    ],
  });
  customFoods.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  customFoods.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(customFoods);

  const cache = new Collection({
    type: "base",
    name: "barcode_cache",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "ean", type: "text", required: true, max: 20 },
      { name: "found", type: "bool", required: false },
      { name: "payload", type: "text", required: false, max: 20000 },
      { name: "fetchedAt", type: "number", required: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_barcode_cache_ean ON barcode_cache (ean)",
    ],
  });
  app.save(cache);
}, (app) => {
  ["barcode_cache", "custom_foods", "food_entries"].forEach((name) => {
    try {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    } catch (_) {}
  });
});
