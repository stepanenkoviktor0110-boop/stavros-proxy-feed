# Stavros proxy-feed (B24U trial)

Отфильтрованный YML-фид для B24U: товарная группа «Ножки и опоры мебельные»
(categoryId 313+314), дедуплицировано до уникальных товаров, лимит 100 (триал),
цена вырезана (деньги → менеджер), description обогащён синонимами.

- Источник: `https://www.stavros.ru/bitrix/catalog_export/yandex_502613.php`
- Выход: `feed.xml` (раздаётся через GitHub Pages)
- Авто-ребилд: GitHub Actions, cron каждые 6 часов + workflow_dispatch.

Сборка локально: `npm install && npm run build` → `public/feed.xml`.
