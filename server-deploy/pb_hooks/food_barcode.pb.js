/// <reference path="../pb_data/types.d.ts" />

// Barcode-Abfrage fuer das Ernaehrungstagebuch: Client -> PocketBase (Login noetig, kein Pro) ->
// Open Food Facts. Der Umweg ueber den eigenen Server hat drei Gruende: (1) ein eigener
// User-Agent (Browser duerfen den nicht setzen, Open Food Facts erwartet ihn), (2) Antworten
// werden in "barcode_cache" zwischengespeichert, (3) die IP-Adresse der Nutzer geht nicht an
// Dritte. Daten: Open Food Facts (ODbL) - Quellenangabe steht in der App.
//
// require()/Helfer bewusst INNERHALB des Handlers (pb_hooks-Dateien teilen sich einen globalen
// Scope - Top-Level-Konstanten wuerden mit anderen Hooks kollidieren bzw. in anderen
// JSVM-Instanzen aus dem Pool fehlen).
routerAdd("GET", "/food/barcode/{ean}", (e) => {
  if (!e.auth) return e.json(401, { ok: false, error: "unauthorized" });

  const ean = String(e.request.pathValue("ean") || "").trim();
  if (!/^\d{8,14}$/.test(ean)) {
    return e.json(400, { ok: false, error: "Ungueltiger Barcode" });
  }

  const FOUND_TTL_MS = 90 * 24 * 3600 * 1000;
  const NOT_FOUND_TTL_MS = 24 * 3600 * 1000;
  const now = Date.now();

  let cached = null;
  try {
    cached = $app.findFirstRecordByFilter("barcode_cache", "ean = {:ean}", { ean: ean });
  } catch (_) {
    cached = null;
  }
  if (cached) {
    const age = now - (cached.getFloat("fetchedAt") || 0);
    const found = cached.getBool("found");
    if (age < (found ? FOUND_TTL_MS : NOT_FOUND_TTL_MS)) {
      if (!found) return e.json(404, { ok: false, error: "Produkt nicht gefunden" });
      let payload = null;
      try { payload = JSON.parse(cached.getString("payload")); } catch (_) { payload = null; }
      if (payload) return e.json(200, Object.assign({ ok: true }, payload));
    }
  }

  const num = (v) => {
    const n = typeof v === "number" ? v : parseFloat(String(v === undefined || v === null ? "" : v).replace(",", "."));
    return isNaN(n) ? null : n;
  };
  const round1 = (v) => (v === null ? null : Math.round(v * 10) / 10);

  let product = null;
  try {
    const res = $http.send({
      url: "https://world.openfoodfacts.org/api/v2/product/" + ean + ".json" +
        "?fields=code,product_name,product_name_de,generic_name_de,brands,nutriments,serving_size,serving_quantity,quantity,nutriscore_grade",
      method: "GET",
      headers: { "User-Agent": "ThrusterCrew/1.0 (https://thrustercrew.app)" },
      timeout: 10
    });
    if (res.statusCode === 200) {
      const body = JSON.parse(res.raw || "{}");
      if (body && body.status === 1 && body.product) product = body.product;
    } else if (res.statusCode !== 404) {
      console.log("food-barcode: Open Food Facts Status", res.statusCode);
      return e.json(502, { ok: false, error: "Produktdatenbank nicht erreichbar" });
    }
  } catch (err) {
    console.log("food-barcode Hook-Fehler", err);
    return e.json(502, { ok: false, error: "Produktdatenbank nicht erreichbar" });
  }

  const saveCache = (found, payload) => {
    try {
      const rec = cached || new Record($app.findCollectionByNameOrId("barcode_cache"));
      rec.set("ean", ean);
      rec.set("found", found);
      rec.set("payload", payload ? JSON.stringify(payload) : "");
      rec.set("fetchedAt", now);
      $app.save(rec);
    } catch (err) {
      console.log("food-barcode Cache-Fehler", err);
    }
  };

  if (!product) {
    saveCache(false, null);
    return e.json(404, { ok: false, error: "Produkt nicht gefunden" });
  }

  const n = product.nutriments || {};
  let kcal = num(n["energy-kcal_100g"]);
  if (kcal === null) {
    const kj = num(n["energy_100g"]);
    if (kj !== null) kcal = kj / 4.184;
  }
  const name = (product.product_name_de || product.product_name || product.generic_name_de || "").trim();
  const payload = {
    ean: ean,
    name: name || "Unbenanntes Produkt",
    brand: String(product.brands || "").split(",")[0].trim(),
    per100: {
      kcal: round1(kcal),
      protein: round1(num(n["proteins_100g"])),
      carbs: round1(num(n["carbohydrates_100g"])),
      fat: round1(num(n["fat_100g"])),
      fiber: round1(num(n["fiber_100g"])),
      sugar: round1(num(n["sugars_100g"])),
      salt: round1(num(n["salt_100g"]))
    },
    servingSize: num(product.serving_quantity),
    servingLabel: String(product.serving_size || "").trim(),
    quantityLabel: String(product.quantity || "").trim(),
    nutriScore: String(product.nutriscore_grade || "").toLowerCase()
  };
  saveCache(true, payload);
  return e.json(200, Object.assign({ ok: true }, payload));
}, $apis.requireAuth("users"));
