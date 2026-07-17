/**
 * TestMe Server — Cloudflare Worker
 * ─────────────────────────────────
 * מסלולים:
 *   POST /analyze-image   { image, media_type? }   → תמלול דוח בדיקות מתמונה (Gemini Vision)
 *   POST /analyze-text    { query }                → זיהוי בדיקה+ערך מתוך טקסט חופשי שלא זוהה אוטומטית (Gemini)
 *
 * שני המסלולים מחזירים { text: "..." } — שורות טקסט פשוטות בפורמט "שם בדיקה ערך",
 * בדיוק כמו טקסט שממוקם בתיבת ההדבקה הידנית של האפליקציה. כך אפשר להזין את הפלט
 * ישירות ל-parseBulkText() הקיים בצד הלקוח, בלי לשנות את לוגיקת ההתאמה.
 *
 * פריסה (בחינם, ~5 דקות):
 * 1. dash.cloudflare.com → Workers & Pages → Create Worker
 * 2. Edit code → הדבק את הקובץ הזה במקום הקוד ברירת המחדל → Deploy
 * 3. Settings → Variables and Secrets → Secret בשם GEMINI_API_KEY
 *    (מפתח חינמי: aistudio.google.com/apikey — "Get API key", בחר/י Free tier)
 * 4. (אופציונלי, מטמון לשאילתות טקסט חוזרות) Settings → Bindings → KV Namespace, שם המשתנה: CACHE
 * 5. את כתובת ה-Worker (https://xxx.workers.dev) מדביקים ב-src/App.jsx: const SERVER_URL = "https://xxx.workers.dev";
 *
 * עלות: Workers Free — 100,000 בקשות/יום, חינם.
 * Gemini API: Free tier (aistudio.google.com) — כ-15 בקשות/דקה, 1,500/יום (נכון ל-2026),
 * בהחלט מספיק לשימוש אישי/משפחתי. הקוד משתמש ב-alias "gemini-flash-latest" כדי
 * להישאר תמיד על הדגם החינמי העדכני, גם כשגוגל מחליפה/מוציאה משימוש דגמים ישנים.
 */

// "gemini-flash-latest" הוא alias רשמי של גוגל שמצביע תמיד על הדגם החינמי (Flash)
// העדכני ביותר, ומתעדכן אוטומטית עם הודעה מראש של שבועיים — כך שלא צריך לעדכן
// את הקוד ידנית בכל פעם שגוגל מוציא דגם חדש/מוציא דגם ישן משימוש (כפי שקרה ל-gemini-2.0-flash ב-2026).
const MODEL = "gemini-flash-latest";

const IMAGE_PROMPT = `אתה מתמלל דוח בדיקות דם/מעבדה מצולם או סרוק.
זהה כל שורה שבה מופיע שם בדיקה וערך מספרי, והחזר טקסט פשוט בלבד — שורה אחת לכל בדיקה, בפורמט:
שם הבדיקה בעברית או כפי שמופיע בדוח <רווח> ערך מספרי <רווח> יחידה (אם מופיעה)
דוגמה לפורמט הרצוי:
המוגלובין 13.8 g/dL
גלוקוז בצום 92 mg/dL
אם מופיע תאריך הבדיקה בדוח, הוסף אותו כשורה נפרדת ראשונה בפורמט YYYY-MM-DD.
אל תוסיף כותרות, הסברים, מספור, טבלאות או עיצוב Markdown — רק את השורות עצמן.
אם התמונה אינה דוח בדיקות דם/מעבדה: "שגיאה: לא זוהה דוח בדיקות בתמונה"`;

const TEXT_PROMPT = (q) => `המשתמש הזין את הטקסט הבא לגבי תוצאת בדיקת דם/מעבדה, אך המערכת לא הצליחה לזהות אותו אוטומטית:
"${q}"
נסה לזהות שם בדיקה מוכר (בעברית, אנגלית, או ראשי תיבות נפוצים) והערך המספרי שלו, והחזר שורה אחת בלבד בפורמט:
שם הבדיקה <רווח> ערך מספרי
אם אין ערך מספרי ברור או שלא ניתן לשייך לבדיקה מוכרת, החזר בדיוק: "שגיאה: לא זוהתה בדיקה או ערך תקין"
אל תוסיף שום הסבר נוסף — רק את השורה, או את שורת השגיאה.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });

async function callGemini(env, parts) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY לא הוגדר ב-Worker (Settings → Variables and Secrets)");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1000 },
    }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "Gemini API error");
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
  if (!text.trim()) throw new Error("Gemini החזיר תשובה ריקה");
  return text.replace(/```[a-z]*|```/gi, "").trim();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    const url = new URL(request.url);
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid JSON body" }, 400);
    }

    try {
      /* ─── POST /analyze-image — תמלול דוח בדיקות מתמונה ─── */
      if (url.pathname === "/analyze-image") {
        if (!body.image) return json({ error: "missing image (base64)" }, 400);
        const text = await callGemini(env, [
          { text: IMAGE_PROMPT },
          { inline_data: { mime_type: body.media_type || "image/jpeg", data: body.image } },
        ]);
        return json({ text });
      }

      /* ─── POST /analyze-text — זיהוי טקסט חופשי שלא הותאם אוטומטית (עם מטמון KV אם מוגדר) ─── */
      if (url.pathname === "/analyze-text") {
        const q = (body.query || "").trim();
        if (!q) return json({ error: "missing query" }, 400);

        const cacheKey = "analyze-text:" + q.toLowerCase();
        if (env.CACHE) {
          const cached = await env.CACHE.get(cacheKey);
          if (cached) return json({ text: cached });
        }

        const text = await callGemini(env, [{ text: TEXT_PROMPT(q) }]);

        if (env.CACHE && !text.startsWith("שגיאה")) {
          // שאילתות טקסט חוזרות (למשל אותו שם בדיקה בניסוח שונה) - מטמון ל-30 יום
          await env.CACHE.put(cacheKey, text, { expirationTtl: 60 * 60 * 24 * 30 });
        }
        return json({ text });
      }

      return json({ error: "unknown route" }, 404);
    } catch (e) {
      return json({ error: e.message || "server error" }, 500);
    }
  },
};
