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
node --test tests/calc.test.mjs
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
