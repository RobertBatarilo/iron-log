/// <reference path="../pb_data/types.d.ts" />

// Athleten-Kontingent-System (Coach weist Mitgliedschaften Buchungs-Pakete zu):
// neue Collection "membership_plans" (laufende/einmalige Pakete pro Mitgliedschaft)
// + zwei neue Felder auf "bookings" (membershipPlan, lateCancel), um zu erfassen,
// welches Paket eine Buchung belastet und ob sie als verspaetete Stornierung/No-Show
// gilt. "Verbraucht" wird NICHT hier gespeichert, sondern clientseitig live aus den
// bookings gezaehlt (index.html: computePlanQuota()) - daher kein Zaehler-/Reset-Feld.
migrate((app) => {
  const memberships = app.findCollectionByNameOrId("memberships");

  const plans = new Collection({
    type: "base",
    name: "membership_plans",
    listRule: '@request.auth.id != "" && (membership.user = @request.auth.id || membership.box.owner = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (membership.user = @request.auth.id || membership.box.owner = @request.auth.id)',
    createRule: '@request.auth.id != "" && membership.box.owner = @request.auth.id',
    updateRule: '@request.auth.id != "" && membership.box.owner = @request.auth.id',
    deleteRule: '@request.auth.id != "" && membership.box.owner = @request.auth.id',
    fields: [
      {
        name: "membership",
        type: "relation",
        required: true,
        collectionId: memberships.id,
        cascadeDelete: true,
        minSelect: 0,
        maxSelect: 1,
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
      {
        name: "startDate",
        type: "date",
        required: true,
      },
      {
        name: "status",
        type: "select",
        required: true,
        maxSelect: 1,
        values: ["active", "cancelled"],
      },
      {
        name: "cancelledAt",
        type: "date",
        required: false,
      },
      {
        name: "note",
        type: "text",
        required: false,
      },
    ],
  });
  app.save(plans);

  const bookings = app.findCollectionByNameOrId("bookings");
  bookings.fields.add(new RelationField({
    name: "membershipPlan",
    required: false,
    collectionId: plans.id,
    cascadeDelete: false,
    minSelect: 0,
    maxSelect: 1,
  }));
  bookings.fields.add(new BoolField({
    name: "lateCancel",
    required: false,
  }));
  app.save(bookings);
}, (app) => {
  const bookings = app.findCollectionByNameOrId("bookings");
  bookings.fields.removeByName("membershipPlan");
  bookings.fields.removeByName("lateCancel");
  app.save(bookings);

  const plans = app.findCollectionByNameOrId("membership_plans");
  app.delete(plans);
});
