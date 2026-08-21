/* On-screen keyboards. Kept verbatim from the original single-file version. */
export const IAST_KEYS = [
["ā","a-macron"],["ī","i-macron"],["ū","u-macron"],["ṛ","vocalic r"],["ṝ","long vocalic r"],
["ḷ","vocalic l"],["ḹ","long vocalic l"],["ṃ","anusvāra"],["ḥ","visarga"],["ṅ","velar n"],
["ñ","palatal n"],["ṭ","retro t"],["ḍ","retro d"],["ṇ","retro n"],["ś","palatal s"],["ṣ","retro s"],
[" ","space"]
];

/* On-screen Devanagari keyboard: independent vowels, then consonants (inherent 'a'),
   then vowel-signs/virama/anusvara/visarga to modify the consonant just typed, then space.
   Tapping keys in sequence composes normal Devanagari text/conjuncts, same idea as the IAST bar.
   Grouped into rows (vowels / consonants / semivowels / conjuncts / vowel-signs / controls)
   purely for a cleaner on-screen layout — typing behaviour is identical either way. */
export const DEVA_KEY_GROUPS = [
  { label:"vowels · स्वर", keys:[
    ["अ","a"],["आ","ā"],["इ","i"],["ई","ī"],["उ","u"],["ऊ","ū"],["ऋ","ṛ"],["ए","e"],["ऐ","ai"],["ओ","o"],["औ","au"]
  ]},
  { label:"consonants · व्यंजन", keys:[
    ["क","ka"],["ख","kha"],["ग","ga"],["घ","gha"],["ङ","ṅa"],
    ["च","ca"],["छ","cha"],["ज","ja"],["झ","jha"],["ञ","ña"],
    ["ट","ṭa"],["ठ","ṭha"],["ड","ḍa"],["ढ","ḍha"],["ण","ṇa"],
    ["त","ta"],["थ","tha"],["द","da"],["ध","dha"],["न","na"],
    ["प","pa"],["फ","pha"],["ब","ba"],["भ","bha"],["म","ma"]
  ]},
  { label:"semivowels & sibilants", keys:[
    ["य","ya"],["र","ra"],["ल","la"],["व","va"],["श","śa"],["ष","ṣa"],["स","sa"],["ह","ha"],["ळ","ḷa"]
  ]},
  { label:"conjuncts", keys:[
    ["क्ष","kṣa"],["त्र","tra"],["ज्ञ","jña"]
  ]},
  { label:"vowel signs · मात्रा", keys:[
    ["ा","ā-sign"],["ि","i-sign"],["ी","ī-sign"],["ु","u-sign"],["ू","ū-sign"],["ृ","ṛ-sign"],
    ["े","e-sign"],["ै","ai-sign"],["ो","o-sign"],["ौ","au-sign"]
  ]},
  { label:"anusvāra · visarga · virāma", keys:[
    ["ं","anusvāra"],["ः","visarga"],["्","virāma"],[" ","space"]
  ]}
];
