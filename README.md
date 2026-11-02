# Avlsværktøjet – lead-generator til VikingDanmark (konceptprototype)

Et interaktivt flow af beregnere og konfiguratorer. Det lærer kvægbrugeren om det, de overvejer at købe, og opsamler kvalificerede leads.

**Flow:** Besætningstjek (quiz, forudfylder alt) → Kvieplan → Genomisk test → Klima & foder via avl → Tørstoftjek (Foderteknik/NIR) → Din plan (samlet overblik og kontaktformular).

Ét klik på "Vis leadkort" i bunden af siden viser, hvad VikingDanmark modtager: leadscore, tags, næste skridt for rådgiveren og JSON til CRM.

## Kør den

Ingen build og ingen afhængigheder. Åbn `index.html` i en browser, eller start en lokal server:

```
python3 -m http.server 8000   # åbn http://localhost:8000
```

Svarene gemmes kun i browserens localStorage. "Start forfra" nulstiller demoen.

## Test af beregningerne

```
node --test tests/*.test.mjs
```

Formler, antagelser og kilder står i [docs/BEREGNINGER.md](docs/BEREGNINGER.md).

## Struktur

* `js/calc.js`: al beregningslogik (rene funktioner, testet)
* `js/charts.js`: små SVG-grafer med tooltips
* `js/app.js`: flow, state, UI og leadkort
* `css/styles.css`: design med lys og mørk tilstand og mobilvisning

## Før lancering

* Kalibrér priser, drægtighedsprocenter og testpris med VikingDanmarks egne tal.
* Formularen sender ikke data endnu. Kobl `submit` i `js/app.js` til CRM/marketing automation.
* Tilføj samtykketekst og privatlivspolitik fra VikingDanmark.

## Booking, planlink og opfølgning

* **Find og book din lokale rådgiver** (i "Din plan"): Postnummeret finder rådgiveren. Landmanden vælger besøg, video, telefon eller "ring mig op" og får en kalenderfil (.ics). Rådgiverne og de ledige tider er **eksempeldata** i `js/engage.js` og skal kobles til VikingDanmarks rådgiverliste og kalendere (fx Microsoft Bookings eller Outlook).
* **Gem min plan:** Beregningerne kodes ind i et link (`#plan=…`), så landmanden kan åbne dem igen. Kontaktoplysninger er aldrig en del af linket.
* **Opfølgning:** `buildNurture` laver et mailforløb ud fra landmandens resultater: kvieunderskud eller -overskud, genomisk test, NIR timet op til ensilering, klima og et genbesøg efter 3 måneder. Der går mindst 5 dage mellem mails. Planmailen sendes altid. Resten kræver et aktivt, ikke forhåndsafkrydset tilvalg.
* **Backend:** `api/lead.js` (serverless) sender planmailen og rådgiverbeskeden via Resend med .ics vedhæftet og videresender leadet og opfølgningsplanen til CRM. Den aktiveres med `<body data-api="/api/lead">` og miljøvariablerne beskrevet i filen. Uden `data-api` kører siden i demotilstand og sender intet.
