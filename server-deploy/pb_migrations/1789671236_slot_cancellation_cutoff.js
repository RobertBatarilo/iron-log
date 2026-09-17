/// <reference path="../pb_data/types.d.ts" />

// Stornofrist wird von einer Box-weiten Einstellung (boxes.cancellationCutoffHours) zu einer
// Pro-Kurs-Einstellung (schedule_slots.cancellationCutoffHours), damit Coaches fuer
// unterschiedliche Kurse unterschiedliche Fristen festlegen koennen (index.html:
// cancellationDeadline() liest ab jetzt den Slot statt die Box).
// Bestehende, bereits individuell gesetzte Box-Werte werden auf alle Slots der jeweiligen
// Box uebertragen, damit sich das Verhalten fuer schon konfigurierte Boxen nicht
// stillschweigend auf den Default (3h) zuruecksetzt. Das boxes-Feld selbst bleibt
// unangetastet (wird nur nicht mehr gelesen).
migrate((app) => {
  const slots = app.findCollectionByNameOrId("schedule_slots");
  slots.fields.add(new NumberField({
    name: "cancellationCutoffHours",
    required: false,
  }));
  app.save(slots);

  const boxesWithCutoff = app.findRecordsByFilter("boxes", "cancellationCutoffHours != null", "", 0, 0);
  for (const box of boxesWithCutoff) {
    const cutoff = box.getFloat("cancellationCutoffHours");
    const boxSlots = app.findRecordsByFilter("schedule_slots", "box = {:box}", "", 0, 0, { box: box.id });
    for (const slot of boxSlots) {
      slot.set("cancellationCutoffHours", cutoff);
      app.save(slot);
    }
  }
}, (app) => {
  const slots = app.findCollectionByNameOrId("schedule_slots");
  slots.fields.removeByName("cancellationCutoffHours");
  app.save(slots);
});
