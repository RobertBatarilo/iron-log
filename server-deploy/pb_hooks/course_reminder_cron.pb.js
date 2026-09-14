/// <reference path="../pb_data/types.d.ts" />

// Zwei zeitgesteuerte Kurs-Erinnerungen im selben 15-Minuten-Takt:
// - "Kurs beginnt bald" (60-75 Min. vorher, oesterreichische Ortszeit) an alle
//   aktiv Angemeldeten (reserved/attended).
// - "Kurs droht auszufallen" (110-125 Min. vorher, nur falls eine Mindestteilnehmerzahl
//   gesetzt ist und die aktiven Anmeldungen darunter liegen) an den Box-Owner und
//   die bereits angemeldeten Athleten.
cronAdd("courseReminder", "*/15 * * * *", () => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);

    function lastSundayOfMonthUtc(year, monthIndex){
      const lastDay = new Date(Date.UTC(year, monthIndex+1, 0)); // Tag 0 des Folgemonats = letzter Tag
      lastDay.setUTCDate(lastDay.getUTCDate() - lastDay.getUTCDay());
      lastDay.setUTCHours(1,0,0,0);
      return lastDay;
    }
    const nowUtc = new Date();
    const year = nowUtc.getUTCFullYear();
    const dstStart = lastSundayOfMonthUtc(year, 2);  // letzter Sonntag Maerz
    const dstEnd = lastSundayOfMonthUtc(year, 9);    // letzter Sonntag Oktober
    const offsetMin = (nowUtc >= dstStart && nowUtc < dstEnd) ? 120 : 60;
    const nowAt = new Date(nowUtc.getTime() + offsetMin*60000);
    const pad = n => String(n).padStart(2,'0');
    const dateStr = `${nowAt.getUTCFullYear()}-${pad(nowAt.getUTCMonth()+1)}-${pad(nowAt.getUTCDate())}`;
    const nowMinutes = nowAt.getUTCHours()*60 + nowAt.getUTCMinutes();

    const ownerCache = {};
    function boxOwnerUserId(boxId){
      if (ownerCache[boxId] !== undefined) return ownerCache[boxId];
      const owners = $app.findRecordsByFilter(
        "memberships", `box = {:box} && role = "owner" && status = "active"`, "", 1, 0, { box: boxId }
      );
      ownerCache[boxId] = owners.length ? owners[0].getString("user") : null;
      return ownerCache[boxId];
    }

    const instances = $app.findRecordsByFilter("class_instances", `date = {:date}`, "", 0, 0, { date: dateStr });
    for (const inst of instances) {
      const parts = (inst.getString("startTime")||"").split(":");
      if (parts.length < 2) continue;
      const startMinutes = (parseInt(parts[0],10)||0)*60 + (parseInt(parts[1],10)||0);
      const diff = startMinutes - nowMinutes;

      const isReminderWindow = diff >= 60 && diff < 75;
      const isAtRiskWindow = diff >= 110 && diff < 125;
      if (!isReminderWindow && !isAtRiskWindow) continue;

      const bookings = $app.findRecordsByFilter(
        "bookings",
        `classInstance = {:id} && (status = "reserved" || status = "attended")`,
        "", 0, 0, { id: inst.id }
      );
      const label = inst.getString("label") || "Kurs";

      if (isReminderWindow) {
        const body = `${label} beginnt um ${inst.getString("startTime")} Uhr.`;
        for (const b of bookings) {
          notify.sendPushToUser(b.getString("user"), "courseReminder", "Kurs bald! ⏰", body);
        }
      }

      if (isAtRiskWindow) {
        let minParticipants = null;
        try {
          const slot = $app.findRecordById("schedule_slots", inst.getString("scheduleSlot"));
          minParticipants = slot.get("minParticipants");
        } catch (e) { /* Slot geloescht o.ae. - keine Pruefung moeglich */ }
        if (minParticipants && bookings.length < minParticipants) {
          const body = `${label} um ${inst.getString("startTime")} Uhr hat erst ${bookings.length}/${minParticipants} Anmeldungen.`;
          const notified = {};
          const ownerId = boxOwnerUserId(inst.getString("box"));
          if (ownerId) {
            notify.sendPushToUser(ownerId, "courseAtRisk", "Kurs droht auszufallen ⚠️", body);
            notified[ownerId] = true;
          }
          for (const b of bookings) {
            const uid = b.getString("user");
            if (notified[uid]) continue;
            notified[uid] = true;
            notify.sendPushToUser(uid, "courseAtRisk", "Kurs droht auszufallen ⚠️", body);
          }
        }
      }
    }
  } catch (err) {
    console.log("course_reminder_cron Fehler", err);
  }
});
