# Job Radar – Berlin & Brandenburg

Eine mobile Karten-Webseite, die Stellenangebote aus mehreren Quellen zusammenführt, doppelte Anzeigen entfernt und **Ausbildungsangebote konsequent herausfiltert**.

## Enthaltene Quellen

Ohne API-Schlüssel:

- Bundesagentur für Arbeit (nur Angebotsart **Arbeit**, keine Ausbildung)
- Arbeitnow
- Tagesspiegel Jobs
- Berliner Morgenpost Jobs
- MAZ Job (Märkische Allgemeine)
- bluum Brandenburg (regionales Jobportal von Märkischer Oderzeitung / Lausitzer Rundschau)
- Berliner Zeitung Jobmarkt

Optional:

- Adzuna – wird automatisch zugeschaltet, wenn `ADZUNA_APP_ID` und `ADZUNA_APP_KEY` als GitHub Repository Secrets vorhanden sind.

## Was die Seite kann

- OpenStreetMap-/Leaflet-Karte mit Job-Markern und Clustering
- Standort des Handys verwenden
- Ort/PLZ suchen
- 5 / 10 / 25 / 50 / 100 / 200 km Umkreis
- Suchbegriff und Arbeitszeit-Filter
- Vollzeit, Teilzeit, Minijob, Homeoffice
- Quellen einzeln an-/abwählen
- Favoriten lokal auf dem Gerät speichern
- Treffer nach Entfernung oder Datum sortieren
- gleiche Stelle aus mehreren Quellen zu **einem** Treffer zusammenführen
- im Jobfenster trotzdem alle Fundquellen anzeigen
- tägliche Aktualisierung über GitHub Actions
- installierbar als Web-App (PWA)

## Keine Ausbildungsangebote

Der Import fragt die Arbeitsagentur mit `angebotsart=1` (Arbeit) ab. Zusätzlich werden Treffer mit Titeln/Typen wie `Ausbildung`, `Ausbildungsplatz`, `Azubi`, `Lehrstelle` oder `Duales Studium` vor dem Speichern entfernt. Hinweise wie „abgeschlossene Ausbildung erforderlich“ in normalen Stellenbeschreibungen führen **nicht** zum Ausschluss.

## Automatische Aktualisierung

`.github/workflows/update-jobs.yml` läuft:

- automatisch alle 24 Stunden
- beim ersten Einspielen/Ändern des Imports
- manuell über **Actions → Job Radar – täglich aktualisieren → Run workflow**

Die fertigen Daten landen in `public/data/jobs.json`. Geocoding-Ergebnisse werden in `data/geocode-cache.json` gespeichert, damit Orte nicht jeden Tag erneut abgefragt werden.

## GitHub Pages einschalten

1. Repository `Job-Radar` auf GitHub öffnen.
2. **Settings → Pages** öffnen.
3. Bei **Build and deployment → Source** `GitHub Actions` auswählen.
4. Danach unter **Actions** den Workflow `Job Radar – GitHub Pages` einmal starten, falls er nicht bereits automatisch gelaufen ist.
5. Die veröffentlichte Adresse wird im Pages-Workflow angezeigt.

## Cloudflare Pages (optional)

Das Projekt funktioniert auch direkt mit Cloudflare Pages:

- GitHub Repository: `plasma19911/Job-Radar`
- Framework preset: `None`
- Build command: leer
- Build output directory: `public`

Die Jobdaten werden weiterhin von GitHub Actions alle 24 Stunden aktualisiert. Cloudflare Pages veröffentlicht den neuen Commit anschließend automatisch.

## Adzuna optional aktivieren

Unter **Settings → Secrets and variables → Actions → New repository secret** anlegen:

- `ADZUNA_APP_ID`
- `ADZUNA_APP_KEY`

Ohne diese beiden Secrets läuft Job Radar trotzdem vollständig mit den kostenlosen Quellen weiter.

## Hinweise zu regionalen Stellenmärkten

Die regionalen Jobportale werden schonend mit wenigen Seitenabrufen geprüft. Der Import bevorzugt strukturierte `JobPosting`-Daten (JSON-LD). Wenn ein Anbieter sein HTML ändert oder zeitweise Zugriffe blockiert, fällt nur diese Quelle für den jeweiligen Lauf aus; die anderen Quellen laufen weiter. Im `meta.sources`-Abschnitt von `public/data/jobs.json` ist der Status jeder Quelle sichtbar.

## Datenschutz

- Favoriten bleiben im Browser (`localStorage`).
- GPS wird nur nach Klick auf den Standort-Button angefragt.
- Orts-/PLZ-Suche und fehlende Koordinaten verwenden OpenStreetMap/Nominatim.
- Es gibt keine Nutzerkonten und keine eigene Tracking-Datenbank.
