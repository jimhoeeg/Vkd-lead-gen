# Beregninger og antagelser

Alle formler ligger i `js/calc.js` (rene funktioner) og er dækket af tests i `tests/calc.test.mjs` (`node --test tests/*.test.mjs`).
Standardværdierne er **eksempler** og skal kalibreres med VikingDanmarks egne tal og prislister før lancering. Alle kan ændres af brugeren i beregnerne.

## 1. Kvieplan (`heiferBalance`, `recommendStrategy`)

| Størrelse | Formel |
|---|---|
| Kælvninger/år | årskøer × 12 ÷ kælvningsinterval |
| Behov for kvier | årskøer × udskiftningsprocent (= førstekælvninger) |
| Kviekalve | Σ (kælvninger i gruppe × andel sædtype × andel hunkøn) for kvier og køer |
| Kvier til kælvning | kviekalve × (1 − kalvetab) × (1 − opdrætstab) |
| Inseminationer | drægtigheder ÷ drægtighed pr. insemination (pr. sædtype og gruppe) |
| Netto kalveøkonomi | krydsningskalve × pris + tyrekalve × pris + kvieoverskud/-underskud − (strå + inseminering) |

* Overskud af kvier værdisættes som `salgspris − opdrætsomkostning`. Underskud værdisættes som `−(købspris − opdrætsomkostning)`.
* Opdræt af de kvier, der **skal** bruges, er ens i alle strategier og indgår ikke.
* **Anbefalet strategi:** Kønssorteret sæd på kvierne først (højest drægtighed og typisk bedste genetik). Mangler der stadig kvier, bruges kønssorteret sæd på den nødvendige andel af køerne. Resten insemineres med kødkvæg. Målet er behov × (1 + sikkerhedsmargin). Hvis behovet ikke kan dækkes selv med 100 % kønssorteret sæd, markeres det.

Standardværdier: 250 køer, 38 % udskiftning, 13 mdr. kælvningsinterval. 90 % / 47 % hunkalve (kønssorteret / konventionel). 8 % kalvetab og 6 % opdrætstab. Drægtighed for kvier 55 % / 65 % og for køer 40 % / 45 % (kønssorteret / konventionel og kødkvæg). Strå 450 / 200 / 150 kr. og inseminering 175 kr. Krydsningskalv 2.400 kr., tyrekalv 600 kr. Opdræt 15.500 kr., salg af kvie 15.000 kr., køb af kvie 17.000 kr.

Resultat med standardværdierne: −7,6 kvier/år i dag. Den anbefalede strategi giver +5 kvier og **+35.000 kr./år** (håndregnet og testet).

## 2. Genomisk test (`genomicValue`, `genomicScenario`, `genomicOptimum`)

Merværdien er værdien af at vælge med genomisk indeks (sikkerhed r_G) i stedet for afstamningsindeks (r_PA). Formlen er standard trunkeringsselektion:

```
gevinst pr. opdrættet kvie = i(andel beholdt) × (r_G − r_PA) × σ
gevinst pr. datter         = ½ × i(andel med kønssorteret) × (r_G − r_PA) × σ
værdi                      = NTM-gevinst × kr. pr. NTM pr. årsko × 2,8 årsko-år
testudgift                 = alle kviekalve × testpris
```

`i(p)` er selektionsintensiteten. Den beregnes med invers normalfordeling (Acklam), og testen kontrollerer den mod tabelværdier.

* Værdi pr. NTM-enhed pr. årsko: **Holstein 9,9 €, RDM 9,2 €, Jersey 8,0 €** (Nordic EBV 2020). Ved 7,46 kr./€ svarer det til 74 / 69 / 60 kr.
* r_PA = 0,55 (inkl. stamtavlefejl) og r_G = 0,80. σ = 10 NTM. Testpris 200 kr. (KvægNyt 2017 angav ca. 180 kr.).
* **Selektionsrum:** Man laver X % flere kviekalve end behovet, tester dem alle, opdrætter de bedste og sælger resten som kviekalve (1.200 kr.). Optimeringen gennemløber 0-50 %.
* Ikke regnet med: afstamningskontrol, bærerstatus for arvelige defekter, beta-kasein, hornstatus og indavlskontrol. Der er en valgfri faktor på 1,5 for varig fremgang i senere generationer.

Resultat med standardværdierne: Avlsfremgangen dækker ca. 97 % af testprisen, og nulpunktet ligger ved ca. 195 kr./test. Det betyder, at testen betaler sig ved lav udskiftning og kort kælvningsinterval. Ekstra selektionsrum betaler sig ikke, så længe en krydsningskalv er mere værd end en kviekalv. Det stemmer med fagkilderne: Testen har kun værdi sammen med kønssorteret sæd og kødkvæg.

### 2b. "Hvem skal have kønssorteret?" (`selectionAccuracy`)

20 kviekalve simuleres med en sand avlsværdi (σ = 10 NTM) og to skøn med korrelation r_PA = 0,55 (afstamning) og r_G = 0,80 (genomisk) til den sande værdi: `skøn = r·sand + √(1−r²)·σ·støj`. De k bedste ifølge hvert skøn får kønssorteret sæd, og resten får kødkvæg. k er andelen fra kvieplanen. Beregneren tæller, hvor mange af de k sande bedste der vælges. Tallene er et gennemsnit over 2.000 simulerede hold. Det viste hold er det, der ligger tættest på gennemsnittet. Ved en andel på 50 % vælger man ca. 6,8 af 10 rigtige uden test og 7,9 af 10 med test.

### 2c. Arla klimapoint (`arlaClimateValue`)

Værdi pr. år = årskøer × leveret mælk pr. ko (kg) × tillæg (øre/kg) ÷ 100. Satsen indtastes af brugeren, fordi den ikke er kendt endnu. Ved 0 regnes der ikke med den. Beregneren viser også, hvor højt tillægget mindst skal være, før testen tjener sig hjem: `(testudgift − avlsværdi) ÷ (køer × kg mælk) × 100`. Standardværdier for mælk pr. ko efter race: Holstein 11.000, RDM 10.000, Jersey 8.000 og krydsning 10.000 kg (eksempler).

## 3. Klima og foder via avl (`climateProjection`)

* Afgift (Grøn Trepart): 300 kr./t CO₂e i 2030, lineært stigende til 750 kr./t i 2035 og derefter fast. Bundfradraget på 60 % giver effektivt 120 og 300 kr./t.
* Udledning i afgiftsgrundlaget: 5,6 t CO₂e/ko/år (eksempel). Det giver 672 kr./ko i 2030 og 1.680 kr./ko i 2035.
* Avlseffekt: ekstra årlig reduktion (metan 0,75 %/år og fodereffektivitet 0,25 %/år). Effekten starter 3 år efter, at avlsfokus begynder, når de første døtre kælver, og den akkumuleres lineært. Metanreduktionen virker kun på andelen fra vommen (70 %).
* Foder: 7.000 kg TS/ko/år × 2,0 kr./kg TS.
* **Forbehold:** Det er uafklaret, om avlsfremgang kan dokumenteres i afgiftsopgørelsen. Beregneren viser potentialet. Foderbesparelsen er uafhængig af det.

## 4. Tørstoftjek (`dryMatterCost`)

```
SD for fejl i TS (kg/ko/dag) = TS fra ensilage × (spredning i tørstof%-point ÷ tørstof%) × restfejl(metode)
gennemsnitlig afvigelse      = SD × √(2/π)
underfodring (halvdelen af tiden) = afvigelse × (1 − koens udligning) × (mælkerespons × mælkepris − foderpris)
overfodring (halvdelen af tiden)  = afvigelse × foderpris × spildandel
```

Restfejl pr. metode: måler ikke 100 %, månedligt 90 %, ugentligt 60 %, 2-3 gange om ugen 45 %, NIR ved hver blanding 15 %.
Standardværdier: 22 kg TS, 60 % fra ensilage, 33 % TS, spredning 2,5 %-point, 1,4 kg EKM/kg TS, 3,60 kr./kg EKM, 2,0 kr./kg TS, 50 % udligning og 50 % spild.
Beregneren viser den maksimale investering ved 3 og 5 års tilbagebetaling. Den viser ingen produktpris.

## 5. Leadscore (`leadScore`)

0-100 point: størrelse (maks. 30 efter antal årskøer), behov (maks. 40: kvieubalance, genomisk test i plus, tørstofgevinst, ikke genomtestet) og engagement (maks. 30: gennemgåede beregnere og sendt formular). Varm ≥ 70, Lun ≥ 45, ellers Kold.

## Kilder

* Nordic EBV, *The economic value of NTM* (2020): https://www.nordicebv.info/wp-content/uploads/2020/11/The-economic-value-of-NTM_final.pdf
* VikingGenetics, Nordic Methane Index og Saved Feed: https://www.vikinggenetics.com/news/nordic-methane-index, https://www.vikinggenetics.com/news/saved-feed-adds-more-value-to-ntm
* KvægNyt 09/2017, genomisk test, kønssorteret sæd og kødkvæg: https://www.landbrugsinfo.dk/-/media/landbrugsinfo/public/0/b/3/kvaegnyt-09-2017.pdf
* Aarhus Universitet, Kvægkongres 2023 (krydsning og genomisk test): https://qgg.au.dk/fileadmin/site_files/mb/QGG/DairyCross/Kvaegkongres270223_Krydsning2_FINAL.pdf
* Grøn Trepart, CO₂e-afgift på husdyr: https://www.sn.dk/art5624774/koebenhavn/politik/enig-om-co2-afgift-paa-landbrug-saa-meget-skal-landmaendene-betale/
* Landbrugsavisen, VikingDanmark køber Foderteknik (okt. 2026): https://landbrugsavisen.dk/vikingdanmark-koeber-virksomheden-foderteknik-efter-markant-vaekst-333379
* Landbrugsavisen, FoderTeknik NIR og vejeceller: https://landbrugsavisen.dk/kvaeg/data-flyder-frit-og-automatisk-mellem-mark-og-lager-145450
