/**
 * TestMe Server — Cloudflare Worker
 * ─────────────────────────────────
 * מסלולי AI (Gemini) — כולם מוגבלים ל-50 קריאות ליום למשתמש/IP:
 *   POST /analyze-image    { image, media_type? }   → תמלול דוח בדיקות מתמונה
 *   POST /analyze-text     { query }                → זיהוי בדיקה+ערך מטקסט חופשי
 *   POST /analyze-trends   { entries, token? }       → ניתוח מגמות + קשרים בין בדיקות לאורך זמן
 * מסלולי חשבון אישי (KV):
 *   POST /auth/register .. /auth/reset-password, /data/save, /data/load — כרגיל
 */

const MODEL = "gemini-flash-latest";
const FROM_EMAIL = "onboarding@resend.dev";
const DAILY_AI_LIMIT = 50;

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

const TRENDS_PROMPT = (entriesJson) => `אתה עוזר רפואי המנתח היסטוריית בדיקות דם/מעבדה של משתמש לאורך זמן.
נתוני הבדיקות (JSON, כל רשומה כוללת שם בדיקה, ערך, יחידה, תאריך וסטטוס ביחס לטווח הנורמה):
${entriesJson}

כתוב ניתוח בעברית (עד 300 מילים), בלי כותרות ובלי Markdown, 3-5 פסקאות קצרות:
1. מגמות בולטות בבדיקות שיש להן יותר מתוצאה אחת לאורך זמן (עלייה/ירידה/יציבות), עם ציון הערכים והתאריכים.
2. קשרים אפשריים בין בדיקות שונות שנראים יחד באותם תאריכים או במגמה דומה (למשל שינויים מקבילים בפרופיל שומנים, בתפקודי כליה/כבד, או בין בדיקות שקשורות קלינית).
3. אם יש ערכים חריגים (גבוה/נמוך), ציין אותם וכל דפוס שחוזר.
אם אין מספיק נתונים להשוואה (פחות משתי תוצאות לאותה בדיקה), ציין זאת ואמור אילו בדיקות כדאי לעקוב אחריהן שוב בעתיד להשוואה משמעותית.
סיים במשפט מפורש שזהו אינו ייעוץ רפואי ואינו תחליף לרופא/ה, וכל שינוי או חשש מצריך פנייה לאיש מקצוע.`;

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
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1, maxOutputTokens: 1200 } }),
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error.message || "Gemini API error");
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n");
  if (!text.trim()) throw new Error("Gemini החזיר תשובה ריקה");
  return text.replace(/```[a-z]*|```/gi, "").trim();
}

/* ─── עזרי חשבון אישי ─── */
const bufToHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const hexToBuf = (hex) => new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));

async function hashPass(pass, saltHex) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBuf(saltHex), iterations: 100000, hash: "SHA-256" },
    key, 256
  );
  return bufToHex(bits);
}

async function authUser(env, token) {
  if (!env.CACHE || !token) return null;
  return env.CACHE.get("token:" + token);
}

async function sendEmail(env, to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  if (!r.ok) throw new Error("שליחת המייל נכשלה: " + (await r.text()));
}

async function usersForEmail(env, email) {
  const raw = await env.CACHE.get("email:" + email.toLowerCase().trim());
  return raw ? JSON.parse(raw) : [];
}
async function addEmailIndex(env, email, user) {
  const key = "email:" + email.toLowerCase().trim();
  const list = await usersForEmail(env, email);
  if (!list.includes(user)) list.push(user);
  await env.CACHE.put(key, JSON.stringify(list));
}

/* ─── הגבלת קצב: N קריאות AI ביום, לפי משתמש מחובר או IP ─── */
async function checkRateLimit(env, request, token) {
  if (!env.CACHE) return true; // בלי KV אין דרך לעקוב — לא חוסמים
  const user = token ? await authUser(env, token) : null;
  const bucket = user ? "user:" + user : "ip:" + (request.headers.get("cf-connecting-ip") || "anon");
  const day = new Date().toISOString().slice(0, 10);
  const key = "rl:" + bucket + ":" + day;
  const count = parseInt((await env.CACHE.get(key)) || "0", 10);
  if (count >= DAILY_AI_LIMIT) return false;
  await env.CACHE.put(key, String(count + 1), { expirationTtl: 60 * 60 * 26 });
  return true;
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
      const aiRoutes = ["/analyze-image", "/analyze-text", "/analyze-trends"];
      if (aiRoutes.includes(url.pathname)) {
        const ok = await checkRateLimit(env, request, body.token);
        if (!ok) return json({ error: `הגעת למכסת ${DAILY_AI_LIMIT} ניתוחי AI ליום. נסה שוב מחר.` }, 429);
      }

      if (url.pathname === "/analyze-image") {
        if (!body.image) return json({ error: "missing image (base64)" }, 400);
        const text = await callGemini(env, [
          { text: IMAGE_PROMPT },
          { inline_data: { mime_type: body.media_type || "image/jpeg", data: body.image } },
        ]);
        return json({ text });
      }

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
          await env.CACHE.put(cacheKey, text, { expirationTtl: 60 * 60 * 24 * 30 });
        }
        return json({ text });
      }

      if (url.pathname === "/analyze-trends") {
        if (!Array.isArray(body.entries) || body.entries.length === 0) return json({ error: "אין נתוני בדיקות לניתוח" }, 400);
        const text = await callGemini(env, [{ text: TRENDS_PROMPT(JSON.stringify(body.entries)) }]);
        return json({ text });
      }

      if (url.pathname === "/auth/register") {
        if (!env.CACHE) return json({ error: "יש להגדיר KV Namespace בשם CACHE" }, 500);
        const user = (body.user || "").trim().toLowerCase();
        const pass = body.pass || "";
        const email = (body.email || "").trim().toLowerCase();
        if (user.length < 2 || pass.length < 4) return json({ error: "שם משתמש (2+) וסיסמה (4+ תווים) נדרשים" }, 400);
        if (!email || !email.includes("@")) return json({ error: "כתובת אימייל תקינה נדרשת" }, 400);
        if (await env.CACHE.get("user:" + user)) return json({ error: "שם המשתמש כבר תפוס" }, 409);
        const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
        const hash = await hashPass(pass, salt);
        await env.CACHE.put("user:" + user, JSON.stringify({ salt, hash, email, created: Date.now() }));
        await addEmailIndex(env, email, user);
        const token = crypto.randomUUID();
        await env.CACHE.put("token:" + token, user, { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true, token, user });
      }

      if (url.pathname === "/auth/login") {
        if (!env.CACHE) return json({ error: "יש להגדיר KV Namespace בשם CACHE" }, 500);
        const user = (body.user || "").trim().toLowerCase();
        const rec = await env.CACHE.get("user:" + user);
        if (!rec) return json({ error: "משתמש לא נמצא" }, 404);
        const { salt, hash } = JSON.parse(rec);
        if ((await hashPass(body.pass || "", salt)) !== hash) return json({ error: "סיסמה שגויה" }, 401);
        const token = crypto.randomUUID();
        await env.CACHE.put("token:" + token, user, { expirationTtl: 60 * 60 * 24 * 365 });
        return json({ ok: true, token, user });
      }

      if (url.pathname === "/auth/set-email") {
        const user = await authUser(env, body.token);
        if (!user) return json({ error: "התחברות נדרשת" }, 401);
        const email = (body.email || "").trim().toLowerCase();
        if (!email || !email.includes("@")) return json({ error: "כתובת אימייל תקינה נדרשת" }, 400);
        const rec = await env.CACHE.get("user:" + user);
        if (!rec) return json({ error: "משתמש לא נמצא" }, 404);
        const parsed = JSON.parse(rec);
        await env.CACHE.put("user:" + user, JSON.stringify({ ...parsed, email }));
        await addEmailIndex(env, email, user);
        return json({ ok: true });
      }

      if (url.pathname === "/auth/forgot-username") {
        const email = (body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "כתובת אימייל נדרשת" }, 400);
        const users = await usersForEmail(env, email);
        if (users.length) {
          await sendEmail(env, email, "שם המשתמש שלך ב-TestMe",
            `<p>שלום,</p><p>שם/שמות המשתמש הרשומים באימייל זה:</p><ul>${users.map(u => `<li><b>${u}</b></li>`).join("")}</ul>`);
        }
        return json({ ok: true });
      }

      if (url.pathname === "/auth/forgot-password") {
        const email = (body.email || "").trim().toLowerCase();
        if (!email) return json({ error: "כתובת אימייל נדרשת" }, 400);
        const users = await usersForEmail(env, email);
        if (users.length) {
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          await env.CACHE.put("reset:" + email, JSON.stringify({ code, users }), { expirationTtl: 60 * 30 });
          await sendEmail(env, email, "איפוס סיסמה ב-TestMe",
            `<p>שלום,</p><p>קוד לאיפוס הסיסמה שלך: <b style="font-size:20px">${code}</b></p><p>הקוד בתוקף ל-30 דקות.</p>`);
        }
        return json({ ok: true });
      }

      if (url.pathname === "/auth/reset-password") {
        const email = (body.email || "").trim().toLowerCase();
        const code = (body.code || "").trim();
        const newPass = body.newPass || "";
        if (!email || !code || newPass.length < 4) return json({ error: "נדרשים אימייל, קוד וסיסמה חדשה (4+ תווים)" }, 400);
        const raw = await env.CACHE.get("reset:" + email);
        if (!raw) return json({ error: "הקוד פג תוקף או לא קיים — יש לבקש קוד חדש" }, 400);
        const { code: savedCode, users } = JSON.parse(raw);
        if (code !== savedCode) return json({ error: "קוד שגוי" }, 401);
        const salt = bufToHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
        const hash = await hashPass(newPass, salt);
        for (const user of users) {
          const rec = await env.CACHE.get("user:" + user);
          if (rec) {
            const parsed = JSON.parse(rec);
            await env.CACHE.put("user:" + user, JSON.stringify({ ...parsed, salt, hash }));
          }
        }
        await env.CACHE.delete("reset:" + email);
        return json({ ok: true });
      }

      if (url.pathname === "/data/save") {
        const user = await authUser(env, body.token);
        if (!user) return json({ error: "התחברות נדרשת" }, 401);
        await env.CACHE.put("data:" + user, JSON.stringify(body.data || {}));
        return json({ ok: true });
      }

      if (url.pathname === "/data/load") {
        const user = await authUser(env, body.token);
        if (!user) return json({ error: "התחברות נדרשת" }, 401);
        const d = await env.CACHE.get("data:" + user);
        return json(d ? JSON.parse(d) : {});
      }

      return json({ error: "unknown route" }, 404);
    } catch (e) {
      return json({ error: e.message || "server error" }, 500);
    }
  },
};
