/// <reference path="../pb_data/types.d.ts" />

// Standardpakete: Coaches koennen wiederverwendbare Kontingent-Vorlagen anlegen
// (z.B. "Laufende Mitgliedschaft", "10er Block CrossFit") und beim Zuteilen an
// einen Athleten daraus waehlen, statt Typ/Menge jedes Mal neu einzutippen.
// Vorlagen werden NICHT live referenziert - Name/Typ/Menge werden beim Anlegen
// einmalig in den membership_plans-Datensatz kopiert (wie schon "note" heute).
// Deshalb reicht ein einfaches Text-Feld "name" auf membership_plans, keine Relation.
migrate((app) => {
  const boxes = app.findCollectionByNameOrId("boxes");

  const templates = new Collection({
    type: "base",
    name: "membership_plan_templates",
    listRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    viewRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    createRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    updateRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    deleteRule: '@request.auth.id != "" && box.owner = @request.auth.id',
    fields: [
      {
        name: "box",
        type: "relation",
        required: true,
        collectionId: boxes.id,
        cascadeDelete: true,
        minSelect: 0,
        maxSelect: 1,
      },
      {
        name: "name",
        type: "text",
        required: true,
      },
      {
        name: "type",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["recurring", "one-time"],
      },
      {
        name: "amount",
        type: "number",
        required: true,
      },
    ],
  });
  templates.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
  templates.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
  app.save(templates);

  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.fields.add(new TextField({ name: "name", required: false }));
  app.save(plans);
}, (app) => {
  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.fields.removeByName("name");
  app.save(plans);

  const templates = app.findCollectionByNameOrId("membership_plan_templates");
  app.delete(templates);
});
