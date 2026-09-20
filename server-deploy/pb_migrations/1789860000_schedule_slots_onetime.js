/// <reference path="../pb_data/types.d.ts" />

// Einmalige Termine (Sonderklassen) neben den bisher ausschliesslich
// woechentlich wiederkehrenden schedule_slots. oneTimeDate hat beim Matching
// in ensureClassInstancesForDate() (index.html) Vorrang vor weekday - weekday
// wird bei einmaligen Terminen trotzdem automatisch aus dem Datum mitgespeichert
// (rein informativ), um keine Annahmen ueber Pflichtfelder im Schema zu brauchen.
migrate((app) => {
  const slots = app.findCollectionByNameOrId("schedule_slots");
  slots.fields.add(new DateField({ name: "oneTimeDate", required: false }));
  app.save(slots);
}, (app) => {
  const slots = app.findCollectionByNameOrId("schedule_slots");
  slots.fields.removeByName("oneTimeDate");
  app.save(slots);
});
