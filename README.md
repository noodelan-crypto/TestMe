# TestMe — הוראות בנייה ל-Android

קובץ זה מכיל פרויקט React מלא (Vite) של אפליקציית TestMe.
הפעל את הפקודות הבאות **במחשב שלך** (Windows/Mac/Linux), לא כאן בצ'אט.

---

## שלב 0: מה צריך להתקין מראש (חד פעמי)
1. **Node.js** (גרסה 18 ומעלה) — הורדה מ: https://nodejs.org
2. **Android Studio** — הורדה מ: https://developer.android.com/studio
   (בפתיחה הראשונה, אשף ההתקנה יוריד גם Android SDK — תן לו לסיים)

בדוק שההתקנה הצליחה:
```bash
node --version
npm --version
```

---

## שלב 1: פתיחת הפרויקט והרצה מקומית (בדיקה בדפדפן)
בתוך תיקיית הפרויקט (`testme-project`):
```bash
npm install
npm run dev
```
זה יפתח שרת מקומי (כתובת כמו `http://localhost:5173`) — פתח אותה בדפדפן ותראה את TestMe רץ. Ctrl+C לעצירה.

---

## שלב 2: בניית קבצי ה-Web הסופיים
```bash
npm run build
```
זה יוצר תיקיית `dist/` עם כל הקבצים הסטטיים המוכנים.

---

## שלב 2.5 (חדש): חיבור שרת ה-AI (ניתוח תמונה/טקסט עם Gemini, חינם) — ~5 דק'
האפליקציה כוללת כעת אפשרות לצלם/להעלות תמונה של דוח בדיקות ולזהות אותו אוטומטית, וכן זיהוי חכם לטקסט חופשי שלא זוהה. זה דורש Cloudflare Worker קטן (`worker/testme-worker.js`):

1. dash.cloudflare.com → Workers & Pages → Create Worker → Deploy
2. Edit code → הדבק את `worker/testme-worker.js` במקום הקוד ברירת המחדל → Deploy
3. מפתח Gemini חינמי: aistudio.google.com/apikey → Get API key
4. ב-Worker: Settings → Variables and Secrets → Secret בשם `GEMINI_API_KEY` (הדביקו את המפתח)
5. (אופציונלי, מטמון לשאילתות טקסט חוזרות) Settings → Bindings → KV Namespace, שם המשתנה: `CACHE`
6. את כתובת ה-Worker (`https://xxx.workers.dev`) הדביקו ב-`src/App.jsx`, בשורה: `const SERVER_URL = "https://xxx.workers.dev";` (כרגע ריקה - כפתורי ה-AI מוסתרים עד שממלאים אותה)
7. `npm run build` מחדש כדי שהשינוי ייכנס לתוקף

עלות: Workers Free (100,000 בקשות/יום, חינם) + Gemini API Free tier — שתיהן בחינם לשימוש אישי/משפחתי.

---

## שלב 3: הוספת Capacitor (העטיפה ל-Android ול-iOS)
```bash
npm install @capacitor/core @capacitor/android @capacitor/ios
npm install -D @capacitor/cli
npx cap init TestMe com.yourname.testme --web-dir=dist
```
> החליטו על ה-App ID (`com.yourname.testme`) עכשיו — קשה לשנות אותו בהמשך, וצריך להיות **זהה** בשני הסטורים. שם ה-package חייב להיות ייחודי (למשל `com.arienudelman.testme`).

```bash
npx cap add android
npx cap add ios
npx cap copy
```

---

## שלב 4א: Android — פתיחה ב-Android Studio ובנייה
```bash
npx cap open android
```
זה יפתח את הפרויקט ב-Android Studio אוטומטית. שם:
1. חכה שה-Gradle יסיים לסנכרן (סרגל התקדמות למטה).
2. כדי לבדוק על הטלפון שלך: חבר טלפון אנדרואיד בכבל USB (עם "ניפוי שגיאות USB" מופעל בהגדרות המפתחים), ולחץ על כפתור ה-▶ הירוק למעלה.
3. כדי לייצר קובץ APK להתקנה/שיתוף:
   בתפריט: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**
   הקובץ המוכן יופיע בתיקייה:
   `android/app/build/outputs/apk/debug/app-debug.apk`

את קובץ ה-APK הזה אפשר לשלוח לכל אחד (וואטסאפ, מייל, דרייב) — הם צריכים רק לאפשר "התקנה ממקורות לא ידועים" בטלפון שלהם ולפתוח את הקובץ.

---

## שלב 4ב: iOS — פתיחה ב-Xcode ובנייה
**חשוב: בניית iOS דורשת מחשב Mac — אין דרך לעקוף את זה (Apple לא מאפשרת לבנות אפליקציות iOS על Windows/Linux).** אם אין לך Mac, אפשר להשתמש בשירות ענן כמו MacStadium / MacInCloud, או לבקש מחבר עם Mac.

על ה-Mac, נדרש להתקין **Xcode** (חינם, מה-Mac App Store — קובץ גדול, יכול לקחת שעה להורדה).

```bash
npx cap open ios
```
זה יפתח את הפרויקט ב-Xcode. שם:
1. בחר את ה-Project הראשי בעץ הקבצים משמאל, ותחת **Signing & Capabilities** בחר את חשבון ה-Apple Developer שלך (Team).
2. כדי לבדוק על אייפון שלך: חבר אותו בכבל, בחר אותו כיעד למעלה, ולחץ ▶.
3. כדי לבדוק בסימולטור בלבד (בלי אייפון פיזי): בחר יעד כמו "iPhone 15" מהרשימה הנפתחת ולחץ ▶.

---

## שלב 5: פרסום בחנויות

### Google Play
1. ליצור **Release Build** חתום: **Build → Generate Signed Bundle / APK** → בחר Android App Bundle (AAB) → צור מפתח חתימה (keystore) חדש ושמור אותו במקום בטוח (אי אפשר לשחזר!).
2. פתח חשבון מפתח ב-Google Play Console (**תשלום חד-פעמי של כ-25$**): https://play.google.com/console
3. צור אפליקציה חדשה, מלא פרטים (תיאור, צילומי מסך, מדיניות פרטיות), והעלה את קובץ ה-AAB.
4. האפליקציה עוברת בדיקת Google (בדרך כלל ימים בודדים) ואז מתפרסמת.

### Apple App Store
1. פתח חשבון **Apple Developer Program** (**תשלום שנתי של 99$**): https://developer.apple.com/programs/
2. ב-Xcode: **Product → Archive** (בונה גרסת שחרור).
3. כשהארכוב מוכן, ייפתח חלון Organizer — לחץ **Distribute App → App Store Connect → Upload**.
4. עבור ל-https://appstoreconnect.apple.com, צור רשומת אפליקציה חדשה (שם, תיאור, צילומי מסך, מדיניות פרטיות — **חובה** קישור למדיניות פרטיות אמיתית, במיוחד באפליקציה שנוגעת במידע רפואי אישי), וקשר אליה את הבילד שהעלית.
5. שלח ל-**App Review** — סקירת אפל אורכת בדרך כלל 1-3 ימים, ולעיתים דורשת תיקונים חוזרים אם משהו לא עומד בהנחיות שלהם (למשל דרישות פרטיות למידע רפואי).

**הבדל מהותי מ-Google Play:** Apple נוטה לבדוק אפליקציות רפואיות/בריאותיות בקפדנות רבה יותר, ועלולה לדרוש הבהרות/שינויים בנוגע לניסוח ("לא מהווה ייעוץ רפואי"), למדיניות הפרטיות, ולתיאור השימוש במידע.

---

## עדכון תוכן בעתיד
כל התוכן (הבדיקות, הטווחים, הקורלציות) נמצא בקובץ `src/App.jsx`.
אחרי כל שינוי בקוד:
```bash
npm run build
npx cap copy
```
ואז לפתוח שוב ב-Android Studio / Xcode ולבנות גרסה מעודכנת בכל פלטפורמה.

---

## בעיות נפוצות
- **"SDK location not found"** — פתח Android Studio → Settings → Android SDK, ודא שה-SDK מותקן, וש-Capacitor מוצא אותו (לרוב נפתר אוטומטית).
- **גופנים לא נטענים**: האפליקציה טוענת גופנים (Google Fonts) מהאינטרנט — לכן נדרש חיבור אינטרנט בפעם הראשונה שהאפליקציה נפתחת אצל המשתמש.
- **גרסת Node ישנה**: אם `npm install` נכשל, עדכן Node לגרסה 18 ומעלה.

---

## בדיקת תקינות הנתונים (Validation)

הפרויקט כולל סקריפט בדיקה אוטומטי (`validate.mjs`) שסורק את כל נתוני האפליקציה ומאתר בעיות לפני שהן מגיעות למשתמש.

**הרצה:**
```bash
npm run validate
```
(או ישירות: `node validate.mjs src/App.jsx`)

**מה הוא בודק:**
1. מזהי בדיקות כפולים
2. שדות חובה חסרים בכל בדיקה (שם, תיאור, טווח/ערכים, כיסוי וכו')
3. קישורי `related` שמצביעים על בדיקות שלא קיימות
4. פאנלים (PANELS) שמפנים לבדיקות לא קיימות
5. חוקי קורלציה (RULES) עם מזהים או כיוונים שגויים
6. ניתובי תסמינים (SYMPTOM_ROUTES) לבדיקות לא קיימות
7. מילון שמות דוחות מעבדה (LAB_REPORT_SYNONYMS) תקין
8. הסברי הקשר (CONCEPT_NOTES / ROUTE_NOTES) מקושרים לבדיקות קיימות
9. **כיסוי חיפוש** — רשימת מונחים נפוצים (חום, מיגרנה, ויטמין, כבד וכו') שכל אחד מהם *חייב* להחזיר לפחות תוצאה אחת
10. בדיקות שכמעט לא ניתנות לחיפוש (רק לפי שם)
11. קישורים חד-כיווניים (מידע בלבד)

הסקריפט מחזיר קוד יציאה 0 אם הכל תקין, או 1 אם נמצאו שגיאות — כך שאפשר לשלב אותו ב-CI.

**הרחבת בדיקת הכיסוי:** כדי לוודא שמונח חיפוש חדש עובד, הוסף אותו למערך `expectHits` בתוך `validate.mjs` (בבדיקה מס' 9). אם החיפוש מחזיר ריק, הסקריפט ייכשל ויסמן זאת — בדיוק כמו שקרה עם "חום" ו"מיגרנה".
