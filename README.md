# Job Radar – 15 km + 100 % Homeoffice

Mobile Jobkarte für genau diesen Suchbereich:

- **lokale Stellen:** maximal **15 km** um **Marwitzer Str. 67, 13589 Berlin**
- **reine 100-%-Homeoffice-Stellen:** Entfernung egal, deutschlandweit
- **keine Ausbildungsangebote**
- **keine doppelten Stellenanzeigen**
- **Senior-Stellen und unpassende körperlich schwere Tätigkeiten werden gefiltert**

## Quellen

Der Radar kombiniert große Jobportale, öffentliche Quellen und direkte Arbeitgeberseiten. Dazu gehören unter anderem:

- Bundesagentur für Arbeit + erweiterte Umkreis-Orte
- Arbeitnow
- Kimeta
- HeyJobs
- JobMESH
- StepStone
- XING Jobs
- LinkedIn Jobs
- stellenanzeigen.de
- Talent.com
- Tagesspiegel Jobs
- Berliner Morgenpost Jobs
- MAZ Job
- bluum Brandenburg
- Berliner Zeitung Jobmarkt
- Land Berlin Karriereportal
- zahlreiche direkte Arbeitgeberquellen aus Spandau, Tegel, Reinickendorf, Falkensee und Hennigsdorf

Weitere API-Portale wie Adzuna, Jooble und Careerjet werden genutzt, wenn die entsprechenden Repository-Secrets hinterlegt sind.

## Wichtige Filterregel

Präsenzstellen und Hybridstellen werden nur angezeigt, wenn der Arbeitsplatz höchstens 15 km von der festen Adresse entfernt ist.

Eine Stelle außerhalb dieses Radius bleibt nur dann erhalten, wenn sie als **reine 100-%-Remote-/Homeoffice-Stelle** erkannt wurde (`remoteFull=true`). Angaben wie „hybrid“, „teilweise Homeoffice“ oder einzelne Homeoffice-Tage reichen dafür nicht aus.

## Keine Ausbildung

Die Arbeitsagentur wird mit `angebotsart=1` abgefragt. Zusätzlich entfernt der Import Treffer mit Titeln/Typen wie `Ausbildung`, `Ausbildungsplatz`, `Azubi`, `Lehrstelle`, `Duales Studium`, `Werkstudent` oder `Praktikum`. Eine normale Stelle wird nicht nur deshalb entfernt, weil im Beschreibungstext eine abgeschlossene Ausbildung verlangt wird.

## Automatische Aktualisierung

`.github/workflows/update-jobs-workflow.yml` läuft täglich mit einem Ersatzlauf und kann bei einem verpassten Scan vom Watchdog nachgestartet werden. Der Workflow verwendet Node.js 24 und führt nacheinander aus:

1. Hauptimport aus den Jobquellen
2. erweiterte Arbeitsagentur-Suche über mehrere Suchmittelpunkte im 15-km-Gebiet
3. direkte lokale Arbeitgeber und große Jobportale
4. zusätzliche Portale Kimeta, HeyJobs und JobMESH
5. deutschlandweiten Import reiner Homeoffice-Stellen
6. Ausschluss-, Büro/PC- und Dublettenfilter
7. endgültigen Scope-Filter: **15 km oder 100 % Homeoffice**
8. Aktualisierung der PWA und der Oberfläche

## Webseite

- OpenStreetMap + Leaflet
- Jobmarker für lokale Stellen
- reine Homeoffice-Stellen erscheinen in der Liste mit **„Entfernung egal“**
- lokale Treffer stehen im Neue-Jobs-Fenster zuerst
- nicht-lokales 100-%-Homeoffice ist dort standardmäßig eingeklappt
- Suchbegriff
- Vollzeit / Teilzeit / Minijob / 100 % Homeoffice
- Quellenfilter
- Favoriten
- Sortierung nach Entfernung, Datum oder Titel
- mobile PWA mit eigenem Icon
- modernisierte Desktop- und Handy-Darstellung

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
