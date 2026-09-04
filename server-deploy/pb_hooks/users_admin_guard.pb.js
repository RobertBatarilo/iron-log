/// <reference path="../pb_data/types.d.ts" />

// Verhindert, dass sich ein normaler Nutzer selbst isAppAdmin/isProStandalone setzt.
// Die API-Regel der users-Collection erlaubt Updates am eigenen Datensatz (fuer Name, Avatar, etc.)
// oder an beliebigen Datensaetzen fuer Admins - diese Feld-Ebene laesst sich mit reinen
// API-Regeln nicht abbilden, daher hier zusaetzlich per Hook abgesichert.
onRecordUpdateRequest((e) => {
  const actor = e.auth;
  const isActorAdmin = !!(actor && (actor.isSuperuser() || actor.getBool("isAppAdmin")));
  if (!isActorAdmin) {
    const before = e.record.original();
    if (
      e.record.getBool("isAppAdmin") !== before.getBool("isAppAdmin") ||
      e.record.getBool("isProStandalone") !== before.getBool("isProStandalone")
    ) {
      throw new ForbiddenError("Nur Admins duerfen isAppAdmin/isProStandalone aendern");
    }
  }
  e.next();
}, "users");
