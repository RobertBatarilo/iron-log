/// <reference path="../pb_data/types.d.ts" />

// Persoenliche-Daten-Screen: Nachname sowie optionale Kontaktdaten.
// WICHTIG: Alle Felder hier required:false, AUCH lastName, obwohl das UI
// Nachname als Pflichtfeld behandelt. Grund: Bestehende User-Datensaetze
// haben keinen Wert dafuer. Waere lastName auf Schema-Ebene required:true,
// wuerde PocketBase JEDES kuenftige Update eines bestehenden Datensatzes
// ablehnen (z.B. Admin-Flag-Aenderungen, Avatar-Uploads), nicht nur neue
// Registrierungen - eine Regression fuer alle Bestandsnutzer. Die Pflicht
// wird daher ausschliesslich client-seitig in savePersonalInfo() geprueft.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "lastName", required: false }));
  users.fields.add(new TextField({ name: "phone", required: false }));
  users.fields.add(new TextField({ name: "address", required: false }));
  users.fields.add(new TextField({ name: "postalCode", required: false }));
  users.fields.add(new TextField({ name: "city", required: false }));
  users.fields.add(new TextField({ name: "country", required: false }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("lastName");
  users.fields.removeByName("phone");
  users.fields.removeByName("address");
  users.fields.removeByName("postalCode");
  users.fields.removeByName("city");
  users.fields.removeByName("country");
  app.save(users);
});
