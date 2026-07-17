#!/usr/bin/env node
/**
 * TestMe — Data Validation Script
 * -------------------------------------------------------------
 * Runs integrity and coverage checks against the app's data
 * (src/App.jsx). Catches the classes of bugs that keep surfacing
 * manually: missing fields, broken cross-references, orphan routes,
 * and search terms that return nothing.
 *
 * Usage:   node validate.mjs [path/to/App.jsx]
 * Default: ./src/App.jsx
 * Exit code 0 = all clear, 1 = errors found (warnings don't fail).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || path.join(__dirname, "src", "App.jsx");

// ---------- helpers ----------------------------------------------------------
const RED = "\x1b[31m", YEL = "\x1b[33m", GRN = "\x1b[32m", DIM = "\x1b[2m", BOLD = "\x1b[1m", RST = "\x1b[0m";
const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

if (!fs.existsSync(target)) {
  console.error(`${RED}Cannot find file:${RST} ${target}`);
  process.exit(1);
}
const src = fs.readFileSync(target, "utf8");

/**
 * Extract a top-level `const NAME = [ ... ];` or `= { ... };` literal from the
 * source by brace/bracket matching, then eval it in a sandbox to get real JS.
 */
function extractLiteral(name) {
  const declRe = new RegExp(`const\\s+${name}\\s*=\\s*([\\[{])`);
  const m = src.match(declRe);
  if (!m) return undefined;
  const openChar = m[1];
  const closeChar = openChar === "[" ? "]" : "}";
  let i = m.index + m[0].length - 1; // at the opening bracket
  let depth = 0, inStr = null, prev = "";
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === inStr && prev !== "\\") inStr = null;
    } else if (c === '"' || c === "'" || c === "`") {
      inStr = c;
    } else if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) { i++; break; }
    }
    prev = c;
  }
  const literal = src.slice(m.index + m[0].length - 1, i);
  try {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${literal});`)();
  } catch (e) {
    err(`Failed to parse ${name}: ${e.message}`);
    return undefined;
  }
}

// ---------- load data --------------------------------------------------------
const BLOOD = extractLiteral("BLOOD") || [];
const CARDIO = extractLiteral("CARDIO") || [];
const IMAGING = extractLiteral("IMAGING") || [];
const SCREENING = extractLiteral("SCREENING") || [];
const RULES = extractLiteral("RULES") || [];
const PANELS = extractLiteral("PANELS") || [];
const SYMPTOM_ROUTES = extractLiteral("SYMPTOM_ROUTES") || {};
const AMBIGUOUS_TERMS = extractLiteral("AMBIGUOUS_TERMS") || {};
const TRANSLATION_MAP = extractLiteral("TRANSLATION_MAP") || {};
const LAB_REPORT_SYNONYMS = extractLiteral("LAB_REPORT_SYNONYMS") || {};
const CONCEPT_NOTES = extractLiteral("CONCEPT_NOTES") || {};
const ROUTE_NOTES = extractLiteral("ROUTE_NOTES") || {};

const ALL_TESTS = [
  ...BLOOD.map(t => ({ ...t, category: "blood" })),
  ...CARDIO.map(t => ({ ...t, category: "cardio" })),
  ...IMAGING.map(t => ({ ...t, category: "imaging" })),
  ...SCREENING.map(t => ({ ...t, category: "screening" })),
];
const TEST_MAP = Object.fromEntries(ALL_TESTS.map(t => [t.id, t]));
const idExists = (id) => Object.prototype.hasOwnProperty.call(TEST_MAP, id);

console.log(`\n${BOLD}TestMe validation${RST} ${DIM}(${path.relative(process.cwd(), target)})${RST}`);
console.log(`${DIM}Loaded: ${BLOOD.length} blood · ${CARDIO.length} cardio · ${IMAGING.length} imaging · ${SCREENING.length} screening = ${ALL_TESTS.length} tests${RST}\n`);

if (ALL_TESTS.length === 0) {
  console.error(`${RED}No tests parsed — aborting.${RST}`);
  process.exit(1);
}

// ============================================================================
// CHECK 1 — Duplicate test IDs
// ============================================================================
(() => {
  const seen = new Map();
  ALL_TESTS.forEach(t => {
    if (seen.has(t.id)) err(`Duplicate test id "${t.id}" (in ${seen.get(t.id)} and ${t.category})`);
    else seen.set(t.id, t.category);
  });
})();

// ============================================================================
// CHECK 2 — Required fields per test
// ============================================================================
(() => {
  // Fields every test needs
  const common = ["id", "name", "en", "desc", "importance", "reliability", "coverage"];
  // Blood-style tests interpret a numeric value → need range/high/low/unit
  const bloodLike = ["range", "high", "low", "unit"];
  // Procedure-style tests describe an exam → need what/procedure
  const procLike = ["what", "procedure"];

  ALL_TESTS.forEach(t => {
    common.forEach(f => {
      if (!t[f] || String(t[f]).trim() === "") err(`Test "${t.id}" missing required field: ${f}`);
    });
    const isProcedure = t.type === "procedure";
    if (isProcedure) {
      procLike.forEach(f => { if (!t[f]) warn(`Procedure "${t.id}" missing "${f}"`); });
    } else {
      bloodLike.forEach(f => { if (!t[f]) warn(`Blood test "${t.id}" missing "${f}"`); });
    }
    // Everyone should have search tags
    if (!Array.isArray(t.tags) || t.tags.length === 0) warn(`Test "${t.id}" has no search tags`);
    // topicNote is what powers the "why is this connected" explanation
    if (!t.topicNote) warn(`Test "${t.id}" missing topicNote (no connection explanation)`);
  });
})();

// ============================================================================
// CHECK 3 — related[] must reference existing test IDs (no orphans / self-links)
// ============================================================================
(() => {
  ALL_TESTS.forEach(t => {
    (t.related || []).forEach(rid => {
      if (!idExists(rid)) err(`Test "${t.id}" → related "${rid}" does not exist`);
      if (rid === t.id) warn(`Test "${t.id}" lists itself in related[]`);
    });
  });
})();

// ============================================================================
// CHECK 4 — PANELS testIds must all exist
// ============================================================================
(() => {
  const seen = new Set();
  PANELS.forEach(p => {
    if (seen.has(p.id)) err(`Duplicate panel id "${p.id}"`);
    seen.add(p.id);
    if (!p.title || !p.blurb) err(`Panel "${p.id}" missing title/blurb`);
    if (!Array.isArray(p.matchTags) || p.matchTags.length === 0) warn(`Panel "${p.id}" has no matchTags`);
    (p.testIds || []).forEach(id => {
      if (!idExists(id)) err(`Panel "${p.id}" → testId "${id}" does not exist`);
    });
  });
})();

// ============================================================================
// CHECK 5 — RULES reference existing test IDs and valid directions
// ============================================================================
(() => {
  const validDir = new Set(["high", "low", "normal"]);
  RULES.forEach(r => {
    const pairs = [...(r.need || []), ...(r.extraAny || [])];
    pairs.forEach(([id, dir]) => {
      if (!idExists(id)) err(`Rule "${r.id}" references missing test "${id}"`);
      if (!validDir.has(dir)) err(`Rule "${r.id}" has invalid direction "${dir}" for "${id}"`);
    });
    if (!r.msg) warn(`Rule "${r.id}" missing msg`);
  });
})();

// ============================================================================
// CHECK 6 — SYMPTOM_ROUTES must map to existing test IDs
// ============================================================================
(() => {
  Object.entries(SYMPTOM_ROUTES).forEach(([term, ids]) => {
    ids.forEach(id => {
      if (!idExists(id)) err(`SYMPTOM_ROUTES["${term}"] → "${id}" does not exist`);
    });
  });
})();

// ============================================================================
// CHECK 7 — LAB_REPORT_SYNONYMS must map to existing test IDs
// ============================================================================
(() => {
  Object.entries(LAB_REPORT_SYNONYMS).forEach(([term, id]) => {
    if (!idExists(id)) err(`LAB_REPORT_SYNONYMS["${term}"] → "${id}" does not exist`);
  });
})();

// ============================================================================
// CHECK 8 — CONCEPT_NOTES / ROUTE_NOTES keyed test IDs must exist
// ============================================================================
(() => {
  Object.entries(CONCEPT_NOTES).forEach(([concept, def]) => {
    Object.keys(def.tests || {}).forEach(id => {
      if (!idExists(id)) err(`CONCEPT_NOTES["${concept}"].tests → "${id}" does not exist`);
    });
  });
  Object.entries(ROUTE_NOTES).forEach(([route, def]) => {
    Object.keys(def.tests || {}).forEach(id => {
      if (!idExists(id)) err(`ROUTE_NOTES["${route}"].tests → "${id}" does not exist`);
    });
    // Ideally every test named in a ROUTE_NOTE is also actually routed there
    const routeMatchTerms = def.match || [];
    const routedIds = new Set();
    routeMatchTerms.forEach(term => {
      const key = Object.keys(SYMPTOM_ROUTES).find(k => k.toLowerCase() === term.toLowerCase());
      if (key) SYMPTOM_ROUTES[key].forEach(id => routedIds.add(id));
    });
    if (routedIds.size > 0) {
      Object.keys(def.tests || {}).forEach(id => {
        if (!routedIds.has(id)) warn(`ROUTE_NOTES["${route}"] explains "${id}" but no matching SYMPTOM_ROUTES actually returns it`);
      });
    }
  });
})();

// ============================================================================
// Shared search simulator — mirrors the app's exact-match logic, INCLUDING
// the Russian/Arabic → concept translation bridge.
// ============================================================================
function translateQuery(qRaw) {
  const norm = qRaw.trim().toLowerCase();
  if (TRANSLATION_MAP[norm]) return TRANSLATION_MAP[norm];
  const keys = Object.keys(TRANSLATION_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) if (norm.includes(k)) return TRANSLATION_MAP[k];
  return null;
}

function search(qRaw) {
  const q0 = qRaw.trim();
  const translated = translateQuery(q0);
  const q = translated || q0;
  const qLower = q.toLowerCase();
  const synId = (() => {
    const norm = qLower.replace(/\s+/g, " ");
    if (LAB_REPORT_SYNONYMS[norm]) return LAB_REPORT_SYNONYMS[norm];
    const keys = Object.keys(LAB_REPORT_SYNONYMS).sort((a, b) => b.length - a.length);
    for (const k of keys) if (norm.includes(k)) return LAB_REPORT_SYNONYMS[k];
    return null;
  })();
  const routeKey = Object.keys(SYMPTOM_ROUTES).find(k => k === qLower || qLower.includes(k) || k.includes(qLower));
  const routeIds = routeKey ? SYMPTOM_ROUTES[routeKey] : null;
  return ALL_TESTS.filter(t =>
    t.name.includes(q)
    || (t.en && t.en.toLowerCase().includes(qLower))
    || (t.tags && t.tags.some(tag => tag.toLowerCase().includes(qLower) || qLower.includes(tag.toLowerCase())))
    || (synId && t.id === synId)
    || (routeIds && routeIds.includes(t.id))
  );
}

// ============================================================================
// CHECK 9 — Search coverage: simulate the app's matching for common terms.
//           Every term below MUST return at least one test (hard failure).
// ============================================================================
(() => {
  // Terms a real user is likely to type. Add freely as coverage grows.
  const expectHits = [
    // organs / systems
    "כבד", "כליות", "לב", "בלוטת התריס", "עצם", "דם",
    "liver", "kidney", "heart", "thyroid", "bone",
    // symptoms
    "חום", "מיגרנה", "כאב ראש", "עייפות", "כאבי בטן", "כאבי גב",
    "סיאטיקה", "כתף", "ברך", "שינה", "חרדה", "פאניקה", "סכיזופרניה",
    "פריחה", "אלרגיה", "אסתמה",
    "fever", "migraine", "sciatica", "shoulder", "sleep", "anxiety", "rash", "allergy",
    // categories
    "ויטמין", "ויטמינים", "מינרל", "מינרלים", "הורמונים", "שומנים בדם",
    "vitamin", "mineral", "hormones", "cholesterol", "anemia", "אנמיה",
    // conditions / topics
    "סוכרת", "קוליטיס", "צליאק", "גאוט", "כיס מרה", "טחול",
    "diabetes", "colitis", "gallbladder", "spleen", "uti",
    // specific tests (lab-report style)
    "HbA1c", "glucose", "cholesterol", "LDL", "ferritin", "TSH",
    "ApoB", "Lp(a)", "creatinine", "insulin",
  ];

  expectHits.forEach(term => {
    const hits = search(term);
    if (hits.length === 0) err(`Search "${term}" returns ZERO results (expected at least one)`);
  });
})();

// ============================================================================
// CHECK 12 — Broad multilingual disease/symptom sweep (Hebrew, English,
// Russian, Arabic). This is a curated cross-section of common conditions and
// symptoms, NOT the full ICD-10 catalogue (~70,000 codes) — that's neither
// realistic nor useful for a consumer test-index app, since the overwhelming
// majority of ICD codes are ultra-specific sub-codes with no distinct lab
// correlate. This check instead reports COVERAGE (info-only, does not fail
// the build) so gaps can be triaged and prioritized by how common the term
// actually is. Extend the lists below over time.
// ============================================================================
(() => {
  const SWEEP = {
    Hebrew: [
      "אסתמה","אלרגיה","אנמיה","אי ספיקת לב","אבנים בכליות","בחילה","בעיות שינה","בצקת",
      "גאוט","דיכאון","דלקת ריאות","דלקת פרקים","דלקת כבד","הפטיטיס","השמנה","זאבת","זיהום",
      "חום","חרדה","חוסר תיאבון","חולשה","טרשת נפוצה","יתר לחץ דם","יתר פעילות בלוטת התריס",
      "כאב ראש","כאבי גב","כאבי בטן","כאבי פרקים","כבד שומני","לחץ דם גבוה",
      "מיגרנה","מחלת כליות","מחלת לב","מחלת עצם","מחלת עור","נשירת שיער","נדודי שינה","נזלת",
      "סוכרת","סחרחורת","סרטן","סינוסיטיס","עייפות","עצירות","עצבנות",
      "פריחה","פסוריאזיס","פרקינסון","צהבת","צליאק","קוליטיס","קדחת",
      "ריאות","רגישות לגלוטן","שיעול","שבץ","שיגרון","שינה","תת פעילות בלוטת התריס","תשישות",
    ],
    English: [
      "Asthma","Anemia","Anxiety","Arthritis","Allergy","Atherosclerosis","Bronchitis","Back pain",
      "Cancer","Cholesterol","Colitis","COPD","Crohn's disease","Cirrhosis","Diabetes","Depression",
      "Dermatitis","Dehydration","Eczema","Edema","Fatigue","Fever","Fibromyalgia","Gout","GERD",
      "Gallstones","Headache","Hepatitis","Hypertension","Hyperthyroidism","Hypothyroidism","Hives",
      "Insomnia","Iron deficiency","Jaundice","Kidney stones","Kidney disease","Lupus","Liver disease",
      "Migraine","Multiple sclerosis","Menopause","Nausea","Neuropathy","Obesity","Osteoporosis",
      "Pneumonia","Psoriasis","PCOS","Panic attack","Rash","Rheumatoid arthritis","Sciatica",
      "Schizophrenia","Stroke","Sinusitis","Thyroid disease","Tuberculosis","Ulcer",
      "Urinary tract infection","Vitamin deficiency","Weight loss",
    ],
    Russian: [
      "диабет","анемия","тревога","паника","шизофрения","аллергия","астма","сыпь","лихорадка",
      "температура","мигрень","головная боль","боль в спине","боль в суставах","артрит","холестерин",
      "щитовидная железа","гипотиреоз","гипертиреоз","давление","гипертония","депрессия","бессонница",
      "усталость","гастрит","колит","целиакия","камни в почках","почечная недостаточность",
      "болезнь печени","гепатит","желчный пузырь","селезенка","подагра","остеопороз","витамин д",
      "дефицит железа","инфекция мочевыводящих путей",
    ],
    Arabic: [
      "سكري","فقر الدم","قلق","هلع","فصام","حساسية","ربو","طفح","حمى","صداع نصفي","صداع",
      "ألم الظهر","ألم المفاصل","التهاب المفاصل","كوليسترول","الغدة الدرقية","قصور الغدة الدرقية",
      "فرط نشاط الغدة الدرقية","ضغط الدم","اكتئاب","أرق","تعب","التهاب المعدة","التهاب القولون",
      "حصى الكلى","الفشل الكلوي","مرض الكبد","التهاب الكبد","المرارة","الطحال","النقرس",
      "هشاشة العظام","نقص فيتامين د","نقص الحديد","التهاب المسالك البولية",
    ],
  };

  console.log(`${BOLD}Multilingual sweep${RST} ${DIM}(curated common-condition list, not full ICD-10)${RST}`);
  let grandTotal = 0, grandHit = 0;
  const missesByLang = {};
  Object.entries(SWEEP).forEach(([lang, terms]) => {
    let hit = 0;
    const misses = [];
    terms.forEach(term => {
      const hits = search(term);
      if (hits.length > 0) hit++;
      else misses.push(term);
    });
    grandTotal += terms.length;
    grandHit += hit;
    missesByLang[lang] = misses;
    const pct = ((hit / terms.length) * 100).toFixed(0);
    console.log(`  ${lang.padEnd(8)} ${hit}/${terms.length} (${pct}%)`);
  });
  const overallPct = ((grandHit / grandTotal) * 100).toFixed(0);
  console.log(`  ${DIM}Overall: ${grandHit}/${grandTotal} (${overallPct}%)${RST}`);
  console.log("");
  Object.entries(missesByLang).forEach(([lang, misses]) => {
    if (misses.length > 0) {
      console.log(`  ${YEL}${lang} misses:${RST} ${misses.join(", ")}`);
    }
  });
  console.log("");
})();

// ============================================================================
// CHECK 13 — Tag self-consistency: for EVERY tag on EVERY test, searching
// that exact tag string must return that test. This is the "does every tag
// actually work in search" check — it would catch typos, case mismatches,
// or a broken matching path even if the tag itself looks fine in the data.
// ============================================================================
(() => {
  let totalTags = 0, brokenTags = 0;
  const brokenList = [];
  ALL_TESTS.forEach(t => {
    (t.tags || []).forEach(tag => {
      totalTags++;
      const hits = search(tag);
      if (!hits.some(h => h.id === t.id)) {
        brokenTags++;
        brokenList.push(`"${tag}" (on test "${t.id}") does not return "${t.id}" when searched verbatim`);
      }
    });
  });
  console.log(`${BOLD}Tag self-consistency${RST} ${DIM}(every tag, on every test, searched verbatim)${RST}`);
  console.log(`  ${totalTags - brokenTags}/${totalTags} tags correctly return their own test`);
  if (brokenList.length > 0) {
    brokenList.forEach(m => err(m));
  }
  console.log("");
})();

// ============================================================================
// CHECK 14 — Autocomplete/typeahead coverage: mirrors the app's
// getSearchSuggestions() logic and verifies that typing a short PREFIX of a
// known concept/route/test-name actually surfaces that full term as a
// suggestion. This is what would catch "the suggestion feature works in
// concept but doesn't always fire."
// ============================================================================
(() => {
  const CONCEPT_POOL = Array.from(new Set(
    Object.keys(SYMPTOM_ROUTES)
      .concat(Object.keys(AMBIGUOUS_TERMS))
      .concat(ALL_TESTS.flatMap(t => t.tags || []))
  ));
  const NAME_POOL = Array.from(new Set(ALL_TESTS.flatMap(t => [t.name, t.en]).filter(Boolean)));

  function getSearchSuggestions(qRaw, limit = 6) {
    const q = (qRaw || "").trim().toLowerCase();
    if (!q) return [];
    const startsWith = [], includes = [];
    const consider = (term) => {
      const tLower = term.toLowerCase();
      if (tLower === q) return;
      if (tLower.startsWith(q)) startsWith.push(term);
      else if (tLower.includes(q)) includes.push(term);
    };
    CONCEPT_POOL.forEach(consider);
    NAME_POOL.forEach(consider);
    const seen = new Set(), out = [];
    [...startsWith, ...includes].forEach(term => {
      if (!seen.has(term) && out.length < limit) { seen.add(term); out.push(term); }
    });
    return out;
  }

  // For every known concept term AND every test name, take short prefixes
  // (2, 3, 4 chars) and confirm the full term comes back as a suggestion.
  let totalProbes = 0, brokenProbes = 0;
  const brokenList = [];
  const sourceTerms = Array.from(new Set([...CONCEPT_POOL, ...NAME_POOL]));
  sourceTerms.forEach(term => {
    [2, 3, 4].forEach(len => {
      if (term.length <= len) return; // skip terms too short to prefix meaningfully
      const prefix = term.slice(0, len);
      totalProbes++;
      const suggestions = getSearchSuggestions(prefix, 10);
      if (!suggestions.includes(term)) {
        brokenProbes++;
        brokenList.push(`prefix "${prefix}" (of "${term}") does not surface "${term}" among suggestions`);
      }
    });
  });

  console.log(`${BOLD}Autocomplete coverage${RST} ${DIM}(prefixes of every concept/route/test-name term)${RST}`);
  const pct = totalProbes > 0 ? ((100 * (totalProbes - brokenProbes)) / totalProbes).toFixed(1) : "100.0";
  console.log(`  ${totalProbes - brokenProbes}/${totalProbes} prefix probes correctly surface their source term (${pct}%)`);
  if (brokenProbes > 0) {
    // Reported as a WARNING not a hard error: with a suggestion cap of 10 and
    // many overlapping short prefixes (several terms can share the same
    // 2-letter start), some crowding-out is structurally expected. Still
    // worth surfacing so the limit or pool can be tuned if the miss rate
    // creeps up.
    warn(`Autocomplete: ${brokenProbes}/${totalProbes} prefix probes did not surface their source term (run with --verbose-autocomplete for details)`);
    if (process.argv.includes("--verbose-autocomplete")) {
      brokenList.forEach(m => console.log(`  ${YEL}•${RST} ${m}`));
    } else {
      console.log(`  ${DIM}(run with --verbose-autocomplete to list all misses)${RST}`);
    }
  }
  console.log("");

  // Specific real-world regression cases (reported by actual usage) — these
  // are hard failures since they're known-important terms, not just part of
  // the generic sweep.
  const KNOWN_CASES = [
    { prefix: "סכיזו", expect: "סכיזופרניה" },
    { prefix: "פסיכו", expect: "פסיכוזה" },
    { prefix: "מיגר", expect: "מיגרנה" },
    { prefix: "חרד", expect: "חרדה" },
  ];
  KNOWN_CASES.forEach(({ prefix, expect }) => {
    const s = getSearchSuggestions(prefix, 10);
    if (!s.includes(expect)) {
      err(`Known regression case: typing "${prefix}" does not suggest "${expect}" (got: ${s.join(", ") || "nothing"})`);
    }
  });
})();

// ============================================================================
// CHECK 10 — Tests unreachable by any search (no name/en/tag path is unusual)
// ============================================================================
(() => {
  ALL_TESTS.forEach(t => {
    const searchable = [t.name, t.en, ...(t.tags || [])].filter(Boolean);
    if (searchable.length <= 1) warn(`Test "${t.id}" is barely searchable (only its name)`);
  });
})();

// ============================================================================
// CHECK 11 — Reciprocal-link hygiene (informational): related links that
//            aren't mutual. Not an error — just useful to see.
// ============================================================================
(() => {
  let oneWay = 0;
  ALL_TESTS.forEach(t => {
    (t.related || []).forEach(rid => {
      const other = TEST_MAP[rid];
      if (other && !(other.related || []).includes(t.id)) oneWay++;
    });
  });
  if (oneWay > 0) console.log(`${DIM}ℹ ${oneWay} one-way related links (not necessarily a problem).${RST}`);
})();

// ============================================================================
// CHECK 15 — Real-world external index sweep: Infomed.co.il's disease
// encyclopedia (https://www.infomed.co.il/diseases/), a genuine, independently
// maintained Israeli medical index of 1,305 conditions with Hebrew+English
// names. This is pages 1-4 of 14 (~250 conditions) — NOT the full 1,305,
// because each page costs a large fetch and this is meant as a real,
// authoritative spot-check rather than an exhaustive scrape. Extend by
// fetching https://www.infomed.co.il/diseases/?page=N for N=5..14 and adding
// more names below.
//
// This is INFO-only (does not fail the build): many of these are legitimately
// rare/specialized conditions (e.g. bacterial species names, obscure
// syndromes) that a general consumer test-index app has no reason to cover.
// The value is the coverage percentage and the miss list — common conditions
// showing up as misses are worth fixing; obscure ones are just visibility.
// ============================================================================
(() => {
  const INFOMED_SAMPLE = [
    "CMV", "OCD", "אבנים בכליות", "אבעבועות רוח", "אוטיזם", "אורטיקריה", "אטופיק דרמטיטיס",
    "אימפטיגו", "אנדומטריוזיס", "אנמיה", "אפטה", "אפנדציטיס", "ברונכיטיס", "דורבן", "דיכאון",
    "דלקת גרון", "דלקת קרום המוח", "דמנציה", "הליקובקטר פילורי", "הפרעת אישיות גבולית", "הרפס",
    "התקף חרדה", "ורטיגו", "טחורים", "טרשת נפוצה", "כינים", "לחץ דם גבוה", "מאניה דפרסיה",
    "מחלת הנשיקה", "מיגרנה", "סבוריאה", "סינוסיטיס", "סכיזופרניה", "סרטן", "פטרייה בנרתיק",
    "פיברומיאלגיה", "פיסורה", "פסוריאזיס", "פפילומה", "צרבת", "קוליטיס כיבית", "קנדידה", "קרוהן",
    "שיתוק שינה", "שעורה בעין", "שפעת", "תסמונת דאון", "ADD", "ADHD", "ALS", "PMS", "אאוזינופיליה",
    "אבולה", "אבנים בדרכי השתן", "אבנים בכיס המרה", "אבעבועות הקוף", "אבעבועות שחורות", "אגורפוביה",
    "אדמת", "אדנומה", "אוורת בית החזה", "אוושה בלב", "כיב פפטי", "אוסטאופורוזיס", "אוסטאופניה",
    "אטקסיה", "אי ספיקת כבד", "אי ספיקת כליות", "אי ספיקת לב", "אי ספיקת לבלב", "אי פריון",
    "איבוד משקל", "איידס", "אין אונות", "אי-נקיטות לצואה", "אי-ספיקה נשימתית", "אירוע כלילי חד",
    "אירוע מוחי חולף", "אי-שליטה בהטלת צואה", "אכילה כפייתית", "אל ביוץ", "אל וסת",
    "אלבומין נמוך בדם", "אלכוהוליזם", "אלצהיימר", "אלרגיה", "אלרגיה למזון", "אלרגיה לתרופות",
    "אמנזיה", "אנגיואדמה", "אנגינה פקטוריס", "אנמיה אפלסטית", "אנמיה חרמשית",
    "אנמיה מגלובלסטית", "אנמיה שמקורה בחוסר ברזל", "אנפילקסיס", "אסתמה", "אספרגילוזיס",
    "אפילפסיה", "דום נשימה בשינה", "אקזמה", "אקנה", "אקרומגליה", "בולימיה", "בורסיטיס",
    "בחילות והקאות", "בית חזה קמור", "בלוטות לימפה נפוחות", "בקע", "בקע דיסק בין-חולייתי",
    "בקע טבורי", "בקע סרעפתי", "ברדיקרדיה", "ברונכיאקטזיס", "ברונכיוליטיס", "ברוצלוזיס",
    "בריחת צואה", "בריחת שתן", "ברקית", "גודש", "גוש בבלוטת התריס", "גזזת", "גזים",
    "גיל המעבר", "גינקומסטיה", "גלאוקומה", "גלי חום", "גליומה", "גמגום", "גסטריטיס",
    "דום לב", "דיזנטריה", "דיכאון אחרי לידה", "דיכאון קליני", "דימום ממערכת העיכול",
    "דיסטוניה", "דיסלקציה", "דיספגיה", "דיפתריה", "דליות", "דלקות מוח", "דלקת אוזניים",
    "דלקת בדרכי השתן", "דלקת בלבלב", "דלקת בלוטת התריס", "דלקת בנרתיק", "דלקת גביעי הכליה",
    "דלקת גידים", "דלקת הלחמית", "דלקת המעי הגס", "דלקת העור", "דלקת הערמונית", "דלקת הצפק",
    "דלקת ורידים", "דלקת חניכיים", "דלקת כבד", "דלקת לוע ושקדים", "דלקת מפרקים",
    "דלקת מפרקים ניוונית", "דלקת מפרקים שגרונית", "דלקת עור ממגע", "דלקת עינבייה",
    "דלקת פנים הלב", "דלקת צוואר הרחם", "דלקת ריאות", "דלקת רירית הרחם", "דלקת שד",
    "דלקת שריר הלב", "דם בצואה", "דם בשתן", "דמם", "דפיקות לב", "היפוגליקמיה", "היפונתרמיה",
    "היפוקסיה", "היפותרמיה", "היפרגליקמיה", "היפרדות רשתית",
  ];

  let hit = 0;
  const misses = [];
  INFOMED_SAMPLE.forEach(term => {
    const hits = search(term);
    if (hits.length > 0) hit++;
    else misses.push(term);
  });

  const pct = ((100 * hit) / INFOMED_SAMPLE.length).toFixed(1);
  console.log(`${BOLD}Real-world index sweep${RST} ${DIM}(Infomed.co.il, pages 1-4/14, ${INFOMED_SAMPLE.length} conditions)${RST}`);
  console.log(`  ${hit}/${INFOMED_SAMPLE.length} (${pct}%) found`);
  if (misses.length > 0) {
    console.log(`  ${DIM}Misses (info only — many are legitimately out of scope for a lab-test index):${RST}`);
    console.log(`  ${YEL}${misses.join(", ")}${RST}`);
  }
  console.log("");
})();

// ---------- report -----------------------------------------------------------
console.log("");
if (warnings.length) {
  console.log(`${YEL}${BOLD}⚠ ${warnings.length} warning(s):${RST}`);
  warnings.forEach(w => console.log(`  ${YEL}•${RST} ${w}`));
  console.log("");
}
if (errors.length) {
  console.log(`${RED}${BOLD}✗ ${errors.length} error(s):${RST}`);
  errors.forEach(e => console.log(`  ${RED}✗${RST} ${e}`));
  console.log("");
  console.log(`${RED}${BOLD}Validation FAILED${RST} — ${errors.length} error(s), ${warnings.length} warning(s).\n`);
  process.exit(1);
} else {
  console.log(`${GRN}${BOLD}✓ Validation passed${RST} — 0 errors, ${warnings.length} warning(s).\n`);
  process.exit(0);
}
