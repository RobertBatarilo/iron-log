/// <reference path="../pb_data/types.d.ts" />

// Manuelle Box-Ankuendigung durch den Owner an alle aktiven Mitglieder.
routerAdd("POST", "/box-announce", (e) => {
  const notify = require(`${__hooks}/notify_helper.js`);
  const user = e.auth;
  if (!user) return e.json(401, { ok: false, error: "unauthorized" });

  const data = new DynamicModel({ box: "", text: "" });
  e.bindBody(data);
  if (!data.box || !data.text || !data.text.trim()) {
    return e.json(400, { ok: false, error: "Text fehlt" });
  }

  const ownerMemberships = $app.findRecordsByFilter(
    "memberships",
    `box = {:box} && user = {:user} && role = "owner" && status = "active"`,
    "",
    1, 0,
    { box: data.box, user: user.id }
  );
  if (!ownerMemberships.length) return e.json(403, { ok: false, error: "Nur der Owner darf Ankuendigungen senden" });

  const box = $app.findRecordById("boxes", data.box);
  const members = $app.findRecordsByFilter(
    "memberships",
    `box = {:box} && status = "active"`,
    "",
    0, 0,
    { box: data.box }
  );
  const text = data.text.trim();
  for (const m of members) {
    notify.sendPushToUser(m.getString("user"), "announcement", `📣 ${box.getString("name")}`, text);
  }
  return e.json(200, { ok: true });
}, $apis.requireAuth("users"));
