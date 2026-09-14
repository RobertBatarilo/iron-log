/// <reference path="../pb_data/types.d.ts" />

// Ermoeglicht der Mitglieder-Administration (index.html, isAppAdmin-Nutzer):
// 1. Ein Konto per neuem "disabled"-Feld auf "users" zu sperren (Boot-Check im Client).
// 2. Ein Konto inkl. zugehoeriger Daten unwiderruflich zu loeschen (DSGVO-Loeschung).
// Ohne diese Migration schlaegt das Loeschen fehl, da PocketBase Delete-Requests
// standardmaessig nur Superusern erlaubt (deleteRule = null).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({
    name: "disabled",
    required: false,
  }));
  users.deleteRule = "@request.auth.isAppAdmin = true";
  app.save(users);

  const ownedCollections = [
    "memberships",
    "bookings",
    "social_posts",
    "social_comments",
    "social_reactions",
    "social_poll_votes",
    "push_subscriptions",
  ];
  for (const name of ownedCollections) {
    const collection = app.findCollectionByNameOrId(name);
    collection.deleteRule = "@request.auth.isAppAdmin = true";
    app.save(collection);
  }
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("disabled");
  users.deleteRule = null;
  app.save(users);

  const ownedCollections = [
    "memberships",
    "bookings",
    "social_posts",
    "social_comments",
    "social_reactions",
    "social_poll_votes",
    "push_subscriptions",
  ];
  for (const name of ownedCollections) {
    const collection = app.findCollectionByNameOrId(name);
    collection.deleteRule = null;
    app.save(collection);
  }
});
