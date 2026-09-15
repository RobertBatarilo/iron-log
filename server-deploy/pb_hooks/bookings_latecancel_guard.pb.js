/// <reference path="../pb_data/types.d.ts" />

// Verhindert, dass ein Athlet selbst "lateCancel" auf einer eigenen Buchung setzt/loescht.
// Die API-Regel der bookings-Collection erlaubt Updates am eigenen Datensatz (fuer legitime
// Selbst-Stornierung) oder durch den Box-Owner - diese Feld-Ebene laesst sich mit reinen
// API-Regeln nicht abbilden, daher hier zusaetzlich per Hook abgesichert.
onRecordUpdateRequest((e) => {
  const before = e.record.original();
  if (e.record.getBool("lateCancel") !== before.getBool("lateCancel")) {
    const actor = e.auth;
    const isActorSuperuser = !!(actor && actor.isSuperuser());
    let isBoxOwner = false;
    if (!isActorSuperuser && actor) {
      const box = $app.findRecordById("boxes", e.record.getString("box"));
      isBoxOwner = !!(box && box.getString("owner") === actor.id);
    }
    if (!isActorSuperuser && !isBoxOwner) {
      throw new ForbiddenError("Nur der Box-Owner darf lateCancel aendern");
    }
  }
  e.next();
}, "bookings");
