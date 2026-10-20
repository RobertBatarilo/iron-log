/// <reference path="../pb_data/types.d.ts" />

// Tageskontingent fuer KI-Analysen (Kostenschutz): ein Datensatz pro Nutzer, Tag (UTC) und Art
// ("meal" = Mahlzeit-Analyse per Foto/Text). Nur Hooks (Server) lesen/schreiben - keine API-Rules.
// Rein additive neue Collection, keine bestehende wird veraendert.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const usage = new Collection({
    type: "base",
    name: "ai_usage",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "user", type: "relation", required: true, collectionId: users.id, cascadeDelete: true, minSelect: 0, maxSelect: 1 },
      { name: "day", type: "text", required: true, max: 10 },
      { name: "kind", type: "text", required: true, max: 20 },
      { name: "count", type: "number", required: false },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_ai_usage_user_day_kind ON ai_usage (user, day, kind)",
    ],
  });
  usage.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  usage.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(usage);
}, (app) => {
  try {
    const c = app.findCollectionByNameOrId("ai_usage");
    if (c) app.delete(c);
  } catch (_) {}
});
