JesusTime — Greek NT data
=========================
Deploy these JSON files so the app can fetch them at  /greek/<file>  (same origin as the app).

Files:
  manifest.json        list of books (the app also has this embedded; optional to serve)
  lexicon.json         lemma -> short gloss (fetched once for the tap-to-define popups)
  01-matthew.json ...  one file per NT book (fetched on demand when a book is opened)

Where to put them:
  In the jesustime-app Worker's Static Assets directory, under a /greek/ folder
  (e.g. <project>/public/greek/ or your assets dir), so they serve at https://<app>/greek/<file>.
  If you host them elsewhere, change GREEK_BASE near the top of the GreekReader code in App.jsx.

Sources: SBLGNT / MorphGNT (text + lemmas, CC BY-SA) and Strong's Greek dictionary (Open Scriptures, CC BY-SA).
