# دليل النسخ الاحتياطي واسترجاع البيانات (Database Backup & Disaster Recovery)
## Go Wash — فعالية اليوم الوطني السعودي 96

يوفر النظام آليات متكاملة لحماية واسترجاع بيانات الفعالية، مع التركيز على الجداول الستة ذات الأولوية القصوى:
* **Participants** (بيانات المشاركين)
* **Spins** (سجلات التدوير)
* **Promo Codes** (أكواد الخصم والجوائز وحالاتها)
* **Redemptions** (سجل استرداد واستخدام الأكواد)
* **Terms Consents** (موافقات الشروط والأحكام)
* **Audit Logs** (سجل تدقيق عمليات الإدارة)

---

## 1. النسخ الاحتياطي التلقائي على Railway PostgreSQL

في منصة **Railway**، قاعدة بيانات PostgreSQL تأتي مدعومة بنظام نسخ احتياطي تلقائي دون الحاجة لبرمجة إضافية:
1. افتح مشروع Go Wash في لوحة تحكم [Railway Dashboard](https://railway.app).
2. اضغط على خدمة قاعدة البيانات `Postgres`.
3. انتقل إلى تبويب **Backups**.
4. يتيح Railway نسخاً يومية تلقائية (Automated Daily Backups) مع إمكانية استرجاع أي نقطة زمنية بضغطة زر واحدة (1-Click Restore).

---

## 2. النسخ اليدوي والاسترجاع الفوري عبر Railway CLI / pg_dump

يمكنك في أي لحظة أخذ نسخة احتياطية فورية أو استرجاعها مباشرة عبر سطر الأوامر:

### أخذ نسخة احتياطية فورية (SQL Dump):
```bash
# عبر Railway CLI
railway run pg_dump $DATABASE_URL > backups/railway-backup-$(date +%Y%m%d).sql

# أو مباشرة عبر pg_dump القياسي باستخدام رابط الاتصال:
pg_dump "postgresql://postgres:PASSWORD@HOST:PORT/railway" > backup.sql
```

### استرجاع النسخة الاحتياطية عند حدوث مشكلة:
```bash
# عبر Railway CLI
railway run psql $DATABASE_URL < backups/railway-backup.sql

# أو مباشرة عبر psql:
psql "postgresql://postgres:PASSWORD@HOST:PORT/railway" < backup.sql
```

---

## 3. أداة النسخ والاسترجاع التلقائية المدمجة (Node.js)

يوفر التطبيق أداة برمجية تعمل على بيئتي **PostgreSQL** و **SQLite**:

### لإنشاء نسخة احتياطية جديدة:
```bash
npm run backup
```
يقوم الأمر بفحص وتصدير كافة الجداول ذات الأولوية وتخزينها في ملف JSON مؤرخ وموثق داخل مجلد `backups/`.

### لاسترجاع البيانات من نسخة احتياطية:
```bash
npm run restore backups/gowash-backup-YYYY-MM-DDTHH-mm-ss.json
```
يتم استرجاع السجلات في معاملة ذرية آمنة (Atomic Transaction) تمنع فقدان البيانات أو تعارض المفاتيح.

---

## 4. التصدير الفوري من لوحة تحكم المشرف (Admin Dashboard)

يتوفر خيار تصدير النسخة الاحتياطية بنقرة واحدة للمدير عبر واجهة الـ API الآمنة:
* المسار: `GET /api/admin/backup/export`
* يتطلب تسجيل دخول المسؤول (`requireAdmin`).
* يوثق عملية التصدير في جدول `audit_logs` لضمان أمان البيانات.
