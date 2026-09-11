# Railway deploy — admin login direct fix

This version is based on 1.7.0-admin-single-entry.

Changes:
- `/admin/login` serves the same admin login HTML directly on GET.
- GET `/admin/login` is not protected by same-origin validation.
- Cache headers prevent stale login/error responses from being reused.
- `/api/version` reports `1.7.1-admin-login-direct`.
- Existing database is preserved; do not replace `applications.db` or `sessions.sqlite` on Railway.


## 1.7.5 — логотип ЦЗН
- В шапку публичной анкеты добавлен официальный минималистичный логотип «ЦЗН — Центр Занятости Населения».
- Белый фон логотипа сделан прозрачным, чтобы он аккуратно вписывался в шапку.
- На мобильных устройствах размер логотипа автоматически уменьшается.
