/// <reference path="../pb_data/types.d.ts" />

// Reaktivierungs-Erinnerung: laeuft 1x taeglich, prueft pro aktiver Mitgliedschaft
// die Tage seit dem letzten Kurs-Check-in (Basis: bookings mit status "attended",
// nicht die persoenlichen Workout-Eintraege - die sind serverseitig nicht
// abfragbar). Hat jemand noch nie eingecheckt, zaehlt das Beitrittsdatum.
// Benachrichtigt nur an festen Meilenstein-Tagen (14/30/60), nicht jeden Tag erneut.
cronAdd("reactivationReminder", "0 7 * * *", () => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);
    const MILESTONES = [14, 30, 60];
    const now = new Date();
    const todayMidnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    function daysSince(dateStr){
      if (!dateStr) return null;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      const dMidnight = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return Math.round((todayMidnightUtc - dMidnight) / 86400000);
    }

    const memberships = $app.findRecordsByFilter("memberships", `status = "active"`, "", 0, 0, {});
    for (const m of memberships) {
      const userId = m.getString("user");
      const attendedBookings = $app.findRecordsByFilter(
        "bookings",
        `user = {:u} && status = "attended"`,
        "", 0, 0, { u: userId }
      );
      let lastAttendedDate = null;
      for (const b of attendedBookings) {
        try {
          const inst = $app.findRecordById("class_instances", b.getString("classInstance"));
          const d = inst.getString("date");
          if (d && (!lastAttendedDate || d > lastAttendedDate)) lastAttendedDate = d;
        } catch (e) { /* Termin geloescht */ }
      }
      const referenceDate = lastAttendedDate || m.getString("created");
      const days = daysSince(referenceDate);
      if (days !== null && MILESTONES.indexOf(days) !== -1) {
        notify.sendPushToUser(userId, "reactivation", "Vermissen dich! 👋", `Du warst seit ${days} Tagen nicht mehr im Training. Zeit für ein Comeback!`);
      }
    }
  } catch (err) {
    console.log("reactivation_cron Fehler", err);
  }
});
