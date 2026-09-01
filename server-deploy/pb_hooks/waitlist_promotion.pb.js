/// <reference path="../pb_data/types.d.ts" />

// WICHTIG: config.local.js wird NICHT mitgeliefert (enthaelt Secrets) -
// muss direkt auf dem Server angelegt werden, siehe config.local.example.js
const cfg = require(`${__hooks}/config.local.js`);

onRecordAfterUpdateSuccess((e) => {
  try {
    const booking = e.record;
    if (booking.getString("status") !== "cancelled") {
      e.next();
      return;
    }

    const instanceId = booking.getString("classInstance");
    if (!instanceId) { e.next(); return; }

    const instance = $app.findRecordById("class_instances", instanceId);
    const capacity = instance.getInt("capacity");

    // Aktive Buchungen (reserved + attended) fuer diesen Termin zaehlen
    const activeBookings = $app.findRecordsByFilter(
      "bookings",
      `classInstance = {:id} && (status = "reserved" || status = "attended")`,
      "",
      0, 0,
      { id: instanceId }
    );
    const spotsLeft = capacity - activeBookings.length;
    if (spotsLeft <= 0) { e.next(); return; }

    // Aeltesten Wartelisten-Eintrag holen (FIFO)
    const waitlisted = $app.findRecordsByFilter(
      "bookings",
      `classInstance = {:id} && status = "waitlist"`,
      "created",
      1, 0,
      { id: instanceId }
    );
    if (!waitlisted.length) { e.next(); return; }

    const promoted = waitlisted[0];
    promoted.set("status", "reserved");
    $app.save(promoted);

    // Push an den nachgerueckten Nutzer
    const userId = promoted.getString("user");
    const subs = $app.findRecordsByFilter(
      "push_subscriptions",
      `user = {:uid}`,
      "",
      0, 0,
      { uid: userId }
    );

    const kursName = instance.getString("label") || "deinem Kurs";
    const notifBody = `Dein Platz in ${kursName} ist bestaetigt.`;

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
              keys: {
                p256dh: sub.getString("p256dh"),
                auth: sub.getString("auth")
              }
            },
            title: "Du bist nachgerueckt!",
            body: notifBody,
            url: "./index.html"
          })
        });
      } catch (pushErr) {
        console.log("Push-Versand fehlgeschlagen fuer Subscription " + sub.id, pushErr);
        // bewusst kein throw: ein fehlgeschlagener Push darf die DB-Promotion nicht rueckgaengig machen
      }
    }
  } catch (err) {
    console.log("waitlist_promotion Hook-Fehler", err);
  }

  e.next();
}, "bookings");
