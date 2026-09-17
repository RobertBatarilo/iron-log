/// <reference path="../pb_data/types.d.ts" />

// Fix: "Kontingente konnten nicht geladen werden" beim Anlegen eines Pakets.
// membership_plans wurde per new Collection({fields:[...]}) angelegt (statt ueber die
// Admin-UI), wo created/updated NICHT automatisch als Felder ergaenzt werden - anders als
// z.B. bei bookings. index.html (loadBoxMemberDetail) sortiert aber nach "-created", was
// serverseitig fehlschlaegt, weil das Feld nicht existiert. Fix: die beiden Autodate-Felder
// nachtraeglich ergaenzen, exakt wie bei bookings.created/bookings.updated.
migrate((app) => {
  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false,
  }));
  plans.fields.add(new AutodateField({
    name: "updated",
    onCreate: true,
    onUpdate: true,
  }));
  app.save(plans);
}, (app) => {
  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.fields.removeByName("created");
  plans.fields.removeByName("updated");
  app.save(plans);
});
