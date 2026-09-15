/// <reference path="../pb_data/types.d.ts" />

// Bug: Coach/Box-Owner kann Athleten nicht "nachbuchen" (index.html: adminBookAthlete()).
// Die bookings-createRule erlaubte bisher nur @request.body.user = @request.auth.id,
// also ausschliesslich Selbstbuchung. Der Nachbuchen-Button erzeugt aber eine Buchung
// mit user = <anderer Athlet>, was serverseitig mit 400 (Rule-Verletzung) abgelehnt wurde.
// Fix: zusaetzlich erlauben, wenn der anfragende Nutzer der Box-Owner ist - analog zum
// bereits funktionierenden Pattern in der memberships-createRule (bare "box.owner").
migrate((app) => {
  const bookings = app.findCollectionByNameOrId("bookings");
  bookings.createRule = '@request.auth.id != "" && (@request.body.user = @request.auth.id || box.owner = @request.auth.id)';
  app.save(bookings);
}, (app) => {
  const bookings = app.findCollectionByNameOrId("bookings");
  bookings.createRule = '@request.auth.id != "" && @request.body.user = @request.auth.id';
  app.save(bookings);
});
