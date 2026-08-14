# Job Radar – 15 km + 100 % Homeoffice

Mobile Jobkarte für genau diesen Suchbereich:

- **lokale Stellen:** maximal **15 km** um **Marwitzer Str. 67, 13589 Berlin**
- **reine 100-%-Homeoffice-Stellen:** Entfernung egal, deutschlandweit
- **keine Ausbildungsangebote**
- **keine doppelten Stellenanzeigen**

## Quellen

Ohne API-Schlüssel:

- Bundesagentur für Arbeit
- Arbeitnow
- Tagesspiegel Jobs
- Berliner Morgenpost Jobs
- MAZ Job
- bluum Brandenburg
- Berliner Zeitung Jobmarkt

Optional kann Adzuna über `ADZUNA_APP_ID` und `ADZUNA_APP_KEY` ergänzt werden.

## Wichtige Filterregel

Präsenzstellen und Hybridstellen werden nur angezeigt, wenn der Arbeitsplatz höchstens 15 km von der festen Adresse entfernt ist.

Eine Stelle außerhalb dieses Radius bleibt nur dann erhalten, wenn sie als **reine 100-%-Remote-/Homeoffice-Stelle** erkannt wurde (`remoteFull=true`). Angaben wie „hybrid“, „teilweise Homeoffice“ oder einzelne Homeoffice-Tage reichen dafür nicht aus.

## Keine Ausbildung

Die Arbeitsagentur wird mit `angebotsart=1` abgefragt. Zusätzlich entfernt der Import Treffer mit Titeln/Typen wie `Ausbildung`, `Ausbildungsplatz`, `Azubi`, `Lehrstelle` oder `Duales Studium`. Eine normale Stelle wird nicht nur deshalb entfernt, weil im Beschreibungstext eine abgeschlossene Ausbildung verlangt wird.

## Automatische Aktualisierung

`.github/workflows/update-jobs.yml` läuft einmal täglich und führt nacheinander aus:

1. Hauptimport aus den Jobquellen
2. Nachimport Arbeitsagentur / Tagesspiegel
3. deutschlandweiten Import reiner Homeoffice-Stellen
4. endgültigen Scope-Filter: **15 km oder 100 % Homeoffice**
5. Dublettenbereinigung und Speichern in `public/data/jobs.json`

## Webseite

- OpenStreetMap + Leaflet
- Jobmarker für lokale Stellen
- reine Homeoffice-Stellen erscheinen in der Liste mit **„Entfernung egal“**
- Suchbegriff
- Vollzeit / Teilzeit / Minijob / 100 % Homeoffice
- Quellenfilter
- Favoriten
- Sortierung nach Entfernung, Datum oder Titel
- mobile PWA mit eigenem Icon

## GitHub Pages einschalten

GitHub blockiert die erstmalige Pages-Aktivierung für den Workflow-Token. Deshalb einmal im Repository:

1. **Settings → Pages**
2. bei **Build and deployment → Source** `GitHub Actions` auswählen
3. anschließend den Pages-Workflow starten bzw. den nächsten Push abwarten

Alternativ funktioniert das Repository direkt mit Cloudflare Pages:

- Repository: `plasma19911/Job-Radar`
- Framework preset: `None`
- Build command: leer
- Build output directory: `public`

## Datenschutz

- Favoriten bleiben lokal im Browser.
- Es gibt keine Nutzerkonten.
- Die feste Suchadresse wird nur als Suchzentrum für den 15-km-Radius verwendet.
