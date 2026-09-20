/// <reference path="../pb_data/types.d.ts" />

// Ankuendigungen (bisher nur eine reine Push-Notification ohne Speicherung,
// siehe box_announce.pb.js) werden ab jetzt als normaler social_posts-Eintrag
// gespeichert (dauerhaft im Feed sichtbar, auch fuer wer Push deaktiviert hat
// oder die Benachrichtigung verpasst), zusaetzlich weiterhin per Push versendet.
migrate((app) => {
  const posts = app.findCollectionByNameOrId("social_posts");
  posts.fields.add(new SelectField({ name: "postType", required: false, maxSelect: 1, values: ["normal", "announcement"] }));
  app.save(posts);
}, (app) => {
  const posts = app.findCollectionByNameOrId("social_posts");
  posts.fields.removeByName("postType");
  app.save(posts);
});
