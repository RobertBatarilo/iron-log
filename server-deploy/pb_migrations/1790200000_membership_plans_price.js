/// <reference path="../pb_data/types.d.ts" />

// "Laufende Vertraege" (membership_plans.type=="recurring") werden weiterhin ausschliesslich
// vom Coach manuell zugeteilt (kein Stripe-Selbstkauf, siehe 1790100000_plan_orders_and_...).
// Damit die Box-Umsatz-Uebersicht trotzdem monatliche Einnahmen ausweisen kann, bekommt jeder
// einzelne membership_plans-Datensatz jetzt ein optionales priceCents-Feld - ein Snapshot des
// Preises zum Zuteilungszeitpunkt (analog zu offerSnapshot/templateSnapshot bei den Stripe-
// Bestellungen), damit spaetere Preisaenderungen an der Vorlage bestehende Vertraege nicht
// rueckwirkend veraendern. Rein additiv, keine Migration bestehender Datensaetze noetig -
// alle heutigen Vertraege bleiben einfach ohne Preis (in der Uebersicht explizit ausgewiesen,
// nicht stillschweigend als 0 gewertet).
migrate((app) => {
  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.fields.add(new NumberField({ name: "priceCents", required: false }));
  app.save(plans);
}, (app) => {
  const plans = app.findCollectionByNameOrId("membership_plans");
  plans.fields.removeByName("priceCents");
  app.save(plans);
});
