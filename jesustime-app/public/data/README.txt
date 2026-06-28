JesusTime — reading texts (lazy-loaded)
Deploy these so they serve at /data/<file> (same origin as the app), e.g. jesustime-app/public/data/.
  disciple.json   "The Disciple"      (334 paragraphs)
  pilgrim.json    Pilgrim's Progress  (990 paragraphs)
  witnesses.json  "The Witnesses"     (289 paragraphs)
  checkbook.json  Faith's Checkbook   (366 daily entries)
The app fetches each only when that book is opened, and caches it. If you host elsewhere,
change BOOK_DATA_URLS near the ReaderModule code in App.jsx.
