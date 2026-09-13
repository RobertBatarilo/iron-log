/// <reference path="../pb_data/types.d.ts" />

// Push-Benachrichtigungen fuer: neue Beitrittsanfrage (an den Box-Owner)
// und angenommene Beitrittsanfrage (an die beigetretene Person).
// require() bewusst INNERHALB jedes Handlers (nicht auf Modul-Ebene): mehrere
// .pb.js-Hooks werden von PocketBase in einem gemeinsamen Scope ausgefuehrt,
// ein Top-Level-const mit demselben Namen in zwei Dateien kollidiert sonst.
onRecordAfterCreateSuccess((e) => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);
    const membership = e.record;
    if (membership.getString("status") !== "pending") {
      e.next();
      return;
    }
    const boxId = membership.getString("box");
    const owners = $app.findRecordsByFilter(
      "memberships",
      `box = {:box} && role = "owner" && status = "active"`,
      "",
      0, 0,
      { box: boxId }
    );
    for (const owner of owners) {
      notify.sendPushToUser(owner.getString("user"), "joinRequest", "Neue Beitrittsanfrage", "Jemand moechte deiner Box beitreten.");
    }
  } catch (err) {
    console.log("membership_notifications (create) Hook-Fehler", err);
  }
  e.next();
}, "memberships");

onRecordAfterUpdateSuccess((e) => {
  try {
    const notify = require(`${__hooks}/notify_helper.js`);
    const membership = e.record;
    const before = membership.original();
    if (before.getString("status") === "pending" && membership.getString("status") === "active") {
      notify.sendPushToUser(membership.getString("user"), "joinApproved", "Willkommen! 🎉", "Deine Beitrittsanfrage wurde angenommen.");
    }
  } catch (err) {
    console.log("membership_notifications (update) Hook-Fehler", err);
  }
  e.next();
}, "memberships");
