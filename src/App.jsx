import React, { useState, useMemo, useEffect } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";


const HAS_NATIVE_STORAGE = typeof window !== "undefined" && !!window.storage; // true בתוך Claude בלבד

/* ─── גשר אחסון דו־פלטפורמי ───
   בתוך Claude: window.storage קיים והבלוק מדולג לחלוטין.
   מחוץ ל-Claude (Firebase/דפדפן): נבנה תואם על גבי אחסון הדפדפן. */
if (typeof window !== "undefined" && !window.storage) {
  const mem = {};
  let ls = null;
  try { ls = window["local" + "Storage"]; } catch { /* חסום — ניפול לזיכרון */ }
  window.storage = {
    async get(k) { const v = ls ? ls.getItem(k) : (k in mem ? mem[k] : null); return v == null ? null : { key: k, value: v }; },
    async set(k, v) { if (ls) ls.setItem(k, v); else mem[k] = v; return { key: k, value: v }; },
    async delete(k) { if (ls) ls.removeItem(k); else delete mem[k]; return { key: k, deleted: true }; },
  };
}

/* ═══ KetoMe · v3.2.0 · עיצוב מינימליסטי ═══ */
const T = { paper: "#FBFBF9", ink: "#161613", muted: "#8B8A83", hair: "#E7E5DF", accent: "#0F6B5C", warn: "#B4552D", mid: "#C99A2E" };
const APP_VERSION = "1.3.1";

/* כתובת השרת מוגדרת פעם אחת כאן ע"י המפתח (Cloudflare Worker) — לא ע"י המשתמש.
   כשריקה: הרשמה/סנכרון ענן מנוטרלים, וניתוח AI עובד ישירות (בסביבת התצוגה). */
const SERVER_URL = "https://ketome.noodelan.workers.dev";

const fmt = (n) => (n == null || isNaN(n) ? "—" : Number.isInteger(+n) ? String(+n) : (+n).toFixed(1).replace(/\.0$/, ""));
const timeOf = (ts) => new Date(ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
const dateOf = (ts) => new Date(ts).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
const dayKey = (ts) => {
  const d = new Date(ts); // לפי אזור הזמן המקומי, לא UTC — אחרת בישראל "היום" הוא אתמול
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayStr = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
const todayKey = dayKey(Date.now());

const isMedPending = (m, today, nowHM) => m.takenOn !== today && (!m.time || m.time <= nowHM);

const gkiZone = (g) => g == null ? null : g < 1 ? { label: "קטוזיס תרפויטי", color: T.accent } : g <= 3 ? { label: "קטוזיס גבוה", color: T.accent } : g <= 6 ? { label: "קטוזיס בינוני", color: T.accent } : g <= 9 ? { label: "קטוזיס נמוך", color: T.warn } : { label: "מחוץ לקטוזיס", color: T.warn };
const ketoneZone = (k) => k == null ? null : k < 0.5 ? { label: "מחוץ לקטוזיס", color: T.warn } : k <= 1.5 ? { label: "קטוזיס קל", color: T.ink } : k <= 3 ? { label: "קטוזיס אופטימלי", color: T.accent } : { label: "קטונים גבוהים", color: T.warn };
const URIC_FACTOR = 59.48;
const uricZone = (u) => u == null ? null : u < 3.4 ? { label: "מתחת לטווח", color: T.warn } : u <= 7 ? { label: "בטווח", color: T.accent } : { label: "מעל הטווח", color: T.warn };
const parseUric = (raw) => { const v = parseFloat(raw); return isNaN(v) ? null : v > 25 ? v / URIC_FACTOR : v; };
const URINE_LEVELS = ["שלילי", "עקבות", "נמוך (1.5)", "בינוני (4)", "גבוה (8+)"];

/* מאגר מזון (ל-100 גר׳) · u=גרם ליחידה, un=שם יחידה */
const FOOD_DB = [
  { n: "ביצה קשה", c: 1.1, k: 155, p: 12.6, f: 10.6, u: 50, un: "ביצה" },
  { n: "ביצה שלמה (טרייה)", c: 0.6, k: 143, p: 12.5, f: 9.5, u: 60, un: "ביצה" },
  { n: "אבוקדו", c: 1.8, k: 160, p: 2, f: 14.7, u: 140, un: "יחידה" },
  { n: "גבינה צהובה 28%", c: 1.3, k: 350, p: 25, f: 28, u: 25, un: "פרוסה" },
  { n: "קוטג' 5%", c: 3.5, k: 100, p: 11, f: 5, u: 250, un: "גביע" },
  { n: "גבינה בולגרית 16%", c: 2, k: 210, p: 15, f: 16, u: 30, un: "קובייה" },
  { n: "שמנת מתוקה 38%", c: 3, k: 350, p: 2, f: 38, u: 15, un: "כף" },
  { n: "יוגורט יווני 5%", c: 4, k: 95, p: 9, f: 5, u: 150, un: "גביע" },
  { n: "חמאה", c: 0.1, k: 717, p: 0.9, f: 81, u: 10, un: "כפית" },
  { n: "שמן זית", c: 0, k: 884, p: 0, f: 100, u: 14, un: "כף" },
  { n: "טחינה גולמית", c: 10, k: 620, p: 22, f: 54, u: 15, un: "כף" },
  { n: "שקדים", c: 9, k: 579, p: 21, f: 50, u: 1.2, un: "שקד" },
  { n: "אגוזי מלך", c: 7, k: 654, p: 15, f: 65, u: 5, un: "אגוז" },
  { n: "זיתים ירוקים", c: 3.8, k: 145, p: 1, f: 15, u: 4, un: "זית" },
  { n: "חזה עוף (צלוי)", a: ["עוף"], c: 0, k: 165, p: 31, f: 3.6, u: 150, un: "מנה" },
  { n: "פרגית (צלויה)", c: 0, k: 210, p: 26, f: 11, u: 150, un: "מנה" },
  { n: "בשר בקר טחון 20%", c: 0, k: 254, p: 26, f: 17, u: 150, un: "מנה" },
  { n: "סלמון (אפוי)", c: 0, k: 208, p: 20, f: 13, u: 150, un: "מנה" },
  { n: "טונה בשמן (מסונן)", c: 0, k: 198, p: 29, f: 8, u: 120, un: "קופסה" },
  { n: "ברוקולי (מבושל)", c: 4, k: 35, p: 2.4, f: 0.4, u: 100, un: "כוס" },
  { n: "כרובית (מבושלת)", c: 2.8, k: 23, p: 1.8, f: 0.3, u: 100, un: "כוס" },
  { n: "קישוא", c: 2.7, k: 17, p: 1.2, f: 0.3, u: 130, un: "יחידה" },
  { n: "מלפפון", a: ["ירקות", "סלט"], c: 3.1, k: 15, p: 0.7, f: 0.1, u: 100, un: "יחידה" },
  { n: "עגבנייה", a: ["ירקות", "סלט"], c: 2.7, k: 18, p: 0.9, f: 0.2, u: 120, un: "יחידה" },
  { n: "חסה", a: ["עלי סלט", "סלט ירוק", "עלים"], c: 1.5, k: 15, p: 1.4, f: 0.2, u: 30, un: "כוס קצוצה" },
  { n: "עלי בייבי / מיקס עלים", a: ["עלי סלט", "עלים ירוקים", "סלט"], c: 2, k: 20, p: 2, f: 0.3, u: 30, un: "חופן" },
  { n: "רוקט (ארוגולה)", a: ["עלי סלט", "עלים"], c: 2.1, k: 25, p: 2.6, f: 0.7, u: 20, un: "חופן" },
  { n: "סלט ירקות קצוץ (מלפפון-עגבנייה)", a: ["סלט", "ירקות"], c: 3, k: 20, p: 0.9, f: 0.2, u: 150, un: "קערית" },
  { n: "פטריות שמפיניון", c: 2.3, k: 22, p: 3.1, f: 0.3, u: 20, un: "פטרייה" },
  { n: "פלפל אדום", c: 4.5, k: 31, p: 1, f: 0.3, u: 120, un: "יחידה" },
  { n: "שוקולד מריר 85%", c: 19, k: 590, p: 9, f: 46, u: 10, un: "קובייה" },
  { n: "קפה שחור", c: 0, k: 2, p: 0.1, f: 0, u: 240, un: "כוס" },
  { n: "סטייק אנטריקוט", a: ["בשר"], c: 0, k: 291, p: 24, f: 21, u: 250, un: "סטייק" },
  { n: "סטייק סינטה", a: ["בשר"], c: 0, k: 201, p: 29, f: 9, u: 250, un: "סטייק" },
  { n: "סטייק שייטל", c: 0, k: 190, p: 30, f: 7, u: 220, un: "סטייק" },
  { n: "המבורגר בקר (ללא לחמנייה)", c: 0, k: 260, p: 25, f: 18, u: 200, un: "קציצה" },
  { n: "כבד עוף (מוקפץ)", c: 1, k: 172, p: 26, f: 6.5, u: 100, un: "מנה" },
  { n: "שווארמה הודו (ללא פיתה)", c: 1, k: 210, p: 26, f: 12, u: 150, un: "מנה" },
  { n: "נקניקיות עוף", c: 2.5, k: 230, p: 13, f: 19, u: 50, un: "נקניקייה" },
  { n: "פסטרמה הודו", c: 1.5, k: 100, p: 18, f: 2.5, u: 20, un: "פרוסה" },
  { n: "סרדינים בשמן (מסונן)", a: ["דג"], c: 0, k: 208, p: 25, f: 11, u: 100, un: "קופסה" },
  { n: "אגוז ברזיל", c: 4.2, k: 659, p: 14, f: 67, u: 5, un: "אגוז" },
  { n: "כרע עוף (צלויה)", a: ["עוף"], c: 0, k: 232, p: 26, f: 13, u: 200, un: "כרע" },
  { n: "שוק עוף (צלויה)", a: ["עוף"], c: 0, k: 195, p: 27, f: 9, u: 100, un: "שוק" },
  { n: "כנפי עוף (אפויות)", a: ["עוף"], c: 0, k: 290, p: 27, f: 19, u: 35, un: "כנף" },
  { n: "קבב בקר", a: ["בשר"], c: 2, k: 280, p: 22, f: 20, u: 60, un: "קבב" },
  { n: "דג דניס (אפוי)", c: 0, k: 135, p: 21, f: 5, u: 200, un: "דג" },
  { n: "אמנון / מושט (אפוי)", c: 0, k: 128, p: 26, f: 2.6, u: 180, un: "פילה" },
  { n: "ביצת עין (בחמאה)", c: 0.4, k: 110, p: 6.5, f: 9, u: 55, un: "ביצה" },
  { n: "חביתה (2 ביצים בשמן)", c: 1, k: 220, p: 13, f: 18, u: 130, un: "חביתה" },
  { n: "טופו", c: 2, k: 76, p: 8, f: 4.8, u: 100, un: "מנה" },
  { n: "מוצרלה", c: 2.2, k: 280, p: 22, f: 20, u: 30, un: "מנה" },
  { n: "גבינת עמק / אמנטל", c: 1, k: 360, p: 26, f: 28, u: 25, un: "פרוסה" },
  { n: "לאבנה", c: 5, k: 180, p: 6, f: 16, u: 30, un: "כף גדושה" },
  { n: "שמנת חמוצה 27%", c: 3.5, k: 270, p: 2.5, f: 27, u: 30, un: "כף גדושה" },
  { n: "גבינת שמנת (נפוליאון)", c: 4, k: 250, p: 5, f: 24, u: 20, un: "כף" },
  { n: "מיונז", c: 1, k: 700, p: 1, f: 77, u: 15, un: "כף" },
  { n: "חרדל", c: 6, k: 66, p: 4, f: 3.5, u: 5, un: "כפית" },
  { n: "חמאת בוטנים (ללא סוכר)", c: 8, k: 600, p: 25, f: 50, u: 16, un: "כף" },
  { n: "אגוזי לוז", c: 7, k: 628, p: 15, f: 61, u: 1.5, un: "אגוז" },
  { n: "פקאן", c: 4, k: 691, p: 9, f: 72, u: 2, un: "חצי אגוז" },
  { n: "מקדמיה", c: 5, k: 718, p: 8, f: 76, u: 2.5, un: "אגוז" },
  { n: "קשיו (זהירות בקיטו)", c: 27, k: 553, p: 18, f: 44, u: 1.5, un: "אגוז" },
  { n: "גרעיני חמנייה קלופים", c: 11, k: 584, p: 21, f: 51, u: 15, un: "חופן" },
  { n: "גרעיני דלעת", c: 9, k: 559, p: 30, f: 49, u: 15, un: "חופן" },
  { n: "זרעי צ'יה", c: 8, k: 486, p: 17, f: 31, u: 12, un: "כף" },
  { n: "זרעי פשתן טחונים", c: 2, k: 534, p: 18, f: 42, u: 10, un: "כף" },
  { n: "קוקוס טחון", c: 7, k: 660, p: 7, f: 65, u: 10, un: "כף" },
  { n: "קמח שקדים", c: 9, k: 590, p: 21, f: 52, u: 25, un: "רבע כוס" },
  { n: "קמח קוקוס", c: 18, k: 400, p: 18, f: 15, u: 15, un: "כף גדושה" },
  { n: "אספרגוס (מבושל)", c: 2.1, k: 22, p: 2.4, f: 0.2, u: 15, un: "גבעול" },
  { n: "שעועית ירוקה (מבושלת)", c: 4.7, k: 35, p: 1.9, f: 0.3, u: 100, un: "כוס" },
  { n: "כרוב לבן (טרי)", c: 3.5, k: 25, p: 1.3, f: 0.1, u: 70, un: "כוס קצוץ" },
  { n: "תרד (מבושל)", c: 1.4, k: 23, p: 3, f: 0.4, u: 100, un: "כוס" },
  { n: "חציל (קלוי)", c: 6, k: 35, p: 1, f: 0.2, u: 80, un: "פרוסה עבה" },
  { n: "בצל ירוק", c: 4.7, k: 32, p: 1.8, f: 0.2, u: 15, un: "גבעול" },
  { n: "שום", c: 30, k: 149, p: 6.4, f: 0.5, u: 3, un: "שן" },
  { n: "לימון (מיץ)", c: 7, k: 22, p: 0.4, f: 0.2, u: 15, un: "כף" },
  { n: "תות שדה", c: 6, k: 32, p: 0.7, f: 0.3, u: 12, un: "תות" },
  { n: "פטל / אוכמניות", c: 5.5, k: 52, p: 1.2, f: 0.7, u: 60, un: "חופן" },
  { n: "קצפת מתוקה (זהירות)", c: 12, k: 260, p: 2, f: 22, u: 15, un: "כף" },
  { n: "משקה דיאט / זירו", c: 0, k: 1, p: 0, f: 0, u: 330, un: "פחית" },
  { n: "חומוס מוכן (להשוואה)", c: 14, k: 166, p: 8, f: 10, u: 30, un: "כף גדושה" },
  { n: "פיתה (להשוואה)", c: 55, k: 275, p: 9, f: 1.2, u: 60, un: "פיתה" },
  { n: "תפוח (להשוואה)", c: 14, k: 52, p: 0.3, f: 0.2, u: 180, un: "תפוח" },
  { n: "בננה (להשוואה)", c: 23, k: 89, p: 1.1, f: 0.3, u: 120, un: "בננה" },
];

/* חיפוש גמיש: כל מילות החיפוש חייבות להופיע בשם, בכל סדר */
const searchFood = (q) => {
  const toks = q.trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return FOOD_DB.slice(0, 8);
  const hay = (f) => f.n + " " + (f.a || []).join(" ");
  return FOOD_DB.filter((f) => toks.every((t) => hay(f).includes(t))).slice(0, 12);
};

const resizeImage = (file, maxDim = 1100, quality = 0.85) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(maxDim / Math.max(img.width, img.height), 1);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const ts = Math.min(220 / Math.max(img.width, img.height), 1);
      const tc = document.createElement("canvas");
      tc.width = Math.round(img.width * ts); tc.height = Math.round(img.height * ts);
      tc.getContext("2d").drawImage(img, 0, 0, tc.width, tc.height);
      resolve({ base64: c.toDataURL("image/jpeg", quality).split(",")[1], thumb: tc.toDataURL("image/jpeg", 0.7) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("קריאת התמונה נכשלה")); };
    img.src = url;
  });

const PHOTO_PROMPT = `אתה מנתח תזונה לדיאטה קטוגנית. זהה את המנה בתמונה והערך כמויות לפי גודל המנה הנראה.
החזר אך ורק JSON תקין, בלי Markdown:
{"name":"שם המנה בעברית","carbs":גרם פחמימות נטו,"cal":קלוריות,"protein":גרם חלבון,"fat":גרם שומן,"keto":true/false,"note":"משפט קצר בעברית"}
אם אין אוכל: {"error":"לא זוהתה מנת אוכל"}`;

const LOOKUP_PROMPT = (q) => `אתה מאגר ערכים תזונתיים. עבור המזון והכמות: "${q}"
החזר אך ורק JSON תקין, בלי Markdown:
{"name":"שם + כמות בעברית","carbs":גרם פחמימות נטו לכמות שצוינה,"cal":קלוריות,"protein":חלבון,"fat":שומן,"keto":true/false}
אם הכמות לא צוינה — הנח מנה ממוצעת. אם לא מזוהה מזון: {"error":"לא זוהה"}`;

async function claudeJSON(body) {
  if (!HAS_NATIVE_STORAGE) throw new Error("נדרש חיבור שרת — הגדירו SERVER_URL לפי README שלבים 1–2");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, ...body }),
  });
  if (!r.ok) throw new Error(`שגיאת שרת (${r.status})`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "שגיאת API");
  const text = (data.content || []).map((i) => i.text || "").join("\n");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function Ruler({ value, max, color, compact }) {
  const pct = Math.min(value / (max || 1), 1) * 100;
  const h = compact ? 18 : 26;
  return (
    <div style={{ marginTop: compact ? 10 : 20 }}>
      <div style={{ position: "relative", height: h }}>
        <div style={{ position: "absolute", top: h / 2 - 1, right: 0, left: 0, height: 1, background: T.hair }} />
        <div style={{ position: "absolute", top: h / 2 - 1, right: 0, width: `${pct}%`, height: 1, background: color, transition: "width .5s" }} />
        {Array.from({ length: 11 }, (_, i) => (
          <div key={i} style={{ position: "absolute", right: `${i * 10}%`, top: i % 5 === 0 ? 3 : 6, bottom: i % 5 === 0 ? 3 : 6, width: 1, background: i * 10 <= pct ? color : T.hair, transform: "translateX(50%)" }} />
        ))}
        <div style={{ position: "absolute", right: `${pct}%`, top: 1, width: 1.5, height: h - 2, background: color, transform: "translateX(50%)", transition: "right .5s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
        <span>0</span><span>{fmt(max)}</span>
      </div>
    </div>
  );
}

const Label = ({ children, style }) => <div style={{ fontSize: 11.5, letterSpacing: "0.05em", color: T.muted, fontWeight: 600, ...style }}>{children}</div>;
const Big = ({ children, color = T.ink, size = 38 }) => <span style={{ fontFamily: "'Frank Ruhl Libre', serif", fontWeight: 300, fontSize: size, lineHeight: 1, color, fontVariantNumeric: "tabular-nums" }}>{children}</span>;
const Metric = ({ label, value, unit, sub, color = T.ink }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 11, color: T.muted }}>{label}</div>
    <div style={{ fontSize: 16, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {value} <span style={{ fontSize: 11, fontWeight: 400, color: T.muted }}>{unit}</span>
    </div>
    {sub && <div style={{ fontSize: 11, color: T.muted, whiteSpace: "nowrap" }}>{sub}</div>}
  </div>
);
const chartTick = { fontSize: 10, fill: T.muted, fontFamily: "Assistant" };

/* מציג את השגיאה על המסך במקום מסך שחור — כדי שנוכל לאבחן מכל מכשיר */
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  render() {
    if (this.state.err) {
      return (
        <div dir="rtl" style={{ padding: 24, fontFamily: "sans-serif", background: "#FBFBF9", minHeight: "100vh", color: "#161613" }}>
          <h3 style={{ color: "#B4552D" }}>שגיאה בהרצת KetoMe {APP_VERSION}</h3>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, direction: "ltr", textAlign: "left" }}>
            {String(this.state.err && (this.state.err.message || this.state.err))}
          </pre>
          <p style={{ fontSize: 14 }}>צלמו את המסך הזה ושלחו — זה בדיוק מה שצריך כדי לתקן.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function KetoApp() {
  const [tab, setTab] = useState("status");

  /* פרופיל */
  const [profile, setProfile] = useState({ name: "", age: "30", height: "170", weight: "70", gender: "m", activity: "light", style: "standard", medical: "none" });
  const [carbLimit, setCarbLimit] = useState(50);
  const [calLimit, setCalLimit] = useState(2000);
  const [auth, setAuth] = useState(null); // {user, token}
  const [authForm, setAuthForm] = useState({ user: "", pass: "", email: "" });
  const [authMode, setAuthMode] = useState("login"); // "login" | "register" | "forgot-user" | "forgot-pass" | "reset-pass"
  const [forgotEmail, setForgotEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetNewPass, setResetNewPass] = useState("");
  const [attachEmailValue, setAttachEmailValue] = useState("");
  const [remember, setRemember] = useState(true);
  const [authMsg, setAuthMsg] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  /* תרופות קבועות + יומן חיישן ליברה */
  const [meds, setMeds] = useState([]);
  const [medForm, setMedForm] = useState({ name: "", time: "" });
  const [medOpen, setMedOpen] = useState(false);
  const [libreLogs, setLibreLogs] = useState([]);
  const [libreBusy, setLibreBusy] = useState(false);
  const [libreResult, setLibreResult] = useState(null);
  const [libreError, setLibreError] = useState(null);

  const [weights, setWeights] = useState([]);
  const [weightIn, setWeightIn] = useState("");

  const [meals, setMeals] = useState([]);
  const [measurements, setMeasurements] = useState([]);
  const [mealDate, setMealDate] = useState(todayKey);

  const [form, setForm] = useState({ name: "", carbs: "", cal: "", protein: "", fat: "" });
  const [adding, setAdding] = useState(false);
  const [formQty, setFormQty] = useState(1);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState(null);

  const [foodOpen, setFoodOpen] = useState(false);
  const [foodQuery, setFoodQuery] = useState("");
  const [selectedFood, setSelectedFood] = useState(null);
  const [byUnit, setByUnit] = useState(true);
  const [qty, setQty] = useState(1);
  const [gramsIn, setGramsIn] = useState("100");

  const [analyzing, setAnalyzing] = useState(false);
  const [photoStatus, setPhotoStatus] = useState(null);
  const [photoResult, setPhotoResult] = useState(null);
  const [photoError, setPhotoError] = useState(null);

  const [mForm, setMForm] = useState({ ketones: "", glucose: "", uric: "", urine: "", note: "" });
  const [mOpen, setMOpen] = useState(false);

  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  /* ─ טעינה אוטומטית מהאחסון המקומי בפתיחה (כולל "זכור אותי") ─ */
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("ketome-data");
        if (r?.value) {
          const d = JSON.parse(r.value);
          if (d.profile) setProfile(d.profile);
          if (d.carbLimit) setCarbLimit(d.carbLimit);
          if (d.calLimit) setCalLimit(d.calLimit);
          if (d.meals) setMeals(d.meals);
          if (d.measurements) setMeasurements(d.measurements);
          if (d.weights) setWeights(d.weights);
          if (d.meds) setMeds(d.meds);
          if (d.libreLogs) setLibreLogs(d.libreLogs);
        }
      } catch { /* אין נתונים שמורים עדיין */ }
      try {
        const a = await window.storage.get("ketome-auth");
        if (a?.value) setAuth(JSON.parse(a.value));
      } catch { /* לא מחובר */ }
      setLoaded(true);
    })();
  }, []);

  /* ─ שמירה אוטומטית מקומית על כל שינוי ─ */
  useEffect(() => {
    if (!loaded) return;
    const id = setTimeout(() => {
      window.storage
        .set("ketome-data", JSON.stringify({
          profile, carbLimit, calLimit, weights, measurements, meds, libreLogs,
          meals: meals.map(({ thumb, ...m }) => m),
        }))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(id);
  }, [loaded, profile, carbLimit, calLimit, weights, measurements, meals, meds, libreLogs]);

  /* ─ גיבוי אוטומטי לענן — אם מחוברים, כל שינוי מגובה ברקע (לא רק בלחיצה על הכפתור) ─ */
  useEffect(() => {
    if (!loaded || !auth || !SERVER_URL) return;
    const id = setTimeout(() => {
      fetch(SERVER_URL.replace(/\/$/, "") + "/data/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: auth.token, data: appData() }),
      }).catch(() => {}); // כשל שקט — הגיבוי הידני עדיין זמין כגיבוי
    }, 2000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, auth, profile, carbLimit, calLimit, weights, measurements, meals, meds, libreLogs]);

  /* ─ נגזרות ─ */
  const todayMeals = useMemo(() => meals.filter((m) => dayKey(m.ts) === todayKey), [meals]);
  const totals = useMemo(() => todayMeals.reduce((s, m) => ({ carbs: s.carbs + m.carbs, cal: s.cal + (m.cal || 0), protein: s.protein + (m.protein || 0), fat: s.fat + (m.fat || 0) }), { carbs: 0, cal: 0, protein: 0, fat: 0 }), [todayMeals]);
  const left = carbLimit - totals.carbs;
  const over = left < 0;
  const statusColor = over ? T.warn : T.accent;
  const calOver = totals.cal > calLimit;

  const lastK = measurements.find((m) => m.ketones != null);
  const lastG = measurements.find((m) => m.glucose != null);
  const lastU = measurements.find((m) => m.uric != null);
  const gki = lastK && lastG ? lastG.glucose / 18 / lastK.ketones : null;
  const gz = gkiZone(gki), kz = ketoneZone(lastK?.ketones), uz = uricZone(lastU?.uric);

  const dailyCarbsMap = useMemo(() => {
    const m = {};
    meals.forEach((x) => { const d = dayKey(x.ts); m[d] = (m[d] || 0) + x.carbs; });
    return m;
  }, [meals]);

  /* לוח 28 ימים אחרונים */
  const calendar = useMemo(() => {
    const days = [];
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const start = new Date(now); start.setDate(now.getDate() - 27);
    start.setDate(start.getDate() - start.getDay()); // יישור לתחילת שבוע (א׳)
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d.getTime());
      days.push({ key, label: `${d.getDate()}/${d.getMonth() + 1}`, dow: d.getDay(), grams: dailyCarbsMap[key] });
    }
    return days;
  }, [dailyCarbsMap]);

  const dayColor = (g) => {
    if (g == null) return { bg: "transparent", bd: T.hair };
    if (g <= carbLimit - 20) return { bg: T.accent, bd: T.accent };
    if (g <= carbLimit) return { bg: "#7FA894", bd: "#7FA894" };
    if (g <= carbLimit + 20) return { bg: T.mid, bd: T.mid };
    return { bg: T.warn, bd: T.warn };
  };

  const streaks = useMemo(() => {
    let streak = 0;
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for (; ;) {
      const g = dailyCarbsMap[dayKey(d.getTime())];
      if (g != null && g <= carbLimit) { streak++; d.setDate(d.getDate() - 1); } else break;
    }
    let in30 = 0;
    const e = new Date(); e.setHours(12, 0, 0, 0);
    for (let i = 0; i < 30; i++) { const g = dailyCarbsMap[dayKey(e.getTime())]; if (g != null && g <= carbLimit) in30++; e.setDate(e.getDate() - 1); }
    const vals = Object.values(dailyCarbsMap);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { streak, in30, avg };
  }, [dailyCarbsMap, carbLimit]);

  const ketoneSeries = useMemo(() => [...measurements].reverse().filter((m) => m.ketones != null).map((m) => ({ t: `${dateOf(m.ts)} ${timeOf(m.ts)}`, v: m.ketones })), [measurements]);
  const glucoseSeries = useMemo(() => [...measurements].reverse().filter((m) => m.glucose != null).map((m) => ({ t: `${dateOf(m.ts)} ${timeOf(m.ts)}`, v: m.glucose })), [measurements]);
  const dailyCarbsSeries = useMemo(() => Object.entries(dailyCarbsMap).sort().map(([d, v]) => ({ t: d.slice(5), v: +v.toFixed(1) })), [dailyCarbsMap]);
  const weightSeries = useMemo(() => [...weights].sort((a, b) => a.ts - b.ts).map((w) => ({ t: dateOf(w.ts), v: w.kg })), [weights]);

  /* ─ יעדים אוטומטיים (Mifflin-St Jeor) ─ */
  const calcGoals = () => {
    const w = parseFloat(profile.weight), h = parseFloat(profile.height), a = parseFloat(profile.age);
    if (isNaN(w) || isNaN(h) || isNaN(a)) return;
    const bmr = 10 * w + 6.25 * h - 5 * a + (profile.gender === "m" ? 5 : -161);
    const mult = { sit: 1.2, light: 1.375, mid: 1.55, high: 1.725, hard: 1.9 }[profile.activity];
    let cal = Math.round(bmr * mult / 10) * 10;
    /* ברירת מחדל: ירידה מתונה */
    cal = Math.round(cal * 0.85 / 10) * 10;
    let carbs = { liberal: 75, standard: 35, aggressive: 20 }[profile.style];
    if (profile.medical !== "none") carbs = Math.min(carbs, 20);
    setCalLimit(cal);
    setCarbLimit(carbs);
  };

  const mealTs = () => {
    const d = new Date(mealDate + "T00:00:00");
    if (dayKey(d.getTime()) === todayKey) return Date.now();
    const now = new Date();
    d.setHours(now.getHours(), now.getMinutes());
    return d.getTime();
  };

  /* ─ ניתוח תמונה ─ */
  const analyzePhoto = async (file) => {
    setPhotoError(null); setPhotoResult(null); setAnalyzing(true);
    const ts = mealTs();
    try {
      setPhotoStatus("מקטין את התמונה…");
      const { base64, thumb } = await resizeImage(file);
      setPhotoStatus("שולח לניתוח…");
      let parsed;
      if (SERVER_URL) {
        const r = await fetch(SERVER_URL.replace(/\/$/, "") + "/image", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: base64 }),
        });
        if (!r.ok) throw new Error(`שגיאת שרת (${r.status})`);
        parsed = await r.json();
      } else {
        parsed = await claudeJSON({
          messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } }, { type: "text", text: PHOTO_PROMPT }] }],
        });
      }
      if (parsed.error) throw new Error(parsed.error);
      setPhotoResult({ data: parsed, thumb, ts });
    } catch (e) {
      setPhotoError(`הניתוח נכשל: ${e.message}. אפשר להזין מהמאגר או ידנית.`);
    } finally { setAnalyzing(false); setPhotoStatus(null); }
  };

  const acceptPhoto = () => {
    const p = photoResult.data;
    setMeals([...meals, { id: Date.now(), ts: photoResult.ts, name: p.name, carbs: +p.carbs || 0, cal: +p.cal || 0, protein: +p.protein || 0, fat: +p.fat || 0, keto: p.keto, thumb: photoResult.thumb }]);
    setPhotoResult(null);
  };

  /* ─ שליפת ערכים בטקסט (AI / שרת) ─ */
  const lookupFood = async (q) => {
    const query = (typeof q === "string" ? q : form.name).trim();
    if (!query) return;
    setLookupBusy(true); setLookupErr(null);
    try {
      let parsed;
      if (SERVER_URL) {
        const r = await fetch(SERVER_URL.replace(/\/$/, "") + "/lookup", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }),
        });
        if (!r.ok) throw new Error(`שגיאת שרת (${r.status})`);
        parsed = await r.json();
      } else {
        parsed = await claudeJSON({ messages: [{ role: "user", content: LOOKUP_PROMPT(query) }] });
      }
      if (parsed.error) throw new Error(parsed.error);
      setFormQty(1);
      setForm({ name: parsed.name || query, carbs: String(parsed.carbs ?? ""), cal: String(parsed.cal ?? ""), protein: String(parsed.protein ?? ""), fat: String(parsed.fat ?? "") });
    } catch (e) { setLookupErr(`השליפה נכשלה: ${e.message}`); }
    finally { setLookupBusy(false); }
  };

  const addMeal = () => {
    const c = parseFloat(form.carbs);
    if (!form.name.trim() || isNaN(c)) return;
    const q = Math.max(1, formQty);
    setMeals([...meals, {
      id: Date.now(), ts: mealTs(),
      name: form.name.trim() + (q > 1 ? ` × ${q}` : ""),
      carbs: +(c * q).toFixed(1),
      cal: Math.round((parseFloat(form.cal) || 0) * q),
      protein: +(((parseFloat(form.protein) || 0)) * q).toFixed(1),
      fat: +(((parseFloat(form.fat) || 0)) * q).toFixed(1),
    }]);
    setForm({ name: "", carbs: "", cal: "", protein: "", fat: "" });
    setFormQty(1);
    setAdding(false);
  };

  const pickFood = (f) => { setSelectedFood(f); setByUnit(true); setQty(1); setGramsIn(String(f.u || 100)); };
  const foodTotalG = () => selectedFood ? (byUnit ? qty * (selectedFood.u || 100) : parseFloat(gramsIn) || 0) : 0;
  const addFromDB = () => {
    const g = foodTotalG(); if (!g) return;
    const r = g / 100, f = selectedFood, ts = mealTs();
    setMeals([...meals, {
      id: Date.now(), ts,
      name: byUnit ? `${f.n} × ${qty} ${f.un}` : `${f.n} (${fmt(g)} גר׳)`,
      carbs: +(f.c * r).toFixed(1), cal: Math.round(f.k * r), protein: +(f.p * r).toFixed(1), fat: +(f.f * r).toFixed(1),
    }]);
    setSelectedFood(null); setFoodQuery(""); setFoodOpen(false);
  };

  const addMeasurement = () => {
    const k = parseFloat(mForm.ketones), g = parseFloat(mForm.glucose), u = parseUric(mForm.uric);
    if (isNaN(k) && isNaN(g) && u == null && !mForm.urine) return;
    const ts = Date.now();
    setMeasurements([{ id: ts, ts, ketones: isNaN(k) ? null : k, glucose: isNaN(g) ? null : g, uric: u, urine: mForm.urine || null, note: mForm.note.trim() || null }, ...measurements]);
    setMForm({ ketones: "", glucose: "", uric: "", urine: "", note: "" });
    setMOpen(false);
  };

  const saveWeight = () => {
    const kg = parseFloat(weightIn); if (isNaN(kg)) return;
    setWeights([...weights, { ts: Date.now(), kg }]);
    setProfile({ ...profile, weight: String(kg) });
    setWeightIn("");
  };

  /* ─ דוח יומי ─ */
  const buildReport = () => {
    const L = [];
    L.push("📋 דוח יומי — KetoMe");
    L.push(new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
    L.push("");
    L.push(`🥑 פחמימות: ${fmt(totals.carbs)} / ${carbLimit} גר׳ ${over ? "⚠️ חריגה" : "✅ ביעד"}`);
    L.push(`🔥 קלוריות: ${fmt(totals.cal)} / ${calLimit}`);
    L.push(`חלבון ${fmt(totals.protein)} גר׳ · שומן ${fmt(totals.fat)} גר׳`);
    if (streaks.streak > 0) L.push(`רצף ימים ביעד: ${streaks.streak}`);
    L.push("");
    L.push(`🍽 ארוחות (${todayMeals.length}):`);
    if (todayMeals.length === 0) L.push("• לא נרשמו ארוחות");
    todayMeals.forEach((m) => L.push(`• ${timeOf(m.ts)} ${m.name} — ${fmt(m.carbs)} פחמ׳, ${fmt(m.cal)} קל׳`));
    const todayMs = measurements.filter((m) => dayKey(m.ts) === todayKey);
    if (todayMs.length) {
      L.push("");
      L.push("🩸 מדידות היום:");
      [...todayMs].reverse().forEach((m) => {
        const p = [];
        if (m.ketones != null) p.push(`קטונים ${fmt(m.ketones)} mmol/L`);
        if (m.glucose != null) p.push(`גלוקוז ${fmt(m.glucose)} mg/dL (${fmt(m.glucose / 18)} mmol)`);
        if (m.uric != null) p.push(`ח. אורית ${fmt(m.uric)} mg/dL`);
        if (m.urine) p.push(`שתן: ${m.urine}`);
        L.push(`• ${timeOf(m.ts)} — ${p.join(" · ")}`);
      });
    }
    if (gki != null) { L.push(""); L.push(`GKI: ${fmt(gki)} — ${gz.label}`); }
    return L.join("\n");
  };

  const copyReport = async () => {
    const text = buildReport();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback לדפדפנים חוסמים */
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }
  };

  const shareWhatsApp = () => {
    window.open("https://wa.me/?text=" + encodeURIComponent(buildReport()), "_blank");
  };

  /* ─ חשבון אישי: הרשמה / התחברות / סנכרון ענן / שחזור ─ */
  const api = (path, payload) =>
    fetch(SERVER_URL.replace(/\/$/, "") + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || `שגיאה (${r.status})`);
      return d;
    });

  const appData = () => ({ profile, carbLimit, calLimit, weights, measurements, meds, libreLogs, meals: meals.map(({ thumb, ...m }) => m) });

  /* מיזוג במקום דריסה: כל רשומה (לפי id, או ts כשאין id) משתי הרשימות נשמרת —
     כך התחברות ממכשיר אחר לעולם לא "מוחקת" נתונים שנוספו במכשיר הזה ולא הספיקו להתגבות */
  const mergeByKey = (localArr, cloudArr, keyFn) => {
    const map = new Map();
    (cloudArr || []).forEach((item) => map.set(keyFn(item), item));
    (localArr || []).forEach((item) => map.set(keyFn(item), item)); // המקומי גובר בהתנגשות מפתח
    return [...map.values()].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  };

  const applyData = (d) => {
    /* הגדרות סקלריות (פרופיל/יעדים): רק אם עדיין לא נטענו נתונים מקומיים משמעותיים */
    const looksEmpty = meals.length === 0 && measurements.length === 0 && weights.length === 0 && meds.length === 0;
    if (looksEmpty) {
      if (d.profile) setProfile(d.profile);
      if (d.carbLimit) setCarbLimit(d.carbLimit);
      if (d.calLimit) setCalLimit(d.calLimit);
    }
    if (d.meals) setMeals((prev) => mergeByKey(prev.map(({ thumb, ...m }) => m), d.meals, (m) => m.id));
    if (d.measurements) setMeasurements((prev) => mergeByKey(prev, d.measurements, (m) => m.id));
    if (d.weights) setWeights((prev) => mergeByKey(prev, d.weights, (w) => w.ts));
    if (d.meds) setMeds((prev) => mergeByKey(prev, d.meds, (m) => m.id));
    if (d.libreLogs) setLibreLogs((prev) => mergeByKey(prev, d.libreLogs, (l) => l.ts));
  };

  const doAuth = async (mode) => {
    setAuthMsg(null);
    if (!SERVER_URL) { setAuthMsg("בסביבת תצוגה זו אין שרת מחובר — הנתונים נשמרים במכשיר בלבד. בגרסה המלאה החיבור פועל אוטומטית."); return; }
    if (authForm.user.trim().length < 2 || authForm.pass.length < 4) { setAuthMsg("שם משתמש (2+ תווים) וסיסמה (4+ תווים)"); return; }
    if (mode === "register" && (!authForm.email.trim() || !authForm.email.includes("@"))) { setAuthMsg("כתובת אימייל תקינה נדרשת"); return; }
    setAuthBusy(true);
    try {
      const payload = { user: authForm.user.trim(), pass: authForm.pass };
      if (mode === "register") payload.email = authForm.email.trim();
      const d = await api(mode === "register" ? "/auth/register" : "/auth/login", payload);
      const a = { user: d.user, token: d.token };
      setAuth(a);
      if (remember) await window.storage.set("ketome-auth", JSON.stringify(a)).catch(() => {});
      if (mode === "login") {
        try { const cloud = await api("/data/load", { token: d.token }); applyData(cloud); setAuthMsg("✓ מחובר — הנתונים נטענו מהענן"); }
        catch { setAuthMsg("✓ מחובר"); }
      } else {
        await api("/data/save", { token: d.token, data: appData() }).catch(() => {});
        setAuthMsg("✓ נרשמת והנתונים הנוכחיים גובו לענן");
      }
      setAuthForm({ user: "", pass: "", email: "" });
      setAuthMode("login");
    } catch (e) { setAuthMsg(e.message); }
    finally { setAuthBusy(false); }
  };

  const cloudSave = async () => {
    setAuthMsg(null); setAuthBusy(true);
    try { await api("/data/save", { token: auth.token, data: appData() }); setAuthMsg("✓ גובה לענן"); }
    catch (e) { setAuthMsg(e.message); }
    finally { setAuthBusy(false); }
  };
  const cloudLoad = async () => {
    setAuthMsg(null); setAuthBusy(true);
    try { const d = await api("/data/load", { token: auth.token }); applyData(d); setAuthMsg("✓ נטען מהענן"); }
    catch (e) { setAuthMsg(e.message); }
    finally { setAuthBusy(false); }
  };
  const logout = async () => {
    setAuth(null); setAuthMsg(null);
    await window.storage.delete("ketome-auth").catch(() => {});
  };

  const doForgotUsername = async () => {
    setAuthMsg(null);
    if (!forgotEmail.trim()) { setAuthMsg("יש להזין כתובת אימייל"); return; }
    setAuthBusy(true);
    try {
      await api("/auth/forgot-username", { email: forgotEmail.trim() });
      setAuthMsg("✓ אם הכתובת רשומה במערכת, שם המשתמש נשלח אליה");
      setAuthMode("login");
    } catch (e) { setAuthMsg(e.message); }
    finally { setAuthBusy(false); }
  };

  const doForgotPassword = async () => {
    setAuthMsg(null);
    if (!forgotEmail.trim()) { setAuthMsg("יש להזין כתובת אימייל"); return; }
    setAuthBusy(true);
    try {
      await api("/auth/forgot-password", { email: forgotEmail.trim() });
      setAuthMsg("✓ אם הכתובת רשומה במערכת, נשלח קוד איפוס — בדוק/י את תיבת הדואר");
      setAuthMode("reset-pass");
    } catch (e) { setAuthMsg(e.message); }
    finally { setAuthBusy(false); }
  };

  const doResetPassword = async () => {
    setAuthMsg(null);
    if (!forgotEmail.trim() || !resetCode.trim() || resetNewPass.length < 4) { setAuthMsg("נדרשים אימייל, קוד וסיסמה חדשה (4+ תווים)"); return; }
    setAuthBusy(true);
    try {
      await api("/auth/reset-password", { email: forgotEmail.trim(), code: resetCode.trim(), newPass: resetNewPass });
      setAuthMsg("✓ הסיסמה אופסה — אפשר להתחבר עכשיו");
      setAuthMode("login");
      setResetCode(""); setResetNewPass(""); setForgotEmail("");
    } catch (e) { setAuthMsg(e.message); }
    finally { setAuthBusy(false); }
  };

  const attachEmail = async () => {
    setAuthMsg(null);
    if (!attachEmailValue.trim() || !attachEmailValue.includes("@")) { setAuthMsg("כתובת אימייל תקינה נדרשת"); return; }
    setAuthBusy(true);
    try {
      await api("/auth/set-email", { token: auth.token, email: attachEmailValue.trim() });
      setAuthMsg("✓ האימייל צורף לחשבון");
      setAttachEmailValue("");
    } catch (e) { setAuthMsg(e.message); }
    finally { setAuthBusy(false); }
  };

  /* ─ תרופות: ממתינות להיום ─ */
  const nowHM = new Date().toTimeString().slice(0, 5);
  const pendingMeds = meds.filter((m) => isMedPending(m, todayKey, nowHM));

  const addMedication = () => {
    setMeds([...meds, { id: Date.now(), name: medForm.name.trim(), time: medForm.time || "", takenOn: null }]);
    setMedForm({ name: "", time: "" });
    setMedOpen(false);
  };
  const toggleMed = (id) => setMeds(meds.map((m) => m.id === id ? { ...m, takenOn: m.takenOn === todayKey ? null : todayKey } : m));

  /* ─ ניתוח צילום מסך של חיישן ליברה ─ */
  const LIBRE_PROMPT = `בתמונה צילום מסך מאפליקציית חיישן סוכר רציף (FreeStyle Libre או דומה).
חלץ והחזר אך ורק JSON תקין, בלי Markdown:
{"glucose_now":מספר mg/dL נוכחי,"trend":"עולה"/"יורד"/"יציב","period":"טווח השעות המוצג","pattern":"2-3 משפטים בעברית: מהלך הגרף, עליות/ירידות בולטות והשעות שלהן","in_range":true/false}
אם זו לא תמונת חיישן: {"error":"לא זוהה צילום חיישן"}`;

  const analyzeLibre = async (file) => {
    setLibreError(null); setLibreResult(null); setLibreBusy(true);
    const ts = Date.now();
    try {
      const { base64, thumb } = await resizeImage(file);
      let parsed;
      if (SERVER_URL) {
        const r = await fetch(SERVER_URL.replace(/\/$/, "") + "/libre", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64, token: auth?.token || null }),
        });
        if (!r.ok) throw new Error(`שגיאת שרת (${r.status})`);
        parsed = await r.json();
      } else {
        parsed = await claudeJSON({
          messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } }, { type: "text", text: LIBRE_PROMPT }] }],
        });
      }
      if (parsed.error) throw new Error(parsed.error);
      setLibreResult({ data: parsed, thumb, ts });
    } catch (e) { setLibreError(`הניתוח נכשל: ${e.message}`); }
    finally { setLibreBusy(false); }
  };

  const acceptLibre = () => {
    const d = libreResult.data;
    if (d.glucose_now) {
      setMeasurements([{ id: libreResult.ts, ts: libreResult.ts, ketones: null, glucose: +d.glucose_now, uric: null, urine: null, note: `ליברה · מגמה ${d.trend || "?"} · ${d.pattern || ""}` }, ...measurements]);
    }
    setLibreLogs([{ ts: libreResult.ts, ...d }, ...libreLogs].slice(0, 60));
    setLibreResult(null);
  };

  const runInsights = async () => {
    setInsightLoading(true);
    try {
      const summary = {
        פרופיל: profile, יעד_פחמימות: carbLimit, יעד_קלוריות: calLimit,
        רצף_ימים_ביעד: streaks.streak, ממוצע_פחמימות_יומי: streaks.avg,
        ארוחות_אחרונות: meals.slice(-15).map((m) => ({ תאריך: dateOf(m.ts), שעה: timeOf(m.ts), שם: m.name, פחמימות: m.carbs })),
        מדידות: measurements.slice(0, 15).map((m) => ({ תאריך: dateOf(m.ts), שעה: timeOf(m.ts), קטונים: m.ketones, גלוקוז: m.glucose, חומצה_אורית: m.uric })),
        משקלים: weights.map((w) => ({ תאריך: dateOf(w.ts), קג: w.kg })), GKI: gki ? +gki.toFixed(1) : null,
        חיישן_ליברה: libreLogs.slice(0, 10).map((l) => ({ תאריך: dateOf(l.ts), שעה: timeOf(l.ts), גלוקוז: l.glucose_now, מגמה: l.trend, דפוס: l.pattern })),
        תרופות_שלא_סומנו_היום: pendingMeds.length,
      };
      const parsed = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6", max_tokens: 1000,
          messages: [{ role: "user", content: `אתה יועץ לדיאטה קטוגנית. נתונים: ${JSON.stringify(summary)}\n\nכתוב בעברית ניתוח (עד 200 מילים), 2–4 פסקאות בלי כותרות. חשוב במיוחד: הצלב בין זמני הארוחות לבין דפוסי הגלוקוז מהחיישן — אם אחרי ארוחה מסוימת (לפי שעה) נראית עלייה בגלוקוז, ציין את הקשר במפורש. זהה דפוסים חוזרים בין ימים, מה עובד ומה לשפר. אם חסר מידע להצלבה — אמור מה לתעד. סיים במשפט שזה אינו ייעוץ רפואי.` }],
        }),
      }).then((r) => r.json());
      setInsight((parsed.content || []).map((i) => i.text || "").join("\n").trim());
    } catch { setInsight("הפקת התובנות נכשלה, נסו שוב"); }
    finally { setInsightLoading(false); }
  };

  const input = (extra) => ({ width: "100%", border: "none", borderBottom: `1px solid ${T.hair}`, background: "transparent", padding: "10px 0", fontSize: 16, fontFamily: "'Assistant', sans-serif", color: T.ink, outline: "none", ...extra });
  const pill = (active) => ({ border: `1px solid ${active ? T.ink : T.hair}`, background: active ? T.ink : "transparent", color: active ? T.paper : T.ink, borderRadius: 999, padding: "7px 14px", fontSize: 13, cursor: "pointer" });
  const btn = { background: T.ink, color: T.paper, border: "none", borderRadius: 999, padding: "10px 22px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
  const btnGhost = { ...btn, background: "transparent", color: T.ink, border: `1px solid ${T.ink}` };
  const stepBtn = { width: 38, height: 38, border: `1px solid ${T.ink}`, background: "transparent", borderRadius: 999, fontSize: 18, cursor: "pointer", color: T.ink };
  const fileOverlay = { position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" };

  return (
    <div dir="rtl" style={{ minHeight: "100vh", maxWidth: 520, margin: "0 auto", background: T.paper, color: T.ink, fontFamily: "'Assistant', sans-serif", display: "flex", flexDirection: "column", borderInline: `1px solid ${T.hair}` }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@300;400;500&family=Assistant:wght@400;600;700&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        html, body { margin: 0; background: #F1F0EC; }
        input:focus { border-bottom-color: ${T.ink} !important; }
        button { font-family: 'Assistant', sans-serif; }
        @keyframes pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
        @keyframes blinkRed { 0%,100% { color: #B4552D; opacity: 1 } 50% { opacity: .25 } }
        .med-alert { animation: blinkRed 1.1s infinite; font-weight: 700; }
        @media (hover: hover) and (pointer: fine) {
          .navbtn { font-size: 16px !important; padding: 19px 0 21px !important; }
        }
      `}</style>

      <header style={{ padding: "22px 24px 0", maxWidth: 480, width: "100%", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: "'Frank Ruhl Libre', serif", fontSize: 20 }}>KetoMe{profile.name.trim() ? ` · שלום, ${profile.name.trim()}` : ""}{pendingMeds.length > 0 && <span className="med-alert" style={{ fontSize: 12, fontFamily: "'Assistant', sans-serif", marginRight: 8 }}>● תרופה ממתינה</span>}{auth && <span style={{ fontSize: 12, color: T.accent, fontFamily: "'Assistant', sans-serif", marginRight: 8 }}>✓ {auth.user}</span>}{!auth && <button onClick={() => setTab("profile")} style={{ fontSize: 12, fontFamily: "'Assistant', sans-serif", marginRight: 8, background: "none", border: `1px solid ${T.hair}`, borderRadius: 999, padding: "3px 10px", color: T.muted, cursor: "pointer" }}>כניסה</button>}</div>
          <Label>{todayStr}</Label>
        </div>
        <div style={{ height: 1, background: T.ink, marginTop: 10 }} />
      </header>

      <main style={{ flex: 1, maxWidth: 480, width: "100%", margin: "0 auto", padding: "0 24px 40px" }}>

        {/* ═══ סטטוס ═══ */}
        {tab === "status" && (
          <>
            <section style={{ paddingTop: 26 }}>
              <Label>{over ? "חריגה מהיעד היומי" : "נותרו להיום"}</Label>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
                <Big color={statusColor} size={62}>{fmt(Math.abs(left))}</Big>
                <span style={{ fontSize: 15, color: T.muted }}>גר׳ פחמימות</span>
              </div>
              <Ruler value={Math.max(left, 0)} max={carbLimit} color={statusColor} />
              <div style={{ fontSize: 12.5, color: T.muted, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                נצרכו {fmt(totals.carbs)} מתוך {carbLimit} גר׳
              </div>
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <Label>קלוריות</Label>
                  <span style={{ color: calOver ? T.warn : T.ink, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{fmt(totals.cal)} <span style={{ fontWeight: 400, color: T.muted }}>/ {calLimit}</span></span>
                </div>
                <Ruler compact value={totals.cal} max={calLimit} color={calOver ? T.warn : T.ink} />
              </div>
              <div style={{ display: "flex", gap: 20, marginTop: 14, fontSize: 13, fontVariantNumeric: "tabular-nums", flexWrap: "wrap" }}>
                <span><b>{fmt(totals.protein)}</b> <span style={{ color: T.muted }}>חלבון</span></span>
                <span><b>{fmt(totals.fat)}</b> <span style={{ color: T.muted }}>שומן</span></span>
                <span>🔥 <b>{streaks.streak}</b> <span style={{ color: T.muted }}>ימים ביעד ברצף</span></span>
                {gki != null && <span>GKI <b style={{ color: gz.color }}>{fmt(gki)}</b></span>}
              </div>

              {/* דוח יומי — בולט וזמין */}
              <div style={{ marginTop: 20 }}>
                <button style={{ ...btn, width: "100%", padding: "12px 0" }} onClick={() => setReportOpen(!reportOpen)}>
                  📤 דוח יומי — שיתוף והעתקה
                </button>
                {reportOpen && (
                  <div style={{ marginTop: 12, borderTop: `1px solid ${T.ink}`, paddingTop: 12 }}>
                    <pre style={{ margin: 0, fontFamily: "'Assistant', sans-serif", fontSize: 13.5, lineHeight: 1.8, whiteSpace: "pre-wrap", color: T.ink }}>{buildReport()}</pre>
                    <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                      <button style={{ ...btnGhost, flex: 1, padding: "10px 0" }} onClick={copyReport}>{copied ? "✓ הועתק" : "📋 העתקה"}</button>
                      <button style={{ ...btn, flex: 1, padding: "10px 0", background: "#1FAF57" }} onClick={shareWhatsApp}>שליחה בוואטסאפ</button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section style={{ marginTop: 28 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Label>ארוחות היום · {todayMeals.length}</Label>
                <button style={{ ...btnGhost, padding: "6px 16px", fontSize: 13 }} onClick={() => setTab("meal")}>+ הוספת ארוחה</button>
              </div>
              {todayMeals.length === 0 && <div style={{ marginTop: 14, fontSize: 14, color: T.muted }}>עוד לא נרשמו ארוחות היום.</div>}
              {todayMeals.map((m) => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${T.hair}` }}>
                  {m.thumb ? <img src={m.thumb} alt="" style={{ width: 44, height: 44, objectFit: "cover", border: `1px solid ${T.hair}`, flexShrink: 0 }} /> :
                    <div style={{ width: 44, height: 44, border: `1px solid ${T.hair}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: T.muted, flexShrink: 0 }}>רישום</div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}{m.keto === false && <span style={{ fontSize: 11, color: T.warn, marginRight: 6 }}>· לא קיטו</span>}</div>
                    <div style={{ fontSize: 12, color: T.muted, fontVariantNumeric: "tabular-nums" }}>{timeOf(m.ts)}</div>
                  </div>
                  <div style={{ textAlign: "left", flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(m.carbs)} <span style={{ fontWeight: 400, color: T.muted, fontSize: 12 }}>גר׳</span></div>
                    <div style={{ fontSize: 12, color: T.muted }}>{fmt(m.cal)} קל׳</div>
                  </div>
                  <button onClick={() => setMeals(meals.filter((x) => x.id !== m.id))} style={{ background: "transparent", border: "none", color: T.muted, cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
                </div>
              ))}
            </section>
          </>
        )}

        {/* ═══ ארוחה ═══ */}
        {tab === "meal" && (
          <>
            <section style={{ paddingTop: 26 }}>
              <Label>תאריך הארוחה</Label>
              <input type="date" value={mealDate} max={todayKey} onChange={(e) => setMealDate(e.target.value)} style={input({ marginTop: 4, maxWidth: 200 })} />
            </section>

            <section style={{ marginTop: 24 }}>
              <Label>סריקת ארוחה עם AI</Label>
              {!SERVER_URL && !HAS_NATIVE_STORAGE && (
                <div style={{ marginTop: 8, fontSize: 13, color: T.warn, lineHeight: 1.7 }}>
                  פיצ׳רי ה־AI (סריקה, שליפת ערכים, ליברה) יופעלו אחרי חיבור השרת — README שלבים 1–2.
                  המאגר וההזנה הידנית עובדים כרגיל.
                </div>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <span style={{ ...btn, display: "block", textAlign: "center", opacity: analyzing ? 0.5 : 1 }}>📷 מצלמה</span>
                  <input type="file" accept="image/*" capture="environment" disabled={analyzing} style={fileOverlay}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) analyzePhoto(f); e.target.value = ""; }} />
                </div>
                <div style={{ position: "relative", flex: 1 }}>
                  <span style={{ ...btnGhost, display: "block", textAlign: "center", opacity: analyzing ? 0.5 : 1 }}>🖼 גלריה</span>
                  <input type="file" accept="image/*" disabled={analyzing} style={fileOverlay}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) analyzePhoto(f); e.target.value = ""; }} />
                </div>
              </div>
              {photoStatus && <div style={{ marginTop: 12, fontSize: 14, color: T.muted, animation: "pulse 1.4s infinite" }}>{photoStatus}</div>}
              {photoError && <div style={{ marginTop: 12, fontSize: 14, color: T.warn, lineHeight: 1.6 }}>{photoError}</div>}
              {photoResult && (
                <div style={{ marginTop: 14, padding: "14px 0", borderTop: `1px solid ${T.ink}`, borderBottom: `1px solid ${T.hair}` }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <img src={photoResult.thumb} alt="" style={{ width: 60, height: 60, objectFit: "cover", border: `1px solid ${T.hair}` }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <b style={{ fontSize: 15.5 }}>{photoResult.data.name}</b>
                        <span style={{ fontSize: 11.5, color: T.muted, whiteSpace: "nowrap" }}>צולם {timeOf(photoResult.ts)}</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: photoResult.data.keto ? T.accent : T.warn }}>{photoResult.data.keto ? "מתאים לקיטו" : "לא מתאים לקיטו"}</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginTop: 10 }}>
                    <Metric label="פחמימות" value={fmt(+photoResult.data.carbs)} unit="גר׳" />
                    <Metric label="קלוריות" value={fmt(+photoResult.data.cal)} unit="קל׳" />
                    <Metric label="חלבון" value={fmt(+photoResult.data.protein)} unit="גר׳" />
                    <Metric label="שומן" value={fmt(+photoResult.data.fat)} unit="גר׳" />
                  </div>
                  {photoResult.data.note && <p style={{ margin: "8px 0 0", fontSize: 13, color: T.muted }}>{photoResult.data.note}</p>}
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button style={{ ...btn, padding: "8px 20px" }} onClick={acceptPhoto}>הוסף לארוחה</button>
                    <button style={{ background: "none", border: "none", color: T.muted, fontSize: 14, cursor: "pointer" }} onClick={() => setPhotoResult(null)}>ביטול</button>
                  </div>
                </div>
              )}
            </section>

            <section style={{ marginTop: 26 }}>
              <div style={{ display: "flex", gap: 10 }}>
                <button style={foodOpen ? btn : btnGhost} onClick={() => { setFoodOpen(!foodOpen); setAdding(false); }}>🔎 מהמאגר</button>
                <button style={adding ? btn : btnGhost} onClick={() => { setAdding(!adding); setFoodOpen(false); }}>✎ ידני / AI</button>
              </div>

              {foodOpen && (
                <div style={{ marginTop: 14 }}>
                  <input autoFocus placeholder="חיפוש מזון…" value={foodQuery} onChange={(e) => { setFoodQuery(e.target.value); setSelectedFood(null); }} style={input()} />
                  {!selectedFood && searchFood(foodQuery).map((f) => (
                    <button key={f.n} onClick={() => pickFood(f)} style={{ display: "flex", width: "100%", justifyContent: "space-between", gap: 8, padding: "10px 0", background: "none", border: "none", borderBottom: `1px solid ${T.hair}`, cursor: "pointer", textAlign: "right" }}>
                      <span style={{ fontSize: 14.5, color: T.ink }}>{f.n}</span>
                      <span style={{ fontSize: 12, color: T.muted, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmt(f.c)} פחמ׳ / 100 גר׳</span>
                    </button>
                  ))}
                  {!selectedFood && foodQuery.trim() && searchFood(foodQuery).length === 0 && (
                    <div style={{ padding: "12px 0" }}>
                      <div style={{ fontSize: 13.5, color: T.muted }}>"{foodQuery}" לא נמצא במאגר המקומי.</div>
                      <button style={{ ...btnGhost, marginTop: 10, padding: "7px 16px", fontSize: 13 }}
                        onClick={() => { const q = foodQuery; setFoodOpen(false); setAdding(true); setForm({ name: q, carbs: "", cal: "", protein: "", fat: "" }); lookupFood(q); }}>
                        ✳ שליפה עם AI: "{foodQuery}"
                      </button>
                    </div>
                  )}
                  {selectedFood && (() => {
                    const g = foodTotalG(), r = g / 100, f = selectedFood;
                    return (
                      <div style={{ marginTop: 10, paddingBottom: 14, borderBottom: `1px solid ${T.hair}` }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{f.n}</div>
                        <div style={{ fontSize: 12.5, color: T.muted, marginTop: 2 }}>{fmt(f.c)} גר׳ פחמימות ל־100 גר׳</div>
                        <Label style={{ marginTop: 14, marginBottom: 8 }}>יחידת הגשה</Label>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button style={pill(byUnit)} onClick={() => setByUnit(true)}>{f.un} ({f.u} גר׳)</button>
                          <button style={pill(!byUnit)} onClick={() => setByUnit(false)}>גרמים</button>
                        </div>
                        {byUnit ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
                            <Label>כמות</Label>
                            <button style={stepBtn} onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
                            <Big size={30}>{qty}</Big>
                            <button style={stepBtn} onClick={() => setQty(qty + 1)}>+</button>
                            <span style={{ fontSize: 13, color: T.muted, fontVariantNumeric: "tabular-nums" }}>= {fmt(g)} גר׳</span>
                          </div>
                        ) : (
                          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
                            <input inputMode="decimal" value={gramsIn} onChange={(e) => setGramsIn(e.target.value)} style={input({ width: 90 })} />
                            <span style={{ fontSize: 13, color: T.muted }}>גרם</span>
                          </div>
                        )}
                        <div style={{ marginTop: 14, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                          פחמימות לארוחה: <Big size={26} color={T.accent}>{fmt(f.c * r)}</Big> <span style={{ fontSize: 12, color: T.muted }}>גר׳</span>
                          <span style={{ fontSize: 12.5, color: T.muted, marginRight: 12 }}>{fmt(Math.round(f.k * r))} קל׳ · {fmt(f.p * r)} חלבון · {fmt(f.f * r)} שומן</span>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                          <button style={{ ...btn, padding: "8px 20px" }} onClick={addFromDB}>+ הוסף לארוחה</button>
                          <button style={{ background: "none", border: "none", color: T.muted, fontSize: 14, cursor: "pointer" }} onClick={() => setSelectedFood(null)}>חזרה</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {adding && (
                <div style={{ marginTop: 14, paddingBottom: 16, borderBottom: `1px solid ${T.hair}` }}>
                  <input autoFocus placeholder="מה אכלת? (למשל: 2 פרוסות גבינה צהובה)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={input()} />
                  <button style={{ ...btnGhost, marginTop: 10, padding: "7px 16px", fontSize: 13 }} onClick={lookupFood} disabled={lookupBusy}>
                    {lookupBusy ? "שולף ערכים…" : "✳ שליפת ערכים אוטומטית"}
                  </button>
                  {lookupErr && <div style={{ marginTop: 8, fontSize: 13, color: T.warn }}>{lookupErr}</div>}
                  <div style={{ display: "flex", gap: 16 }}>
                    <input placeholder="פחמימות (גר׳)" inputMode="decimal" value={form.carbs} onChange={(e) => setForm({ ...form, carbs: e.target.value })} style={input()} />
                    <input placeholder="קלוריות" inputMode="decimal" value={form.cal} onChange={(e) => setForm({ ...form, cal: e.target.value })} style={input()} />
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <input placeholder="חלבון (גר׳)" inputMode="decimal" value={form.protein} onChange={(e) => setForm({ ...form, protein: e.target.value })} style={input()} />
                    <input placeholder="שומן (גר׳)" inputMode="decimal" value={form.fat} onChange={(e) => setForm({ ...form, fat: e.target.value })} style={input()} />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 14 }}>
                    <Label>כמות</Label>
                    <button style={stepBtn} onClick={() => setFormQty(Math.max(1, formQty - 1))}>−</button>
                    <Big size={26}>{formQty}</Big>
                    <button style={stepBtn} onClick={() => setFormQty(formQty + 1)}>+</button>
                    {formQty > 1 && (
                      <span style={{ fontSize: 13, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                        = {fmt((parseFloat(form.carbs) || 0) * formQty)} פחמ׳ · {fmt(Math.round((parseFloat(form.cal) || 0) * formQty))} קל׳
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button style={{ ...btn, padding: "8px 20px" }} onClick={addMeal}>שמירה</button>
                    <button style={{ background: "none", border: "none", color: T.muted, fontSize: 14, cursor: "pointer" }} onClick={() => setAdding(false)}>ביטול</button>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 12, fontSize: 12, color: T.muted }}>
                למתכונים מורכבים: <a href="http://www.capit.co.il/recipe-calculator" target="_blank" rel="noreferrer" style={{ color: T.accent }}>מחשבון כפית ↗</a>
              </div>
            </section>
          </>
        )}

        {/* ═══ מדידות ═══ */}
        {tab === "measure" && (
          <>
            <section style={{ paddingTop: 26 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px 16px" }}>
                <div><Label>קטונים בדם</Label>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}><Big color={kz ? kz.color : T.ink}>{fmt(lastK?.ketones)}</Big><span style={{ fontSize: 12, color: T.muted }}>mmol/L</span></div>
                  {kz && <div style={{ fontSize: 12, color: kz.color, marginTop: 4 }}>{kz.label}</div>}
                </div>
                <div><Label>גלוקוז</Label>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}><Big>{fmt(lastG?.glucose)}</Big><span style={{ fontSize: 12, color: T.muted }}>mg/dL</span></div>
                  {lastG && <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>= {fmt(lastG.glucose / 18)} mmol/L</div>}
                </div>
                <div><Label>חומצה אורית</Label>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}><Big color={uz ? uz.color : T.ink}>{fmt(lastU?.uric)}</Big><span style={{ fontSize: 12, color: T.muted }}>mg/dL</span></div>
                  {lastU && <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>= {fmt(lastU.uric * URIC_FACTOR)} µmol/L</div>}
                  <div style={{ fontSize: 11, color: uz ? uz.color : T.muted, marginTop: 2 }}>{uz ? `${uz.label} · ` : ""}נורמה 3.4–7 (200–420 µmol)</div>
                </div>
                <div><Label>GKI</Label>
                  <div style={{ marginTop: 4 }}><Big color={gz ? gz.color : T.ink}>{fmt(gki)}</Big></div>
                  {gz && <div style={{ fontSize: 12, color: gz.color, marginTop: 4 }}>{gz.label}</div>}
                </div>
              </div>
            </section>

            <section style={{ marginTop: 26 }}>
              {!mOpen ? <button style={btnGhost} onClick={() => setMOpen(true)}>+ מדידה חדשה</button> : (
                <div style={{ paddingBottom: 16, borderBottom: `1px solid ${T.hair}` }}>
                  <div style={{ display: "flex", gap: 16 }}>
                    <input placeholder="קטונים דם (mmol/L)" inputMode="decimal" value={mForm.ketones} onChange={(e) => setMForm({ ...mForm, ketones: e.target.value })} style={input()} />
                    <input placeholder="גלוקוז (mg/dL)" inputMode="decimal" value={mForm.glucose} onChange={(e) => setMForm({ ...mForm, glucose: e.target.value })} style={input()} />
                  </div>
                  <input placeholder="חומצה אורית — mg/dL או µmol/L" inputMode="decimal" value={mForm.uric} onChange={(e) => setMForm({ ...mForm, uric: e.target.value })} style={input()} />
                  {parseUric(mForm.uric) != null && parseFloat(mForm.uric) > 25 && <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>זוהה כ־µmol/L → {fmt(parseUric(mForm.uric))} mg/dL</div>}
                  <div style={{ marginTop: 14 }}>
                    <Label style={{ marginBottom: 8 }}>סטיק שתן (אופציונלי)</Label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {URINE_LEVELS.map((u) => <button key={u} style={pill(mForm.urine === u)} onClick={() => setMForm({ ...mForm, urine: mForm.urine === u ? "" : u })}>{u}</button>)}
                    </div>
                  </div>
                  <input placeholder="הערה" value={mForm.note} onChange={(e) => setMForm({ ...mForm, note: e.target.value })} style={input({ marginTop: 6 })} />
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button style={{ ...btn, padding: "8px 20px" }} onClick={addMeasurement}>שמירה עכשיו</button>
                    <button style={{ background: "none", border: "none", color: T.muted, fontSize: 14, cursor: "pointer" }} onClick={() => setMOpen(false)}>ביטול</button>
                  </div>
                </div>
              )}
            </section>


            <section style={{ marginTop: 22 }}>
              <Label>חיישן ליברה (סוכר רציף)</Label>
              <div style={{ position: "relative", display: "inline-block", marginTop: 10 }}>
                <span style={{ ...btnGhost, display: "inline-block", opacity: libreBusy ? 0.5 : 1 }}>📈 העלאת צילום מסך מהחיישן</span>
                <input type="file" accept="image/*" disabled={libreBusy} style={fileOverlay}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) analyzeLibre(f); e.target.value = ""; }} />
              </div>
              {libreBusy && <div style={{ marginTop: 10, fontSize: 14, color: T.muted, animation: "pulse 1.4s infinite" }}>מנתח את הגרף…</div>}
              {libreError && <div style={{ marginTop: 10, fontSize: 14, color: T.warn }}>{libreError}</div>}
              {libreResult && (
                <div style={{ marginTop: 14, padding: "14px 0", borderTop: `1px solid ${T.ink}`, borderBottom: `1px solid ${T.hair}` }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <img src={libreResult.thumb} alt="" style={{ width: 60, height: 60, objectFit: "cover", border: `1px solid ${T.hair}` }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <Big size={30}>{fmt(+libreResult.data.glucose_now)}</Big>
                        <span style={{ fontSize: 12, color: T.muted }}>mg/dL · מגמה {libreResult.data.trend}</span>
                      </div>
                      <div style={{ fontSize: 12, color: libreResult.data.in_range ? T.accent : T.warn, marginTop: 2 }}>
                        {libreResult.data.in_range ? "בטווח" : "מחוץ לטווח"} · {libreResult.data.period}
                      </div>
                    </div>
                  </div>
                  {libreResult.data.pattern && <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.7 }}>{libreResult.data.pattern}</p>}
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button style={{ ...btn, padding: "8px 20px" }} onClick={acceptLibre}>שמירה ליומן</button>
                    <button style={{ background: "none", border: "none", color: T.muted, fontSize: 14, cursor: "pointer" }} onClick={() => setLibreResult(null)}>ביטול</button>
                  </div>
                </div>
              )}
              {libreLogs.length > 0 && !libreResult && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: T.muted }}>
                  {libreLogs.length} ניתוחי חיישן שמורים — נכללים בהצלבת התובנות מול הארוחות.
                </div>
              )}
            </section>

            <section style={{ marginTop: 26 }}>
              <Label>יומן מדידות · {measurements.length}</Label>
              {measurements.map((m) => (
                <div key={m.id} style={{ padding: "13px 0", borderBottom: `1px solid ${T.hair}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{dateOf(m.ts)} · {timeOf(m.ts)}</b>
                    <button onClick={() => setMeasurements(measurements.filter((x) => x.id !== m.id))} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 12px", marginTop: 8 }}>
                    {m.ketones != null && <Metric label="קטונים בדם" value={fmt(m.ketones)} unit="mmol/L" color={ketoneZone(m.ketones).color} sub={ketoneZone(m.ketones).label} />}
                    {m.glucose != null && <Metric label="גלוקוז" value={fmt(m.glucose)} unit="mg/dL" sub={`= ${fmt(m.glucose / 18)} mmol/L`} />}
                    {m.uric != null && <Metric label="חומצה אורית" value={fmt(m.uric)} unit="mg/dL" color={uricZone(m.uric).color} sub={`= ${fmt(m.uric * URIC_FACTOR)} µmol/L`} />}
                    {m.urine && <Metric label="סטיק שתן" value={m.urine} unit="" />}
                  </div>
                  {m.note && <div style={{ fontSize: 12.5, color: T.muted, marginTop: 6 }}>{m.note}</div>}
                </div>
              ))}
            </section>
          </>
        )}


        {/* ═══ תרופות ═══ */}
        {tab === "meds" && (
          <section style={{ paddingTop: 26 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Label>תרופות קבועות — סימון יומי</Label>
              {!medOpen && <button style={{ ...btnGhost, padding: "6px 16px", fontSize: 13 }} onClick={() => setMedOpen(true)}>+ הוספה</button>}
            </div>

            {medOpen && (
              <div style={{ marginTop: 14, paddingBottom: 16, borderBottom: `1px solid ${T.hair}` }}>
                <input autoFocus placeholder="שם התרופה (אופציונלי — ריק = הסט הקבוע)" value={medForm.name}
                  onChange={(e) => setMedForm({ ...medForm, name: e.target.value })} style={input()} />
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
                  <span style={{ fontSize: 13, color: T.muted }}>שעת תזכורת (אופציונלי)</span>
                  <input type="time" value={medForm.time} onChange={(e) => setMedForm({ ...medForm, time: e.target.value })} style={input({ maxWidth: 130 })} />
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                  <button style={{ ...btn, padding: "8px 20px" }} onClick={addMedication}>שמירה</button>
                  <button style={{ background: "none", border: "none", color: T.muted, fontSize: 14, cursor: "pointer" }} onClick={() => setMedOpen(false)}>ביטול</button>
                </div>
              </div>
            )}

            {meds.length === 0 && !medOpen && (
              <div style={{ marginTop: 16, fontSize: 14, color: T.muted, lineHeight: 1.8 }}>
                אפשר להוסיף תרופה בשם מלא עם שעת תזכורת, או פריט כללי בלי שם ("הסט הקבוע") למי שמעדיף
                בלי פירוט. עד לסימון היומי — האפליקציה תציג התראה מהבהבת בכניסה.
              </div>
            )}

            {meds.map((m) => {
              const taken = m.takenOn === todayKey;
              const pending = isMedPending(m, todayKey, nowHM);
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 0", borderBottom: `1px solid ${T.hair}` }}>
                  <button onClick={() => toggleMed(m.id)} aria-label="סימון נטילה"
                    style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${taken ? T.accent : pending ? T.warn : T.ink}`, background: taken ? T.accent : "transparent", color: T.paper, fontSize: 17, cursor: "pointer", flexShrink: 0 }}>
                    {taken ? "✓" : ""}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={pending ? "med-alert" : ""} style={{ fontSize: 15, color: taken ? T.muted : T.ink }}>
                      {m.name || "הסט הקבוע (ללא פירוט)"}
                    </div>
                    <div style={{ fontSize: 12, color: T.muted, fontVariantNumeric: "tabular-nums" }}>
                      {m.time ? `תזכורת יומית ${m.time}` : "תזכורת יומית — כל היום"}{taken ? " · נלקח היום ✓" : pending ? " · ממתין!" : ""}
                    </div>
                  </div>
                  <button onClick={() => setMeds(meds.filter((x) => x.id !== m.id))} style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 16, padding: 0 }}>×</button>
                </div>
              );
            })}

            <div style={{ marginTop: 18, fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
              הסימון מתאפס אוטומטית כל יום. ההתראה המהבהבת מופיעה בכותרת ובלשונית עד שכל התרופות של היום מסומנות.
            </div>
          </section>
        )}

        {/* ═══ היסטוריה ═══ */}
        {tab === "history" && (
          <>
            <section style={{ paddingTop: 26 }}>
              <Label>לוח 28 ימים — פחמימות מול היעד</Label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, marginTop: 14 }}>
                {["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map((d) => <div key={d} style={{ textAlign: "center", fontSize: 10.5, color: T.muted }}>{d}</div>)}
                {calendar.map((d) => {
                  const c = dayColor(d.grams);
                  const filled = d.grams != null;
                  return (
                    <div key={d.key} title={filled ? `${d.label}: ${fmt(d.grams)} גר׳` : d.label}
                      style={{ aspectRatio: "1", border: `1px solid ${c.bd}`, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: filled ? T.paper : T.muted, fontVariantNumeric: "tabular-nums" }}>
                      {d.label}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginTop: 10, fontSize: 11, color: T.muted }}>
                <span><span style={{ display: "inline-block", width: 9, height: 9, border: `1px solid ${T.hair}`, verticalAlign: "middle", marginLeft: 4 }} />אין נתון</span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, background: T.accent, verticalAlign: "middle", marginLeft: 4 }} />מצוין (מתחת ליעד −20)</span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, background: "#7FA894", verticalAlign: "middle", marginLeft: 4 }} />ביעד</span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, background: T.mid, verticalAlign: "middle", marginLeft: 4 }} />קרוב ליעד (עד +20)</span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, background: T.warn, verticalAlign: "middle", marginLeft: 4 }} />מעל היעד</span>
              </div>
            </section>

            <section style={{ marginTop: 26, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div style={{ borderTop: `1px solid ${T.ink}`, paddingTop: 10 }}><Big size={30}>{streaks.streak}</Big><div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>ימים ביעד ברצף 🔥</div></div>
              <div style={{ borderTop: `1px solid ${T.ink}`, paddingTop: 10 }}><Big size={30}>{streaks.in30}</Big><div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>ימים ביעד מתוך 30</div></div>
              <div style={{ borderTop: `1px solid ${T.ink}`, paddingTop: 10 }}><Big size={30}>{fmt(streaks.avg)}</Big><div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>ממוצע פח׳ יומי</div></div>
            </section>

            {ketoneSeries.length >= 2 && (
              <section style={{ marginTop: 30 }}>
                <Label>קטונים בדם (mmol/L)</Label>
                <div style={{ height: 160, marginTop: 10, direction: "ltr" }}>
                  <ResponsiveContainer><LineChart data={ketoneSeries} margin={{ top: 8, left: -20, right: 8 }}>
                    <XAxis dataKey="t" tick={chartTick} tickLine={false} axisLine={{ stroke: T.hair }} />
                    <YAxis tick={chartTick} tickLine={false} axisLine={false} domain={[0, "auto"]} />
                    <Tooltip contentStyle={{ fontFamily: "Assistant", fontSize: 12, direction: "rtl" }} />
                    <ReferenceLine y={1.5} stroke={T.accent} strokeDasharray="4 4" /><ReferenceLine y={3} stroke={T.accent} strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="v" stroke={T.ink} strokeWidth={1.5} dot={{ r: 3, fill: T.ink }} name="קטונים" />
                  </LineChart></ResponsiveContainer>
                </div>
              </section>
            )}
            {glucoseSeries.length >= 2 && (
              <section style={{ marginTop: 26 }}>
                <Label>גלוקוז (mg/dL)</Label>
                <div style={{ height: 160, marginTop: 10, direction: "ltr" }}>
                  <ResponsiveContainer><LineChart data={glucoseSeries} margin={{ top: 8, left: -20, right: 8 }}>
                    <XAxis dataKey="t" tick={chartTick} tickLine={false} axisLine={{ stroke: T.hair }} />
                    <YAxis tick={chartTick} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ fontFamily: "Assistant", fontSize: 12, direction: "rtl" }} />
                    <Line type="monotone" dataKey="v" stroke={T.accent} strokeWidth={1.5} dot={{ r: 3, fill: T.accent }} name="גלוקוז" />
                  </LineChart></ResponsiveContainer>
                </div>
              </section>
            )}
            {dailyCarbsSeries.length >= 1 && (
              <section style={{ marginTop: 26 }}>
                <Label>פחמימות יומיות (גר׳)</Label>
                <div style={{ height: 160, marginTop: 10, direction: "ltr" }}>
                  <ResponsiveContainer><BarChart data={dailyCarbsSeries} margin={{ top: 8, left: -20, right: 8 }}>
                    <XAxis dataKey="t" tick={chartTick} tickLine={false} axisLine={{ stroke: T.hair }} />
                    <YAxis tick={chartTick} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ fontFamily: "Assistant", fontSize: 12, direction: "rtl" }} />
                    <ReferenceLine y={carbLimit} stroke={T.warn} strokeDasharray="4 4" />
                    <Bar dataKey="v" fill={T.accent} maxBarSize={28} name="פחמימות" />
                  </BarChart></ResponsiveContainer>
                </div>
              </section>
            )}
            {weightSeries.length >= 2 && (
              <section style={{ marginTop: 26 }}>
                <Label>משקל (ק"ג)</Label>
                <div style={{ height: 160, marginTop: 10, direction: "ltr" }}>
                  <ResponsiveContainer><LineChart data={weightSeries} margin={{ top: 8, left: -20, right: 8 }}>
                    <XAxis dataKey="t" tick={chartTick} tickLine={false} axisLine={{ stroke: T.hair }} />
                    <YAxis tick={chartTick} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
                    <Tooltip contentStyle={{ fontFamily: "Assistant", fontSize: 12, direction: "rtl" }} />
                    <Line type="monotone" dataKey="v" stroke={T.ink} strokeWidth={1.5} dot={{ r: 3, fill: T.ink }} name="משקל" />
                  </LineChart></ResponsiveContainer>
                </div>
              </section>
            )}

            <section style={{ marginTop: 30 }}>
              <button style={btn} onClick={runInsights} disabled={insightLoading}>{insightLoading ? "מנתח…" : "✳ הפקת תובנות AI"}</button>
              {insight && <div style={{ marginTop: 18, borderTop: `1px solid ${T.ink}`, paddingTop: 14 }}><p style={{ margin: 0, fontSize: 15, lineHeight: 1.9, whiteSpace: "pre-line" }}>{insight}</p></div>}
            </section>
          </>
        )}

        {/* ═══ פרטים ═══ */}
        {tab === "profile" && (
          <>
            <section style={{ paddingTop: 26 }}>
              <Label>חלק 1 · פרטים בסיסיים</Label>
              <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
                <input placeholder="שם (אופציונלי)" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} style={input()} />
                <input placeholder="גיל" inputMode="numeric" value={profile.age} onChange={(e) => setProfile({ ...profile, age: e.target.value })} style={input({ maxWidth: 80 })} />
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <input placeholder='גובה (ס"מ)' inputMode="decimal" value={profile.height} onChange={(e) => setProfile({ ...profile, height: e.target.value })} style={input()} />
                <input placeholder='משקל (ק"ג)' inputMode="decimal" value={profile.weight} onChange={(e) => setProfile({ ...profile, weight: e.target.value })} style={input()} />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                <button style={pill(profile.gender === "m")} onClick={() => setProfile({ ...profile, gender: "m" })}>זכר</button>
                <button style={pill(profile.gender === "f")} onClick={() => setProfile({ ...profile, gender: "f" })}>נקבה</button>
              </div>
            </section>

            <section style={{ marginTop: 28 }}>
              <Label>חלק 2 · אורח חיים</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {[["sit", "ישיבה"], ["light", "קלה 1–2/שבוע"], ["mid", "בינונית 3–5"], ["high", "אינטנסיבית 6–7"], ["hard", "עבודה פיזית"]].map(([v, l]) => (
                  <button key={v} style={pill(profile.activity === v)} onClick={() => setProfile({ ...profile, activity: v })}>{l}</button>
                ))}
              </div>
            </section>

            <section style={{ marginTop: 28 }}>
              <Label>חלק 3 · סגנון קיטו</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {[["liberal", "שפוי (50–100 גר׳)"], ["standard", "סטנדרטי (20–50)"], ["aggressive", "אגרסיבי (עד 20)"]].map(([v, l]) => (
                  <button key={v} style={pill(profile.style === v)} onClick={() => setProfile({ ...profile, style: v })}>{l}</button>
                ))}
              </div>
            </section>

            <section style={{ marginTop: 28 }}>
              <Label>חלק 4 · מצב רפואי (אופציונלי)</Label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {[["none", "אין"], ["t2d", "סוכרת סוג 2"], ["epilepsy", "אפילפסיה"]].map(([v, l]) => (
                  <button key={v} style={pill(profile.medical === v)} onClick={() => setProfile({ ...profile, medical: v })}>{l}</button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 8 }}>מצב רפואי מוריד את תקרת הפחמימות ל־20 גר׳. חשוב ללוות מצב כזה עם רופא/ה.</div>
            </section>

            <section style={{ marginTop: 28 }}>
              <Label>יעדים יומיים</Label>
              <button style={{ ...btnGhost, marginTop: 10, padding: "8px 18px", fontSize: 13.5 }} onClick={calcGoals}>✨ חשב המלצות אוטומטית</button>
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: T.muted }}>יעד פחמימות (גר׳)</div>
                  <input inputMode="decimal" value={carbLimit} onChange={(e) => setCarbLimit(parseFloat(e.target.value) || 0)} style={input({ fontSize: 20, fontFamily: "'Frank Ruhl Libre', serif" })} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: T.muted }}>יעד קלוריות</div>
                  <input inputMode="decimal" value={calLimit} onChange={(e) => setCalLimit(parseFloat(e.target.value) || 0)} style={input({ fontSize: 20, fontFamily: "'Frank Ruhl Libre', serif" })} />
                </div>
              </div>
            </section>

            <section style={{ marginTop: 28 }}>
              <Label>רישום משקל</Label>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
                <input placeholder='משקל (ק"ג)' inputMode="decimal" value={weightIn} onChange={(e) => setWeightIn(e.target.value)} style={input({ maxWidth: 120 })} />
                <button style={{ ...btn, padding: "8px 18px", fontSize: 13.5 }} onClick={saveWeight}>שמור משקל</button>
              </div>
              {weights.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {[...weights].reverse().slice(0, 5).map((w) => (
                    <div key={w.ts} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.hair}`, fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
                      <span style={{ color: T.muted }}>{dateOf(w.ts)} · {timeOf(w.ts)}</span><b>{fmt(w.kg)} ק"ג</b>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ marginTop: 28 }}>
              <Label>חשבון אישי</Label>
              {!auth ? (
                <div style={{ marginTop: 6 }}>
                  {authMode === "login" && (
                    <>
                      <input placeholder="שם משתמש" autoComplete="username" value={authForm.user}
                        onChange={(e) => setAuthForm({ ...authForm, user: e.target.value })} style={input()} />
                      <input placeholder="סיסמה" type="password" autoComplete="current-password" value={authForm.pass}
                        onChange={(e) => setAuthForm({ ...authForm, pass: e.target.value })} style={input()} />
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13.5, cursor: "pointer" }}>
                        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: T.ink }} />
                        זכור אותי במכשיר הזה
                      </label>
                      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                        <button style={{ ...btn, flex: 1, padding: "10px 0" }} disabled={authBusy} onClick={() => doAuth("login")}>התחברות</button>
                        <button style={{ ...btnGhost, flex: 1, padding: "10px 0" }} disabled={authBusy} onClick={() => setAuthMode("register")}>הרשמה</button>
                      </div>
                      <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 12.5 }}>
                        <button style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 0, textDecoration: "underline" }} onClick={() => { setAuthMode("forgot-user"); setAuthMsg(null); }}>שכחתי שם משתמש</button>
                        <button style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", padding: 0, textDecoration: "underline" }} onClick={() => { setAuthMode("forgot-pass"); setAuthMsg(null); }}>שכחתי סיסמה</button>
                      </div>
                    </>
                  )}

                  {authMode === "register" && (
                    <>
                      <input placeholder="שם משתמש" autoComplete="username" value={authForm.user}
                        onChange={(e) => setAuthForm({ ...authForm, user: e.target.value })} style={input()} />
                      <input placeholder="אימייל" type="email" autoComplete="email" value={authForm.email}
                        onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} style={input()} />
                      <input placeholder="סיסמה" type="password" autoComplete="new-password" value={authForm.pass}
                        onChange={(e) => setAuthForm({ ...authForm, pass: e.target.value })} style={input()} />
                      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                        <button style={{ ...btn, flex: 1, padding: "10px 0" }} disabled={authBusy} onClick={() => doAuth("register")}>הרשמה</button>
                        <button style={{ background: "none", border: "none", color: T.muted, fontSize: 13.5, cursor: "pointer" }} onClick={() => setAuthMode("login")}>חזרה להתחברות</button>
                      </div>
                    </>
                  )}

                  {authMode === "forgot-user" && (
                    <>
                      <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 8 }}>נזין את האימייל הרשום — נשלח אליו את שם המשתמש</div>
                      <input placeholder="אימייל" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} style={input()} />
                      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                        <button style={{ ...btn, flex: 1, padding: "10px 0" }} disabled={authBusy} onClick={doForgotUsername}>שליחה</button>
                        <button style={{ background: "none", border: "none", color: T.muted, fontSize: 13.5, cursor: "pointer" }} onClick={() => setAuthMode("login")}>ביטול</button>
                      </div>
                    </>
                  )}

                  {authMode === "forgot-pass" && (
                    <>
                      <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 8 }}>נזין את האימייל הרשום — נשלח קוד לאיפוס הסיסמה</div>
                      <input placeholder="אימייל" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} style={input()} />
                      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                        <button style={{ ...btn, flex: 1, padding: "10px 0" }} disabled={authBusy} onClick={doForgotPassword}>שליחת קוד</button>
                        <button style={{ background: "none", border: "none", color: T.muted, fontSize: 13.5, cursor: "pointer" }} onClick={() => setAuthMode("login")}>ביטול</button>
                      </div>
                    </>
                  )}

                  {authMode === "reset-pass" && (
                    <>
                      <div style={{ fontSize: 13.5, color: T.muted, marginBottom: 8 }}>הזן/י את הקוד שנשלח לאימייל, וסיסמה חדשה</div>
                      <input placeholder="אימייל" type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} style={input()} />
                      <input placeholder="קוד בן 6 ספרות" inputMode="numeric" value={resetCode} onChange={(e) => setResetCode(e.target.value)} style={input()} />
                      <input placeholder="סיסמה חדשה" type="password" value={resetNewPass} onChange={(e) => setResetNewPass(e.target.value)} style={input()} />
                      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                        <button style={{ ...btn, flex: 1, padding: "10px 0" }} disabled={authBusy} onClick={doResetPassword}>איפוס סיסמה</button>
                        <button style={{ background: "none", border: "none", color: T.muted, fontSize: 13.5, cursor: "pointer" }} onClick={() => setAuthMode("login")}>ביטול</button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 15 }}>מחובר כ־<b>{auth.user}</b></div>
                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button style={{ ...btnGhost, flex: 1, padding: "9px 0", fontSize: 13.5 }} disabled={authBusy} onClick={cloudSave}>⬆ גיבוי לענן</button>
                    <button style={{ ...btnGhost, flex: 1, padding: "9px 0", fontSize: 13.5 }} disabled={authBusy} onClick={cloudLoad}>⬇ טעינה מהענן</button>
                  </div>
                  <button style={{ background: "none", border: "none", color: T.muted, fontSize: 13, cursor: "pointer", marginTop: 10, padding: 0 }} onClick={logout}>התנתקות</button>

                  <div style={{ marginTop: 18, padding: "12px 0", borderTop: `1px solid ${T.hair}` }}>
                    <div style={{ fontSize: 13, color: T.muted, marginBottom: 8 }}>
                      לא רשום אימייל לחשבון זה — נדרש לשחזור סיסמה/שם משתמש עתידי:
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <input placeholder="הוסף אימייל לחשבון" type="email" value={attachEmailValue}
                        onChange={(e) => setAttachEmailValue(e.target.value)} style={input({ flex: 1 })} />
                      <button style={{ ...btnGhost, padding: "8px 18px", fontSize: 13 }} disabled={authBusy} onClick={attachEmail}>שמירה</button>
                    </div>
                  </div>
                </div>
              )}
              {authMsg && (
                <div style={{ fontSize: 14, marginTop: 12, lineHeight: 1.7, padding: "10px 12px", border: `1px solid ${authMsg.startsWith("✓") ? T.accent : T.warn}`, color: authMsg.startsWith("✓") ? T.accent : T.warn }}>
                  {authMsg}
                </div>
              )}
              <button style={{ background: "none", border: "none", color: T.muted, fontSize: 12.5, cursor: "pointer", marginTop: 10, padding: 0, textDecoration: "underline" }}
                onClick={async () => {
                  if (!SERVER_URL) { setAuthMsg("SERVER_URL ריק בקוד — אין שרת מחובר. יש להדביק את כתובת ה-Worker בשורה const SERVER_URL בראש App.jsx"); return; }
                  setAuthMsg("בודק חיבור לשרת…");
                  try {
                    const r = await fetch(SERVER_URL.replace(/\/$/, "") + "/data/load", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                    const d = await r.json().catch(() => null);
                    setAuthMsg(d ? `✓ השרת מגיב (${r.status}) — אפשר להירשם ולהתחבר` : `השרת ענה אך לא ב-JSON (${r.status})`);
                  } catch (e) { setAuthMsg(`אין חיבור לשרת: ${e.message}. בדקו את SERVER_URL ושה-Worker פרוס`); }
                }}>
                🔌 בדיקת חיבור לשרת
              </button>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 10, lineHeight: 1.7 }}>
                הנתונים נשמרים אוטומטית במכשיר. חשבון אישי מוסיף גיבוי לענן וגישה מכל מכשיר. הסיסמה נשמרת בשרת כהצפנה חד־כיוונית בלבד.
              </div>
            </section>

            <section style={{ marginTop: 32, borderTop: `1px solid ${T.ink}`, paddingTop: 16 }}>
              <Label>אודות</Label>
              <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.9 }}>
                <div style={{ fontFamily: "'Frank Ruhl Libre', serif", fontSize: 24 }}>KetoMe</div>
                <div style={{ fontSize: 12.5, color: T.muted }}>גרסה {APP_VERSION}</div>
                <p style={{ margin: "10px 0 0" }}>
                  ניהול אורח חיים קטוגני: סריקת ארוחות עם AI, מאגר מזון עם יחידות הגשה, מעקב קטונים,
                  גלוקוז וחומצה אורית, לוח היסטוריה, רצפים, משקל ותובנות.
                </p>
                <div style={{ marginTop: 14, fontSize: 13, color: T.muted, lineHeight: 1.8 }}>
                  <div><b style={{ color: T.ink }}>מפתח</b></div>
                  <div>Developed and Maintained By Arye Nudelman.</div>
                  <div>פותח ומתוחזק על ידי אריה נודלמן.</div>
                  <div style={{ marginTop: 6 }}>© 2026 All rights reserved</div>
                </div>
                <p style={{ margin: "12px 0 0", fontSize: 12.5, color: T.muted }}>
                  האפליקציה אינה מכשיר רפואי ואינה תחליף לייעוץ רפואי מקצועי. ערכי AI הם הערכה בלבד.
                </p>
              </div>
            </section>
          </>
        )}
      </main>

      <nav style={{ position: "sticky", bottom: 0, background: T.paper, borderTop: `1px solid ${T.hair}` }}>
        <div style={{ maxWidth: 480, margin: "0 auto", display: "flex" }}>
          {[
            { id: "status", label: "סטטוס" },
            { id: "meal", label: "ארוחה" },
            { id: "measure", label: "מדידות" },
            { id: "meds", label: "תרופות", alert: pendingMeds.length > 0 },
            { id: "history", label: "היסטוריה" },
            { id: "profile", label: "פרטים" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={"navbtn" + (t.alert ? " med-alert" : "")}
              style={{ flex: 1, padding: "16px 0 18px", background: "transparent", border: "none", borderTop: tab === t.id ? `2px solid ${T.ink}` : "2px solid transparent", marginTop: -1, fontSize: 14, fontWeight: tab === t.id ? 700 : 400, color: t.alert ? T.warn : tab === t.id ? T.ink : T.muted, cursor: "pointer" }}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <KetoApp />
    </ErrorBoundary>
  );
}
