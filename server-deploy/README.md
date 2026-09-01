# Server-Deploy: Warteliste-Push-Benachrichtigung

Diese Dateien laufen NICHT im Client (GitHub Pages), sondern gehoeren auf den PocketBase-Server
(Hetzner, Docker). Sie sind hier nur als Vorlage abgelegt und muessen per SSH auf den Server
kopiert werden. Siehe Plan-Datei fuer die vollstaendige Umsetzungsreihenfolge.

## Inhalt

- `push-service/` — kleiner Node-Dienst (nur intern im Docker-Netzwerk erreichbar), der die
  eigentliche Web-Push-Zustellung uebernimmt (Bibliothek `web-push`).
- `pb_hooks/waitlist_promotion.pb.js` — PocketBase-Hook, der bei Stornierung einer reservierten
  Buchung automatisch den aeltesten Wartelisten-Eintrag befoerdert und den Push-Dienst aufruft.
- `pb_hooks/config.local.example.js` — Vorlage. Auf dem Server nach `config.local.js` kopieren
  und mit echten Werten fuellen. **`config.local.js` selbst niemals committen.**

## Noch offen (auf dem Server, nach SSH-Zugriff)

1. Reale `docker-compose.yml` inspizieren, PocketBase-Version pruefen (`pocketbase --version`).
2. Backup von `pb_data` erstellen.
3. Collection `push_subscriptions` im Admin-UI anlegen.
4. `bookings.update`-Regel eintragen: `user = @request.auth.id || box.owner = @request.auth.id`
5. VAPID-Schluesselpaar generieren: `npx web-push generate-vapid-keys`
6. `push-service` als weiteren Container in die `docker-compose.yml` aufnehmen (ohne `ports:`,
   nur intern erreichbar), `.env` mit `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/
   `INTERNAL_SECRET` befuellen.
7. `pb_hooks/waitlist_promotion.pb.js` + `pb_hooks/config.local.js` einspielen, Hook-Syntax
   gegen die tatsaechliche PocketBase-Version verifizieren (siehe Warnhinweis im Hook-Kommentar).
8. End-to-End-Test mit zwei echten Testkonten.

Der VAPID Public Key muss danach auch in `index.html` als Client-Konstante eingetragen werden
(Client-Teil des Features, separat).
