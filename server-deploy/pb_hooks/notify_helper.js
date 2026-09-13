/// <reference path="../pb_data/types.d.ts" />

// Gemeinsame Hilfsfunktion zum Versenden von Push-Benachrichtigungen unter
// Beruecksichtigung der Nutzer-Einstellungen (users.notificationPrefs).
// Wird per require() aus den einzelnen .pb.js-Hooks geladen (Muster wie config.local.js).
module.exports = {
  sendPushToUser(userId, category, title, body) {
    const cfg = require(`${__hooks}/config.local.js`);
    let user;
    try {
      user = $app.findRecordById("users", userId);
    } catch (e) {
      return; // Nutzer existiert nicht (mehr)
    }
    const prefs = user.get("notificationPrefs") || {};
    if (prefs[category] === false) return; // Nutzer hat diese Kategorie deaktiviert

    const subs = $app.findRecordsByFilter(
      "push_subscriptions",
      `user = {:uid}`,
      "",
      0, 0,
      { uid: userId }
    );
    for (const sub of subs) {
      try {
        $http.send({
          url: cfg.pushServiceUrl,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": cfg.pushInternalSecret
          },
          body: JSON.stringify({
            subscription: {
              endpoint: sub.getString("endpoint"),
              keys: { p256dh: sub.getString("p256dh"), auth: sub.getString("auth") }
            },
            title, body, url: "./index.html"
          })
        });
      } catch (pushErr) {
        console.log("Push-Versand fehlgeschlagen fuer Subscription " + sub.id, pushErr);
      }
    }
  }
};
