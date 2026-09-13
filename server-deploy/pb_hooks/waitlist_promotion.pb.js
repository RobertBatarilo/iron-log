/// <reference path="../pb_data/types.d.ts" />

// WICHTIG: config.local.js wird NICHT mitgeliefert (enthaelt Secrets) -
// muss direkt auf dem Server angelegt werden, siehe config.local.example.js
// require() bewusst INNERHALB des Handlers (nicht auf Modul-Ebene): mehrere
// .pb.js-Hooks werden von PocketBase in einem gemeinsamen Scope ausgefuehrt,
// ein Top-Level-const mit demselben Namen in zwei Dateien kollidiert sonst.
onRecordAfterUpdateSuccess((e) => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);
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
    const kursName = instance.getString("label") || "deinem Kurs";
    const notifBody = `Dein Platz in ${kursName} ist bestaetigt.`;
    notify.sendPushToUser(userId, "waitlistPromoted", "Du bist nachgerueckt!", notifBody);
    // bewusst kein throw bei Push-Fehlern: darf die DB-Promotion nicht rueckgaengig machen
  } catch (err) {
    console.log("waitlist_promotion Hook-Fehler", err);
  }

  e.next();
}, "bookings");
