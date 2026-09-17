/// <reference path="../pb_data/types.d.ts" />

// isProStandalone wurde urspruenglich wortwoertlich als "Pro OHNE Box" gebaut.
// Mit der neuen Unterscheidung "Pro (ohne Box)" / "Pro (mit Box)" (rein abgeleitet aus
// isPro + aktiver Box-Mitgliedschaft, index.html: userTierLabel()) ist der alte Name
// irrefuehrend geworden - daher Umbenennung zu einem allgemeinen isPro. Reine
// Feld-Umbenennung, Bestandswerte bleiben erhalten.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const field = users.fields.getByName("isProStandalone");
  field.setName("isPro");
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const field = users.fields.getByName("isPro");
  field.setName("isProStandalone");
  app.save(users);
});
