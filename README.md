# Go Wash — فعالية اليوم الوطني السعودي 96 الحصرية 🇸🇦

تطبيق ويب مؤقت واحترافي لعلامة **Go Wash** لخدمة غسيل السيارات المتنقلة، مصمم خصيصاً لاستقبال زيارات منصة Instagram خلال فعاليات اليوم الوطني السعودي 96.

---

## 🔗 الروابط المباشرة (Live Links)

- **رابط الواجهة الرئيسية (GitHub Pages)**: [https://mcro25.github.io/gowash/](https://mcro25.github.io/gowash/)
- **رابط التحقق من الجوائز (QR / Code Verification)**: [https://mcro25.github.io/gowash/verify.html](https://mcro25.github.io/gowash/verify.html)
- **مستودع الكود (GitHub Repository)**: [https://github.com/Mcro25/gowash](https://github.com/Mcro25/gowash)
- **خادم الباك إند (Railway Backend)**: [https://gowash-production.up.railway.app](https://gowash-production.up.railway.app)
- **لوحة التحكم الإدارية (Admin Dashboard)**: [https://gowash-production.up.railway.app/admin](https://gowash-production.up.railway.app/admin)

---

## 🌟 المعمارية والبنية العامة

```text
Customer Page (/)
       │
       ▼
Backend API (/api)
       │
       ▼
Database (SQLite - WAL Mode)

────────────────────────────

Admin Dashboard (/admin)
       │
       ▼
Protected Admin API (/api/admin)
       │
       ▼
Database (SQLite - WAL Mode)
```

---

## ✨ المميزات الرئيسية

1. **صفحة العملاء (`/`)**:
   - واجهة عصرية وسريعة تركز على الهواتف الذكية (Mobile-First).
   - هوية Go Wash الرسمية (الأزرق، البرتقالي، الكحلي) مع لمسات اليوم الوطني السعودي 96.
   - عجلة حظ Canvas ذات 6 قطاعات **متساوية الحجم بصرياً بنسبة 100%**.
   - **تحديد الفائز مشفر كلياً في السيرفر** (`node:crypto`) دون أي تسريب للاحتمالات في المتصفح.
   - نافذة الفائز المنبثقة مع كود خصم فريد (`GW96-XXXXX`) وزر حجز مباشر عبر الواتساب بنص رسالة معبأ مسبقاً.
   - عرض مستقل لغسيل سيارتين (خصم 25% غير قابل للجمع).
   - شروط وأحكام واضحة و3 خطوات مبسطة للاستخدام.

2. **الأمان ومكافحة التلاعب**:
   - **قفل الذرية (Atomic Lock)** لمنع هجمات السباق (Race Conditions): مهما تكررت الطلبات المتزامنة، يُسجل فوز واحد فقط.
   - **دعم Idempotency-Key**: تكرار الطلب عند انقطاع الشبكة يرجع نفس النتيجة دون إنشاء جائزة ثانية.
   - **معرف عميل مشفر (Participant ID)** عبر كوكيز HttpOnly و SameSite.
   - **محدد سرعة الطلبات (Rate Limiting)** ضد السبام وهجمات الحرمان من الخدمة.
   - **ترويسات أمان متقدمة**: CSP, HSTS, X-Content-Type-Options, X-Frame-Options.

3. **لوحة التحكم الإدارية (`/admin`)**:
   - **محمية كلياً** بتسجيل دخول مشفر بـ `bcryptjs` وجلسات HttpOnly آمنة.
   - **حماية CSRF** لجميع العمليات الإدارية التي تغير البيانات.
   - **زر إيقاف فوري للحملة (Kill Switch)** لرفض جميع اللفات لحظياً.
   - **إدارة الجوائز والاحتمالات**: مع عداد حي يشترط مجموع 100.00% بدقة ويرفض أي قيم سالبة أو نصوص غير صالحة.
   - **سجل اللفات**: جدول كامل مع البحث والفلترة وتصفح الصفحات.
   - **الأكواد الترويجية**: إمكانية فحص الكود وصرفه (Redeem) أو إلغاؤه (Cancel) ومنع إعادة الاستخدام نهائياً.
   - **سجل الأمان وAudit Trail**: توثيق محاولات السبام والعمليات الإدارية.

---

## 🔑 بيانات الدخول الافتراضية للوحة التحكم

- **رابط الدخول**: `/admin` أو `/admin/login.html`
- **اسم المستخدم**: `admin` (أو `admin@gowash.sa`)
- **كلمة المرور الافتراضية**: `GoWash96@Admin`
*(يمكن تغيير كلمة المرور فورياً من تبويب الإعدادات في لوحة التحكم)*

---

## 🚀 التشغيل المحلي

```bash
# 1. تثبيت الاعتماديات
npm install

# 2. تشغيل السيرفر
npm start
```

افتح المتصفح على:
- صفحة العميل: `http://localhost:3000/`
- لوحة التحكم: `http://localhost:3000/admin`

---

## 🧪 تشغيل الفحوصات الآلية (Test Suite)

يشمل المشروع فحصاً شاملاً يغطي 16 اختباراً لكافة المتطلبات:

```bash
npm test
# أو
node tests/full-flow.test.js
```

---

## 🌐 النشر على رابط مؤقت (Temporary Live Link)

هذا المشروع مصمم ليكون ذاتي الاحتواء (Self-contained) وجاهزاً للنشر بضغطة زر واحدة على أي منصة توفر روابط مؤقتة مجانية:

1. **Render.com**:
   - اربط مستودع GitHub `Mcro25/gowash`.
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - يمنحك رابطاً فورياً مجانياً مثل: `https://gowash-nd96.onrender.com`

2. **Railway.app**:
   - "Deploy from GitHub repo".
   - يتعرف على Node.js تلقائياً ويمنحك رابطاً مباشراً.

3. **Fly.io** أو **VPS**:
   - تشغيل مباشر عبر `node server.js`.
