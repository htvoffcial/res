(() => {
  "use strict";
  // =====================================================================
  // certinaly lang barrier v3 — "higher wall" edition (edited by はね)
  //
  // v2 manufactured the *look* of a language by uniform-random glyph
  // substitution. v3 raises the wall: the pseudo-text now imitates the
  // *shape* of real language —
  //   - words are re-segmented to language-typical lengths and built from
  //     syllable templates (onset/nucleus/coda) with frequency-weighted
  //     letters, common suffixes and language-specific clusters;
  //   - sentence-initial capitalisation, German noun capitalisation,
  //     Greek final sigma, Hebrew final forms, French/Italian elisions;
  //   - diacritics sprinkled at plausible rates per language;
  //   - digits localised (Arabic-Indic, Persian, Devanagari, Bengali,
  //     Thai numerals) and quotes localised („…“, «…», “…”);
  //   - Chinese uses a frequency-ordered pool of common hanzi instead of
  //     a raw Unicode block; Korean syllables are composed from jamo;
  //   - Spanish questions/exclamations get their inverted ¿ ¡.
  // Everything stays deterministic (seeded by the source text), keeps the
  // paragraph skeleton, punctuation order and letter mass of the original.
  // Drop-in compatible with v2: same storage key, same language list.
  // =====================================================================

  const STORAGE_KEY = "certinaly_lang_barrier_v2";

  // === 170+ Countries (ISO 3166-1 alpha-2) === (unchanged from v2)
  const ALL_COUNTRIES = [
    "AF","AL","DZ","AD","AO","AR","AM","AU","AT","AZ","BS","BH","BD","BB","BY","BE","BZ","BJ","BT","BO","BA","BW","BR","BN","BG","BF","BI","KH","CM","CA",
    "CV","CF","TD","CL","CN","CO","KM","CG","CD","CR","CI","HR","CU","CY","CZ","DK","DJ","DM","DO","EC","EG","SV","GQ","ER","EE","ET","FJ","FI","FR",
    "GA","GM","GE","DE","GH","GR","GD","GT","GN","GW","GY","HT","HN","HU","IS","IN","ID","IR","IQ","IE","IL","IT","JM","JP","JO","KZ","KE","KI","KP","KR",
    "KW","KG","LA","LV","LB","LS","LR","LY","LI","LT","LU","MG","MW","MY","MV","ML","MT","MR","MU","MX","MD","MC","MN","ME","MA","MZ","MM","NA","NR","NP",
    "NL","NZ","NI","NE","NG","NO","OM","PK","PA","PG","PY","PE","PH","PL","PT","QA","RO","RU","RW","SA","SN","RS","SC","SL","SG","SK","SI","SB","SO",
    "ZA","ES","LK","SD","SR","SZ","SE","CH","SY","TW","TJ","TZ","TH","TL","TG","TO","TT","TN","TR","TM","UG","UA","AE","GB","US","UY","UZ","VE","VN",
    "YE","ZM","ZW"
  ];

  // === Country → Language overrides === (unchanged from v2)
  const COUNTRY_GROUPS = {
    ja: ["JP"],
    zh: ["CN","TW","HK","MO"],
    ko: ["KR","KP"],
    ru: ["RU","BY","KZ","KG","TJ","UZ"],
    uk: ["UA"],
    ar: ["SA","AE","QA","BH","KW","OM","YE","EG","SD","LY","TN","DZ","MA","JO","LB","SY","IQ","PS","MR","SO"],
    fa: ["IR","AF"],
    he: ["IL"],
    el: ["GR","CY"],
    tr: ["TR","AZ","TM"],
    hi: ["IN","NP"],
    bn: ["BD"],
    ur: ["PK"],
    th: ["TH"],
    vi: ["VN"],
    id: ["ID"],
    ms: ["MY","BN","SG"],
    de: ["DE","AT","CH","LI","LU"],
    fr: ["FR","BE","CI","SN","ML","NE","BF","BJ","TG","CM","GA","GN","CG","CD","MG","TD","DJ","KM","SC"],
    es: ["ES","MX","AR","CO","CL","PE","VE","EC","BO","UY","PY","CR","GT","SV","HN","NI","PA","DO","CU","GQ"],
    pt: ["PT","BR","AO","MZ","CV","GW","ST","TL"],
    it: ["IT","SM","VA"],
    nl: ["NL","SR"],
    sv: ["SE"],
    no: ["NO"],
    da: ["DK"],
    fi: ["FI"],
    pl: ["PL"],
    cs: ["CZ"],
    sk: ["SK"],
    hu: ["HU"],
    ro: ["RO","MD"],
    bg: ["BG"]
  };

  const COUNTRY_LANG = Object.fromEntries(ALL_COUNTRIES.map(c => [c, "latin"]));
  Object.entries(COUNTRY_GROUPS).forEach(([lang, codes]) => {
    codes.forEach(code => COUNTRY_LANG[code] = lang);
  });

  // =====================================================================
  // Deterministic RNG (mulberry32) + string hash — same spirit as v2.
  // =====================================================================
  function hashString(value) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = ((hash << 5) - hash) + value.charCodeAt(i);
      hash |= 0;
    }
    return hash >>> 0;
  }
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9E3779B9;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Weighted pick: repetition inside the pool string encodes the weight.
  function pick(rng, pool) { return pool[Math.floor(rng() * pool.length)]; }
  function pickOf(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  // =====================================================================
  // Language profiles.
  //   fam: alpha | han | hangul | arab | indic | thai | hebrew
  //   V/C: frequency-weighted vowel / consonant pools (letters repeat).
  //   onsets/codas: extra multi-letter clusters for word edges.
  //   suffixes: common word endings, used when the word is long enough.
  //   accents: { baseLetter: [variants...], rate } diacritic sprinkler.
  //   digits: localised 0-9 string. quotes: [open, close].
  //   nounCaps: capitalise a share of mid-sentence words (German).
  //   elision: prefix some short words with l'/d' style apostrophes.
  //   finalMap: word-final letter replacements (Greek ς, Hebrew finals).
  //   wordLen: [min, max, mean-ish weights implicit via sampler].
  // =====================================================================
  const P = {
    en: { fam: "alpha", label: "English", font: "sans-serif", dir: "ltr",
      V: "eeeeeeeeaaaaaiiiiioooouuy", C: "ttttttrrrrrsssssnnnnnllllcccchhhdddmmmfffgggpppbbbvvkkjxqz",
      onsets: ["th","ch","sh","st","tr","br","cl","pr","str","wh","qu"], codas: ["nd","nt","st","ng","th","ck","rd","ld"],
      suffixes: ["ing","tion","ed","ly","er","est","ness","ment","ful","ous"], quotes: ["\u201C","\u201D"], wordLen: [2,9] },
    latin: { fam: "alpha", label: "Latin", font: "sans-serif", dir: "ltr",
      V: "aaaaeeeeiiiiooouu", C: "ttttssssrrrrnnnnllllccccmmmmpppvvbbffggddq",
      onsets: ["qu","pr","tr","cl","sp","st","scr"], codas: ["nt","st","m","s","r"],
      suffixes: ["orum","ibus","us","um","am","ae","is","em","es","o","a","ia"], quotes: ["\u201C","\u201D"], wordLen: [3,10] },
    es: { fam: "alpha", label: "Español", font: "sans-serif", dir: "ltr",
      V: "eeeeeeeaaaaaaiiiiiooooouu", C: "ssssrrrrnnnnlllldddttttccccmmmpppbbbvvggffjzcñq",
      onsets: ["tr","pr","br","cl","cr","pl","gr","fr","qu","ch","ll"], codas: ["n","s","r","l","d","z"],
      suffixes: ["ción","mente","ando","ado","ada","idad","ero","era","os","as","es"],
      accents: { map: { a:"á", e:"é", i:"í", o:"ó", u:"ú" }, rate: 0.06 }, quotes: ["\u00AB","\u00BB"], inverted: true, wordLen: [2,9] },
    fr: { fam: "alpha", label: "Français", font: "sans-serif", dir: "ltr",
      V: "eeeeeeeeaaaaaiiiiiooouuuy", C: "ssssrrrrttttnnnnllllccccmmmmpppddvvbbggffjqzx",
      onsets: ["tr","pr","br","cl","cr","pl","gr","ch","qu","gn","str"], codas: ["nt","rt","s","t","r","n","x"],
      suffixes: ["tion","ment","ité","eaux","eur","euse","ais","ait","ent","ons","ez"],
      accents: { map: { e:"éèê", a:"àâ", i:"îï", o:"ô", u:"ùû", c:"ç" }, rate: 0.14 },
      elision: ["l'","d'","j'","n'","s'","qu'"], quotes: ["\u00AB\u00A0","\u00A0\u00BB"], wordLen: [2,9] },
    pt: { fam: "alpha", label: "Português", font: "sans-serif", dir: "ltr",
      V: "eeeeeaaaaaaaiiiiiooooouu", C: "ssssrrrrnnnnlllldddttttmmmmccccppppvvbbggffjzxq",
      onsets: ["tr","pr","br","cl","cr","pl","gr","ch","qu","nh","lh"], codas: ["m","s","r","l","nte"],
      suffixes: ["ção","mente","ando","ado","ade","eiro","eira","os","as","es"],
      accents: { map: { a:"áâã", e:"éê", i:"í", o:"óôõ", u:"ú", c:"ç" }, rate: 0.16 }, quotes: ["\u00AB","\u00BB"], wordLen: [2,9] },
    de: { fam: "alpha", label: "Deutsch", font: "sans-serif", dir: "ltr",
      V: "eeeeeeeeaaaaaiiiiiooouu", C: "nnnnssssrrrrttttddddhhhhllllccccggggmmmmzzwwbbvffkppj",
      onsets: ["sch","ch","st","sp","tr","br","kl","kr","pr","gr","schr","str"], codas: ["nd","nt","st","ch","rn","rt","ng","cht"],
      suffixes: ["ung","heit","keit","isch","lich","en","er","em","es","end","bar"],
      accents: { map: { a:"ä", o:"ö", u:"ü" }, rate: 0.07 }, sharpS: 0.12,
      quotes: ["\u201E","\u201C"], nounCaps: 0.38, wordLen: [3,11] },
    it: { fam: "alpha", label: "Italiano", font: "sans-serif", dir: "ltr",
      V: "eeeeeaaaaaiiiiiooooou", C: "nnnnllllrrrrttttssssccccmmmmpppddd vvbbggffzq".replace(" ",""),
      onsets: ["tr","pr","br","cl","cr","pl","gr","ch","gh","str","sc"], codas: ["n","r","l","nt","nd"],
      suffixes: ["zione","mente","ando","ato","ità","ore","ere","ano","ono","ico"],
      accents: { map: { a:"à", e:"èé", i:"ì", o:"ò", u:"ù" }, rate: 0.07 },
      elision: ["l'","un'","d'","c'","nell'"], quotes: ["\u00AB","\u00BB"], wordLen: [2,9] },
    nl: { fam: "alpha", label: "Nederlands", font: "sans-serif", dir: "ltr",
      V: "eeeeeeaaaaaiiiioooouu", C: "nnnnttttssssrrrrddddllllgggghhkkmmppvvbbwzfcj",
      onsets: ["sch","st","sp","tr","kl","kr","pr","gr","v","sl"], codas: ["nd","nt","st","ng","cht","rd"],
      suffixes: ["ing","heid","lijk","en","er","e","je","tje","sch"], quotes: ["\u201C","\u201D"], wordLen: [2,10] },
    sv: { fam: "alpha", label: "Svenska", font: "sans-serif", dir: "ltr",
      V: "eeeeeaaaaaiiiiiooouuåäö", C: "nnnnttttssssrrrrllllddddggggkkkkmmmmvvppbbffhj",
      onsets: ["st","tr","sk","sp","kr","pr","br","str","skj"], codas: ["nd","nt","st","ng","rd","sk"],
      suffixes: ["ande","ende","arna","erna","orna","het","ing","en","et","ar","er"], quotes: ["\u00BB","\u00AB"], wordLen: [2,9] },
    no: { fam: "alpha", label: "Norsk", font: "sans-serif", dir: "ltr",
      V: "eeeeeaaaaaiiiiiooouuæøå", C: "nnnnttttssssrrrrllllddddggggkkkkmmmmvvppbbffhj",
      onsets: ["st","tr","sk","sp","kr","pr","br","str","skj"], codas: ["nd","nt","st","ng","rd"],
      suffixes: ["ende","erne","ene","het","ing","en","et","er","ene"], quotes: ["\u00AB","\u00BB"], wordLen: [2,9] },
    da: { fam: "alpha", label: "Dansk", font: "sans-serif", dir: "ltr",
      V: "eeeeeeaaaaaiiiiiooouuæøåy", C: "nnnnttttssssrrrrddddllllggggkkkkmmmmvvppbbfhj",
      onsets: ["st","tr","sk","sp","kr","pr","br","str"], codas: ["nd","nt","st","ng","rd","sk"],
      suffixes: ["ende","erne","ene","hed","ing","en","et","er","ere"], quotes: ["\u00BB","\u00AB"], wordLen: [2,9] },
    fi: { fam: "alpha", label: "Suomi", font: "sans-serif", dir: "ltr",
      V: "aaaaaaaaiiiiiiiieeeeeeooouuuääööy", C: "nnnnttttssssllllrrrrkkkkmmmmppvvjhdl g".replace(" ",""),
      onsets: ["k","t","p","s","h","v","j","l","m","n","r"], codas: ["n","t","s","l","r","m"],
      suffixes: ["inen","jnen","ssa","ssä","lla","llä","ksi","mme","nsa","nsä","vat","vät"], quotes: ["\u201D","\u201D"], wordLen: [3,11], geminate: 0.18 },
    pl: { fam: "alpha", label: "Polski", font: "sans-serif", dir: "ltr",
      V: "aaaaeeeeiiiioooouuyyęą", C: "nnnnsssszzzzrrrrkkkkttttwwwwmmmmppppszczłńdddbbghj",
      onsets: ["sz","cz","rz","trz","prz","str","sk","st","kr","pr","dz","dż","dž".normalize()], codas: ["ść","nd","st","rz","ch","ń"],
      suffixes: ["ość","enie","anie","owy","owa","ach","ów","em","ie","ek","ka"],
      accents: { map: { z:"żź", s:"ś", c:"ć", n:"ń", l:"ł", a:"ą", e:"ę", o:"ó" }, rate: 0.15 }, quotes: ["\u201E","\u201D"], wordLen: [2,10] },
    cs: { fam: "alpha", label: "Čeština", font: "sans-serif", dir: "ltr",
      V: "aaaaeeeeiiiioooouuyyáéíóúýě", C: "nnnnttttvvvssssllllrrrrkkkkddddmmmmppppzhbcčšžďťňřjfgx",
      onsets: ["st","tr","sk","sp","kr","pr","br","str","v","z","č"], codas: ["st","nd","ch","ř","ť"],
      suffixes: ["ost","ení","ání","ová","ový","ech","ům","em","ek","ka","ní"],
      accents: { map: { s:"š", c:"č", z:"ž", r:"ř", d:"ď", t:"ť", n:"ň", e:"ě", a:"á", i:"í", o:"ó", u:"úů", y:"ý" }, rate: 0.18 }, quotes: ["\u201E","\u201C"], wordLen: [2,9] },
    sk: { fam: "alpha", label: "Slovenčina", font: "sans-serif", dir: "ltr",
      V: "aaaaeeeeiiiioooouuyyáéíóúýä", C: "nnnnttttvvvssssllllrrrrkkkkddddmmmmppppzhbcčšžďťňľĺjfgx",
      onsets: ["st","tr","sk","sp","kr","pr","br","str","v","z","č"], codas: ["st","nd","ch","ť","ľ"],
      suffixes: ["osť","enie","anie","ová","ový","och","om","em","ek","ka","ní"],
      accents: { map: { s:"š", c:"č", z:"ž", d:"ď", t:"ť", n:"ň", l:"ľĺ", e:"ä", a:"á", i:"í", o:"óô", u:"ú", y:"ý" }, rate: 0.18 }, quotes: ["\u201E","\u201C"], wordLen: [2,9] },
    hu: { fam: "alpha", label: "Magyar", font: "sans-serif", dir: "ltr",
      V: "eeeeeaaaaaaiiiiiooooööööuuuuüüűőáéíóú", C: "nnnnttttllllsssszzzzkkkkmmmmrrr vvbbggddffhhjppcscszsgy".replace(" ",""),
      onsets: ["sz","zs","cs","gy","ty","ny","st","tr","kr","pr"], codas: ["nd","nt","st","nk","rt","mb"],
      suffixes: ["ság","ség","nak","nek","ban","ben","ból","ból","hoz","ig","ok","ek","ök","ként"], quotes: ["\u201E","\u201D"], wordLen: [3,11] },
    ro: { fam: "alpha", label: "Română", font: "sans-serif", dir: "ltr",
      V: "eeeeeaaaaaiiiiiooouuăâî", C: "nnnnttttssssrrrrllllddddccccmmmmppppvvbbggffjzxhșț",
      onsets: ["tr","pr","br","cl","cr","pl","gr","st","sp","str"], codas: ["nd","nt","st","nc","rt"],
      suffixes: ["ție","ment","are","ere","ile","ele","ul","ului","esc","ist"],
      accents: { map: { a:"ăâ", i:"î", s:"ș", t:"ț" }, rate: 0.16 }, quotes: ["\u201E","\u201C"], wordLen: [2,9] },
    bg: { fam: "alpha", label: "Български", font: "'Ruslan Display', cursive", dir: "ltr",
      V: "ааааееееииииооооуъяю", C: "ннннттттссссррррввввллллкккмммдддпппгзбчйхжшщцф",
      onsets: ["ст","пр","тр","кр","бр","в","з","н"], codas: ["ст","нд","шт","жд"],
      suffixes: ["ост","ение","ание","ата","ето","ове","ият","ски","ство"], quotes: ["\u201E","\u201C"], wordLen: [2,9] },
    ru: { fam: "alpha", label: "Русский", font: "'Ruslan Display', cursive", dir: "ltr",
      V: "аааааеееееииииоооооууыэюя", C: "ннннттттссссррррввввллллккккммммдддпппгггзббчйхжшщцф",
      onsets: ["ст","пр","тр","кр","бр","стр","вз","вс","сп","ск"], codas: ["ст","нд","рн","ль","нь","ть"],
      suffixes: ["ение","ость","ание","ого","его","ает","ует","ов","ев","ам","ям","ся","ный","ная","тся","ешь"], quotes: ["\u00AB","\u00BB"], wordLen: [2,10] },
    uk: { fam: "alpha", label: "Українська", font: "'Ruslan Display', cursive", dir: "ltr",
      V: "ааааееееииииооооууіїєяю", C: "ннннттттссссррррввввллллккккммммдддпппгггзббчйхжшщцфґ",
      onsets: ["ст","пр","тр","кр","бр","стр","сп","ск"], codas: ["ст","нд","рн","ль","нь","ть"],
      suffixes: ["ення","ість","ання","ого","его","ає","ує","ів","ам","ям","ся","ний","на","ться","єш"],
      accents: { map: { и:"ї", е:"є", г:"ґ" }, rate: 0.05 }, quotes: ["\u00AB","\u00BB"], wordLen: [2,10] },
    el: { fam: "alpha", label: "Ελληνικά", font: "'Noto Serif Greek', serif", dir: "ltr",
      V: "ααααεεεειιιιιοοοουυηηω", C: "ννννττττμμμσσσρρρπππκκκλλλβγδζθφχξ",
      onsets: ["στ","πρ","τρ","κρ","μπ","ντ","τσ","κλ"], codas: ["ν","ς","ρ","λ","μ"],
      suffixes: ["ότητα","ηση","αση","ού","ής","ών","ους","ει","αι","τα"],
      accents: { map: { α:"ά", ε:"έ", ι:"ίϊ", ο:"ό", υ:"ύϋ", η:"ή", ω:"ώ" }, rate: 0.30 },
      finalMap: { "σ": "ς" }, quotes: ["\u00AB","\u00BB"], wordLen: [2,9] },
    vi: { fam: "alpha", label: "Tiếng Việt", font: "sans-serif", dir: "ltr",
      V: "aàáảãạăắằẳẵặâấầẩẫậeèéẻẽẹêếềểễệiìíỉĩịoòóỏõọôốồổỗộơớờởỡợuùúủũụưứừửữựyỳýỷỹỵo",
      C: "nnnhhhhttttcccmmmđđgggkkkvvvssssllldddrrrxxxbbbpppqqqjjjfffwwwzz",
      onsets: ["ng","nh","ch","th","tr","kh","ph","gi","qu","gh"], codas: ["ng","nh","n","m","t","c","p"],
      suffixes: [], quotes: ["\u201C","\u201D"], wordLen: [2,4], syllableWords: true },
    id: { fam: "alpha", label: "Bahasa Indonesia", font: "sans-serif", dir: "ltr",
      V: "aaaaaaeeeeeiiiiioooouu", C: "nnnnnggggkkkkttttmmmmppppddddssssrrrrllllhhhbbbgjjcfsywz",
      onsets: ["ng","ny","sy","kh","tr","pr","br","str","per","men","ber","ter"], codas: ["ng","n","r","h","t","k","m","s"],
      suffixes: ["nya","kan","an","i","lah","kah","nya","ku","mu","dan"], quotes: ["\u201C","\u201D"], wordLen: [2,9] },
    ms: { fam: "alpha", label: "Bahasa Melayu", font: "sans-serif", dir: "ltr",
      V: "aaaaaaeeeeeiiiiioooouu", C: "nnnnnggggkkkkttttmmmmppppddddssssrrrrllllhhhbbbgjjcfsywz",
      onsets: ["ng","ny","sy","kh","tr","pr","br","men","ber","ter","per"], codas: ["ng","n","r","h","t","k","m","s"],
      suffixes: ["nya","kan","an","i","lah","kah","ku","mu"], quotes: ["\u201C","\u201D"], wordLen: [2,9] },

    // ---- Arabic-script family ----
    ar: { fam: "arab", label: "العربية", font: "'Amiri', serif", dir: "rtl",
      letters: "اااااالللللللييييمممننننوووهههررربببتتتعععسسددفققكجحخصضطظغةىءؤئزذثش",
      digits: "٠١٢٣٤٥٦٧٨٩", quotes: ["\u201D","\u201C"], wordLen: [2,7], comma: "،", qmark: "؟" },
    fa: { fam: "arab", label: "فارسی", font: "'Amiri', serif", dir: "rtl",
      letters: "ااااااليييينننمممهرررسسستتتببدددوووششخخززععفقققکگچپژههه",
      digits: "۰۱۲۳۴۵۶۷۸۹", quotes: ["\u00AB","\u00BB"], wordLen: [2,7], comma: "،", qmark: "؟" },
    ur: { fam: "arab", label: "اردو", font: "'Amiri', serif", dir: "rtl",
      letters: "ااااااليييينننرررےےےمممتتتهههوووسسسببددڈڑھےےکگچپجھکھ",
      digits: "۰۱۲۳۴۵۶۷۸۹", quotes: ["\u201D","\u201C"], wordLen: [2,7], comma: "،", qmark: "؟" },

    // ---- Hebrew (final forms applied at word ends) ----
    he: { fam: "hebrew", label: "עברית", font: "'Noto Serif Hebrew', serif", dir: "rtl",
      letters: "ייייווווהההלללמממ נננאאא תתת בבברררססששקקדדגגעעצצפפחחטטזז".replace(/ /g,""),
      finalMap: { "כ":"ך", "מ":"ם", "נ":"ן", "פ":"ף", "צ":"ץ" }, quotes: ["\u201D","\u201C"], wordLen: [2,8] },

    // ---- Han (frequency-ordered common hanzi; earlier = more frequent) ----
    zh: { fam: "han", label: "中文", font: "'Zhi Mang Xing', cursive", dir: "ltr",
      pool: "的了是我不在人他们有来个上们大到说国和地也子时道出而要于就下得可你年生自会那后能对着事其里所去行过家十用发天如然作方成者多心都三小军二无同么经法当起与看学进种将还分此心前面又定见只主没公从" +
            "看学进种将还分此前面又定见只主没公从已知战领金难东现达水位斯提想名变此情始达新候员感相思总边解科任很四通力打象四区受算法深般二边果今任音界報集変気画強具実体決声戦当現車南働写神楽場投打新選断門言書救成電数字聞紙語議顔感想読絵続観深説線試真応力安実質風増係確験顔縦芸能識権顔樹拡橋" +
            "笑顔陽光運動健康毎日仲間音楽世界平和希望未来夢力心言葉情報技術社会人間関係問題仕事生活時間今年明日昨日今日朝夜空海山川田花鳥犬猫本語読書映画写真旅行料理勉強質問答" },

    // ---- Hangul: syllables composed from jamo ----
    ko: { fam: "hangul", label: "한국어", font: "'Noto Sans KR', sans-serif", dir: "ltr",
      cho: "ㄱㄱㄴㄴㄷㄷㄹㄹㅁㅁㅂㅂㅅㅅㅅㅇㅇㅇㅇㅈㅈㅊㅋㅌㅍㅎㄲㄸㅃㅆㅉ",
      jung: "ㅏㅏㅐㅑㅓㅓㅖㅕㅗㅗㅛㅜㅜㅠㅡㅡㅢㅣㅣㅔㅖㅒ",
      jong: ["","","","","","","","ㄴ","ㄴ","ㄹ","ㄹ","ㅁ","ㅇ","ㅇ","ㄱ","ㅂ","ㅅ","ㅌ","ㅋ"],
      quotes: ["\u201C","\u201D"], wordLen: [1,4] },

    // ---- Indic family (letters + matra attachment) ----
    hi: { fam: "indic", label: "हिन्दी", font: "'Noto Sans Devanagari', sans-serif", dir: "ltr",
      cons: "ननककररहह ततममपपससबबददगगजजययववललशशचचटटडडधधफफभभखखघघझझठठढढणणथथझ".replace(/ /g,""),
      vowel: "अआइईउऊएऐओऔ", matra: "ािीुूेैोौंंःृााााििेे",
      digits: "०१२३४५६७८९", quotes: ["\u201C","\u201D"], wordLen: [2,6] },
    bn: { fam: "indic", label: "বাংলা", font: "'Noto Sans Bengali', sans-serif", dir: "ltr",
      cons: "ননককররহহততমমপপসসববদদগগজজযযববললশশচচটটডডধধফফভভখখঘঘঝঝঠঠঢঢণণথথড়ঢ়য়",
      vowel: "অআইঈউঊএঐওঔ", matra: "ািীুূেোংঃৃাাাা িিেে".replace(" ",""),
      digits: "০১২৩৪৫৬৭৮৯", quotes: ["\u201C","\u201D"], wordLen: [2,6] },

    // ---- Thai (unspaced runs are authentic; marks sprinkled) ----
    th: { fam: "thai", label: "ไทย", font: "'Noto Sans Thai', sans-serif", dir: "ltr",
      cons: "นมกงรลทดสอหบปคจชพฟซขฉฐฑฒณผฝภยวศษฬฤตถธศษ",
      marks: "าิีึืุูเแโใไำ่้๊๋ั็าิีะาเแ",
      digits: "๐๑๒๓๔๕๖๗๘๙", quotes: ["\u201C","\u201D"] }
  };
  // Bengali font fix (v2 shipped Devanagari font for bn; harmless but odd)
  // (kept as its own family font above)

  const LANG_ORDER = [
    "ja","en","latin","es","fr","pt","de","it","nl","sv","no","da","fi","pl","cs","sk","hu","ro","bg",
    "ru","uk","ar","fa","he","el","zh","ko","hi","bn","ur","th","vi","id","ms"
  ];
  const LANG_META = { ja: { label: "日本語", chars: null, font: "sans-serif", dir: "ltr" } };
  LANG_ORDER.forEach(k => { if (P[k]) LANG_META[k] = { label: P[k].label, font: P[k].font, dir: P[k].dir, chars: true }; });

  // =====================================================================
  // Word synthesis for alphabetic languages.
  // Builds a word of exactly `len` letters from syllable templates so the
  // result has plausible word shape: onset cluster + vowel nucleus +
  // optional codas/suffix, diacritics, case rules.
  // =====================================================================
  function synthWord(rng, prof, len, cap) {
    if (len <= 0) return "";
    let suffix = "";
    if (prof.suffixes && len >= 5 && rng() < 0.38) {
      const cand = prof.suffixes.filter(s => s.length <= len - 2);
      if (cand.length) suffix = pickOf(rng, cand);
    }
    let bodyLen = len - suffix.length;
    let w = "";
    // Occasional multi-letter onset at the start of longer words.
    if (bodyLen >= 4 && prof.onsets && rng() < 0.30) {
      const o = pickOf(rng, prof.onsets.filter(x => x.length <= bodyLen - 1));
      if (o) w += o;
    }
    while (w.length < bodyLen) {
      const remain = bodyLen - w.length;
      const r = rng();
      let syl;
      if (remain === 1) syl = (rng() < 0.55 ? pick(rng, prof.C) : pick(rng, prof.V));
      else if (r < 0.52) syl = pick(rng, prof.C) + pick(rng, prof.V);
      else if (r < 0.78) syl = pick(rng, prof.C) + pick(rng, prof.V) + pick(rng, prof.C);
      else if (r < 0.90) syl = pick(rng, prof.V) + pick(rng, prof.C);
      else syl = pick(rng, prof.V);
      if (prof.geminate && rng() < prof.geminate && syl.length >= 1) {
        syl = syl + syl[syl.length - 1]; // Finnish-style double letters
      }
      w += syl;
    }
    w = w.slice(0, bodyLen);
    // Pad if a cluster overshoot got trimmed into a vowel-less stub.
    while (w.length < bodyLen) w += pick(rng, prof.C);
    w += suffix;

    // German ß for some ss sequences.
    if (prof.sharpS) w = w.replace(/ss/g, m => (rng() < prof.sharpS ? "ß" : m));
    // Diacritic sprinkler.
    if (prof.accents) {
      const { map, rate } = prof.accents;
      w = Array.from(w).map(ch => {
        const v = map[ch];
        if (v && rng() < rate) return v[Math.floor(rng() * v.length)];
        return ch;
      }).join("");
    }
    // Greek final sigma / Hebrew finals.
    if (prof.finalMap) {
      const last = w[w.length - 1];
      if (prof.finalMap[last]) w = w.slice(0, -1) + prof.finalMap[last];
    }
    // French / Italian elision on some short words.
    if (prof.elision && len <= 4 && rng() < 0.16) {
      return pickOf(rng, prof.elision) + w;
    }
    if (cap) w = w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  }

  // Split a letter-mass L into word lengths typical for the language.
  function wordLengths(rng, total, min, max) {
    const lens = [];
    let left = total;
    while (left > 0) {
      if (left <= max) { lens.push(left); break; }
      // Weighted toward the middle: average of two dice-ish draws.
      let w = Math.round(min + (rng() + rng()) / 2 * (max - min));
      if (left - w === 1) w -= 1; // avoid orphan single letter at the end
      if (w < 1) w = 1;
      lens.push(w); left -= w;
    }
    return lens;
  }

  // =====================================================================
  // Per-family block generators. A "block" is a maximal run of letters in
  // the source between anchors (spaces / punctuation / digits).
  // =====================================================================
  function genAlpha(rng, prof, blockLen, sentenceStart) {
    const lens = wordLengths(rng, blockLen, prof.wordLen[0], prof.wordLen[1]);
    const words = lens.map((L, i) => {
      const cap = (i === 0 && sentenceStart) || (prof.nounCaps && rng() < prof.nounCaps);
      return synthWord(rng, prof, L, cap);
    });
    return words.join(" ");
  }
  function genArab(rng, prof, blockLen) {
    const lens = wordLengths(rng, blockLen, prof.wordLen[0], prof.wordLen[1]);
    return lens.map(L => {
      let w = "";
      for (let i = 0; i < L; i += 1) w += pick(rng, prof.letters);
      return w;
    }).join(" ");
  }
  function genHebrew(rng, prof, blockLen) {
    const lens = wordLengths(rng, blockLen, prof.wordLen[0], prof.wordLen[1]);
    return lens.map(L => {
      let w = "";
      for (let i = 0; i < L; i += 1) w += pick(rng, prof.letters);
      const last = w[w.length - 1];
      if (prof.finalMap[last]) w = w.slice(0, -1) + prof.finalMap[last];
      return w;
    }).join(" ");
  }
  function genHan(rng, prof, blockLen) {
    // Frequency bias: index drawn from a skewed distribution so common
    // characters dominate, like real Chinese text.
    let out = "";
    for (let i = 0; i < blockLen; i += 1) {
      const idx = Math.floor(Math.pow(rng(), 2.0) * prof.pool.length);
      out += prof.pool[idx];
    }
    return out;
  }
  function genHangul(rng, prof, blockLen) {
    const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"; // choseong order (19)
    // Medial-vowel indices into the syllable formula (0–20). Every index
    // yields a structurally valid Hangul syllable; weights favour the
    // common vowels (ㅏ ㅐ ㅓ ㅔ ㅗ ㅜ ㅡ ㅣ …).
    const JUNG_IDX = [0,0,0,1,2,3,4,4,4,5,6,7,8,8,9,10,10,11,12,18,19,20,20];
    const JONG_TABLE = "ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"; // jongseong order (27)
    const syl = () => {
      const ci = CHO.indexOf(pick(rng, prof.cho));
      const vi = pickOf(rng, JUNG_IDX);
      const fi = pickOf(rng, prof.jong);
      const fj = fi === "" ? 0 : JONG_TABLE.indexOf(fi) + 1;
      return String.fromCharCode(0xAC00 + ci * 588 + vi * 28 + (fj < 0 ? 0 : fj));
    };
    const lens = wordLengths(rng, blockLen, prof.wordLen[0], prof.wordLen[1]);
    return lens.map(L => { let w = ""; for (let i = 0; i < L; i += 1) w += syl(); return w; }).join(" ");
  }
  function genIndic(rng, prof, blockLen) {
    const lens = wordLengths(rng, blockLen, prof.wordLen[0], prof.wordLen[1]);
    return lens.map(L => {
      let w = "";
      let n = 0;
      while (n < L) {
        if (rng() < 0.16 && n === 0) { w += pick(rng, prof.vowel); n += 1; continue; }
        w += pick(rng, prof.cons); n += 1;
        if (n < L && rng() < 0.42) { w += pick(rng, prof.matra); n += 1; }
      }
      return w;
    }).join(" ");
  }
  function genThai(rng, prof, blockLen) {
    let out = "";
    for (let i = 0; i < blockLen; i += 1) {
      out += pick(rng, prof.cons);
      if (rng() < 0.45) out += pick(rng, prof.marks);
    }
    return out;
  }

  // =====================================================================
  // Main scramble: tokenise into anchors / digits / letter blocks, then
  // regenerate each block in the target language's shape.
  // =====================================================================
  const ANCHORS = new Set(Array.from("。、！？「」『』（）()：:；;・…―—／/｜|％%＃#＠@＆&＝=＋+＊*＜>＜＞"));
  function localizeAnchor(ch, prof) {
    if (!prof) return ch;
    const cjkLike = prof.fam === "han" || prof.fam === "hangul";
    if (ch === "「" || ch === "『") return prof.quotes ? prof.quotes[0] : ch;
    if (ch === "」" || ch === "』") return prof.quotes ? prof.quotes[1] : ch;
    if (cjkLike) return ch;
    if (ch === "、") return prof.comma || ",";
    if (ch === "。") return ".";
    if (ch === "？") return prof.qmark || "?";
    if (ch === "！") return "!";
    if (ch === "・") return prof.fam === "arab" || prof.fam === "hebrew" ? " " : "·";
    return ch;
  }

  function scrambleText(text, langKey) {
    const prof = P[langKey];
    if (!prof) return text;
    const rng = makeRng(hashString(text + "|" + langKey) ^ 0x51F15EED);

    // Tokenise.
    const tokens = []; // {t:'block'|'anchor'|'digit'|'space', v}
    let buf = "";
    const flush = () => { if (buf) { tokens.push({ t: "block", v: buf }); buf = ""; } };
    for (const ch of text) {
      if (/\s/.test(ch) || ch === "　") { flush(); tokens.push({ t: "space", v: " " }); }
      else if (ANCHORS.has(ch)) { flush(); tokens.push({ t: "anchor", v: ch }); }
      else if (/[0-9]/.test(ch)) { flush(); tokens.push({ t: "digit", v: ch }); }
      else buf += ch;
    }
    flush();

    // Spanish inverted marks need the block *before* ？/！ — precompute.
    const invertedBefore = new Set();
    if (prof.inverted) {
      tokens.forEach((tk, i) => {
        if (tk.t === "anchor" && (tk.v === "？" || tk.v === "！")) {
          for (let j = i - 1; j >= 0; j -= 1) {
            if (tokens[j].t === "block") { invertedBefore.add(j); break; }
            if (tokens[j].t === "anchor") break;
          }
        }
      });
    }

    let sentenceStart = true;
    let prevType = null;
    const SPACED = prof.fam === "alpha" || prof.fam === "arab" || prof.fam === "hebrew" || prof.fam === "indic" || prof.fam === "hangul";
    let out = "";
    tokens.forEach((tk, i) => {
      if (tk.t === "space") { out += (prof.fam === "han" || prof.fam === "thai") ? "" : " "; return; }
      if (tk.t === "digit") {
        if (SPACED && prevType === "block" && !out.endsWith(" ")) out += " ";
        out += prof.digits ? prof.digits[Number(tk.v)] : tk.v;
        sentenceStart = false; prevType = "digit"; return;
      }
      if (tk.t === "anchor") {
        const loc = localizeAnchor(tk.v, prof);
        out += loc;
        // European/Arabic-style spacing after sentence punctuation.
        if (SPACED && [",", ".", "!", "?", ";", ":", "،", "؟"].includes(loc)) {
          const next = tokens[i + 1];
          if (next && (next.t === "block" || next.t === "digit") && !out.endsWith(" ")) out += " ";
        }
        if ("。！？.!?".includes(tk.v)) sentenceStart = true;
        prevType = "anchor";
        return;
      }
      // block
      if (SPACED && prevType === "digit" && !out.endsWith(" ")) out += " ";
      prevType = "block";
      const L = Array.from(tk.v).length;
      let gen;
      switch (prof.fam) {
        case "alpha": gen = genAlpha(rng, prof, L, sentenceStart); break;
        case "arab": gen = genArab(rng, prof, L); break;
        case "hebrew": gen = genHebrew(rng, prof, L); break;
        case "han": gen = genHan(rng, prof, L); break;
        case "hangul": gen = genHangul(rng, prof, L); break;
        case "indic": gen = genIndic(rng, prof, L); break;
        case "thai": gen = genThai(rng, prof, L); break;
        default: gen = tk.v;
      }
      if (invertedBefore.has(i)) {
        // find which anchor follows to choose ¿ vs ¡
        let mark = "¿";
        for (let j = i + 1; j < tokens.length; j += 1) {
          if (tokens[j].t === "anchor") { mark = tokens[j].v === "！" ? "¡" : "¿"; break; }
        }
        gen = mark + gen;
      }
      out += gen;
      sentenceStart = false;
    });
    return out;
  }

  // Expose for testing under Node; harmless in the browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { scrambleText, LANG_META, LANG_ORDER, P };
  }
  if (typeof document === "undefined") return;

  // =====================================================================
  // DOM application — structure unchanged from v2.
  // =====================================================================
  const fontsHref =
    "https://fonts.googleapis.com/css2" +
    "?family=Amiri" +
    "&family=Ruslan+Display" +
    "&family=Zhi+Mang+Xing" +
    "&family=Noto+Sans+KR" +
    "&family=Noto+Sans+Thai" +
    "&family=Noto+Sans+Devanagari" +
    "&family=Noto+Sans+Bengali" +
    "&family=Noto+Serif+Hebrew" +
    "&family=Noto+Serif+Greek" +
    "&display=swap";
  if (!document.querySelector(`link[href="${fontsHref}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = fontsHref;
    document.head.appendChild(link);
  }

  const EXCLUDE_TAGS = new Set(["SCRIPT","STYLE","TEXTAREA","INPUT","OPTION","SELECT","NOSCRIPT"]);
  const originalMap = new WeakMap();
  const textNodes = new Set();
  let currentLang = "ja";

  function isSkippable(node) {
    if (!node || !node.parentElement) return true;
    const tag = node.parentElement.tagName;
    if (EXCLUDE_TAGS.has(tag)) return true;
    if (node.parentElement.closest("[contenteditable='true']")) return true;
    return false;
  }

  function collectTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (isSkippable(node)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!originalMap.has(node)) originalMap.set(node, node.nodeValue);
      textNodes.add(node);
    }
  }

  function applyLanguage(lang) {
    const config = LANG_META[lang] || LANG_META.ja;
    currentLang = lang;
    document.body.style.fontFamily = config.font;
    document.body.style.direction = config.dir;
    textNodes.forEach(node => {
      const original = originalMap.get(node) || node.nodeValue;
      if (lang === "ja" || !config.chars) {
        node.nodeValue = original;
      } else {
        node.nodeValue = scrambleText(original, lang);
      }
    });
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* private mode */ }
  }

  function detectLang() {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    if (saved) return saved;
    const raw = (navigator.language || navigator.userLanguage || "ja").toLowerCase();
    const parts = raw.split(/[-_]/);
    const lang = parts[0];
    const country = (parts[1] || "").toUpperCase();
    if (country && COUNTRY_LANG[country]) return COUNTRY_LANG[country];
    if (LANG_META[lang]) return lang;
    return "ja";
  }

  function buildSelector() {
    const container = document.createElement("div");
    container.id = "barrier-container";
    container.style.cssText = [
      "display:flex", "background: gainsboro", "padding: 12px",
      "border: 2px solid #333", "width:fit-content",
      "justify-content: center", "align-items: center",
      "z-index: 100000", "font-family: sans-serif"
    ].join(";");
    const label = document.createElement("label");
    label.htmlFor = "lang-select";
    label.textContent = "Language: ";
    container.appendChild(label);
    const select = document.createElement("select");
    select.id = "lang-select";
    LANG_ORDER.forEach(key => {
      if (!LANG_META[key]) return;
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = LANG_META[key].label;
      select.appendChild(opt);
    });
    select.addEventListener("change", e => applyLanguage(e.target.value));
    container.appendChild(select);
    document.body.appendChild(container);
  }

  function init() {
    collectTextNodes(document.body);
    buildSelector();
    const initial = detectLang();
    const select = document.getElementById("lang-select");
    if (select) select.value = initial;
    applyLanguage(initial);
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 || node.nodeType === 11) {
            collectTextNodes(node);
          } else if (node.nodeType === 3) {
            collectTextNodes(node.parentNode || document.body);
          }
        });
      });
      if (currentLang !== "ja") applyLanguage(currentLang);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
