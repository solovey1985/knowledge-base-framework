# To-Do: узгодження із Second Brain

Стан перевірено 2026-11-06 за поточними робочими деревами обох репозиторіїв. Мета — перенести загальні виправлення Second Brain у framework і прибрати тимчасові підміни після перевіреного оновлення пакета.

Цей список не є дозволом на публікацію npm, push або деплой. Наявність коду в робочому дереві не означає, що він закомічений чи включений у встановлений пакет.

## Джерела та межі

- Second Brain: коміт `da76973` — суцільний layout; `496e068` — пошук і сторінки Work Manager.
- Встановлена в Second Brain версія: `2.0.0-rc.17`.
- [Локальний адаптер статичної збірки](../second-brain/build.js), [сервер](../second-brain/server.js), [індексатор](../second-brain/scripts/search-index-service.cjs), [CSS](../second-brain/assets/css/content-layout.css).
- [Тести навігації Second Brain](../second-brain/tests/static-navigation.test.js), [тести Render runtime](../second-brain/tests/render-runtime.test.js), [тести пошуку](../second-brain/tests/search-index.test.js).
- Особисті OAuth-дані, домен, ID сховища, приватний профіль і контент проєктів залишаються в застосунку. Framework не повинен вимагати Work Manager або Google Drive від усіх споживачів.

## Порядок виконання

1. KB-SYNC-01–02: завершити перевірку вже перенесених пошуку та стилів.
2. KB-SYNC-03–05: перенести відсутню загальну поведінку збірки, посилань і приватного режиму.
3. KB-SYNC-06: перевірити однакову поведінку всіх способів запуску.
4. KB-SYNC-07: після окремо погодженого релізу прибрати адаптери Second Brain.

## KB-SYNC-01 — Завершити перенесення пошукового індексатора

- **Purpose** : ***Швидкий пошук українського та англомовного контенту без повторного рендерингу сторінок***
- **Owner** : ***unassigned***
- **Area** : ***backend***
- **Date** : ***2026-11-06***
- **Priority** : ***P1***
- **Status** : ***Код перенесено локально; потрібні додаткові перевірки перед випуском***

Поточна реалізація: [SearchIndexService](src/services/SearchIndexService.ts), методи `build`, `buildIndex`, `collectSearchDocuments`; [регресійний тест](tests/search-index.test.cjs). Уже прибрано повний `KnowledgeBase.renderContent` із циклу індексації, об’єднано одночасні побудови, додано Unicode-обробку, порожній індекс та абсолютний шлях кешу.

- [x] Пошук українських слів і одночасні запити перевірені тестом; у Second Brain браузер відкриває знайдений документ.
- [ ] Додати тести відновлення після помилки побудови, абсолютного шляху та повторного читання індексу з диска.
- [ ] Перевірити видалення й перейменування документів: `needsRebuild` зараз порівнює максимальний mtime, що може не виявити видалення останнього/найновішого файла. Критерій: видалений документ зникає без перезапуску процесу.
- [ ] Узгодити payload із пам’яті та диска: зараз кеш повертає також `body`, дискова версія — лише метадані. Критерій: однакова публічна схема без зайвого дублювання тексту.
- [ ] Перевірити холодний запуск на малому інстансі й 8-секундний таймаут у [client/search.ts](client/search.ts), включно з повторними спробами. Не вважати локальні 4,8 с гарантією Render.
- [ ] Перевірити метадані `*.work-manager.md`: назва результату має походити з YAML `title`, а не з технічного імені файла. Поточна реалізація бере H1 або basename.

Критерій завершення: `kb serve`, API та статична збірка використовують той самий індексатор; тести проходять; виміряні холодна побудова і кеш. Індекс охоплює Git Markdown, а не приватні JSON-задачі Drive.

## KB-SYNC-02 — Завершити перенесення layout без зовнішніх проміжків

- **Purpose** : ***Однакові стилі для всіх застосунків без локального CSS-дублювання***
- **Owner** : ***unassigned***
- **Area** : ***web***
- **Date** : ***2026-11-06***
- **Priority** : ***P2***
- **Status** : ***Перенесено локально; не випущено***

Джерело: [content-layout.css Second Brain](../second-brain/assets/css/content-layout.css). Ціль: [main.scss](client/styles/main.scss), `.kb-content__inner` та `.kb-content__card`; пов’язаний [layout.hbs](templates/default/layout.hbs).

- [x] Знято обмеження ширини 90%, зовнішній padding, рамку, округлення та тінь картки; збережено внутрішні відступи.
- [x] Локальний Second Brain override перевірено на окремому проєкті: desktop — проміжок 0 px; mobile — без горизонтального переповнення.
- [ ] Повторити browser-перевірку із зібраним framework без site override: 1280×800 та 390×844, довга таблиця, Work Manager, відкрите мобільне меню.
- [ ] Зберегти контрольні screenshots у репозиторії перед закриттям задачі; поточна візуальна перевірка не є прийманням майбутнього npm-пакета.

Критерій завершення: картка починається на правій межі sidebar, текст має внутрішні відступи, мобільна кнопка не перекриває контент. Після релізу CSS Second Brain можна видалити без зміни вигляду.

## KB-SYNC-03 — Перенести правильну генерацію статичних index.html

- **Purpose** : ***Зберегти авторські індекси та забезпечити сторінки всіх каталогів***
- **Owner** : ***unassigned***
- **Area** : ***backend***
- **Date** : ***2026-11-06***
- **Priority** : ***P1***
- **Status** : ***Не перенесено***

Джерело: `PortalSiteBuilder.writeHtmlFile` і `buildPages` у [Second Brain build.js](../second-brain/build.js). Ціль: [StaticSiteBuilder.buildPages](src/builders/StaticSiteBuilder.ts).

- [ ] Якщо каталог містить `index.md`, рендерити саме його та не перезаписувати результат directory listing, включно з коренем.
- [ ] Якщо `index.md` відсутній, створювати `index.html` каталогу зі штатним listing.
- [ ] Перенести сценарії авторського кореня, вкладених каталогів, вкладень і `baseUrl` із тестів Second Brain.
- [ ] При помилці рендерингу/запису завершувати build помилкою; поточний `buildPages` перехоплює та лише логує помилки.

Критерій завершення: в ізольованій output-папці всі очікувані сторінки існують, авторський текст збережено, навігаційні посилання відкриваються; ін’єктована помилка дає ненульовий exit code. Не змінювати домовленість server-mode про directory listing без окремого рішення.

## KB-SYNC-04 — Виправити breadcrumbs для звичайних документів

- **Purpose** : ***Прибрати локальну підміну адрес breadcrumb у Second Brain***
- **Owner** : ***unassigned***
- **Area** : ***backend***
- **Date** : ***2026-11-06***
- **Priority** : ***P2***
- **Status** : ***Не перенесено для звичайного Markdown***

Джерело: заміна `.md/` на `.html` у `PortalSiteBuilder.writeHtmlFile`. Ціль: [TemplateContextBuilder.build/composeHref](src/services/TemplateContextBuilder.ts). Зараз лише поточний Work Manager breadcrumb має виняток із трактування як каталогу.

- [ ] Розрізняти документ і каталог за метаданими/шляхом, а не лише `isWorkManager`.
- [ ] Додати першим breadcrumb посилання «Головна» на авторську головну контенту: `index.md` у server mode та `index.html` у static mode, з урахуванням `baseUrl`. Не підміняти його маршрутом `/`, який у server mode показує directory listing.
- [ ] Якщо кореневого `index.md` немає, «Головна» веде на кореневий listing. На самій головній показувати один поточний елемент з `aria-current="page"`, без дублювання «Головна → Index».
- [ ] Перевірити корінь, вкладений `.md`, `.work-manager.md`, кириличні назви, пробіли й непорожній `baseUrl`.

Критерій завершення: з вкладеного документа й каталогу можна повернутися на авторську головну через перший breadcrumb; за відсутності авторського індексу доступний кореневий listing. Документний breadcrumb не має кінцевого `/`; static URL закінчується `.html`, server URL веде до документа; каталог зберігає `/`. Видалення regex-підміни Second Brain не змінює правильні адреси. Автотести охоплюють головну з індексом і без нього, обидва режими та `baseUrl`; браузерна перевірка підтверджує перехід і відсутність дубльованого кореневого елемента.

## KB-SYNC-05 — Перенести загальні гарантії приватного запуску та експорту

- **Purpose** : ***Однаковий захист приватних сайтів у CLI, API та згенерованому застосунку***
- **Owner** : ***unassigned***
- **Area** : ***backend***
- **Date** : ***2026-11-06***
- **Priority** : ***P1***
- **Status** : ***Частково є; application-level перевірки залишаються у Second Brain***

Джерела: [check-private-config.cjs](../second-brain/scripts/check-private-config.cjs), [server.js](../second-brain/server.js), [build.js](../second-brain/build.js). Цілі: [StaticSiteBuilder.build](src/builders/StaticSiteBuilder.ts), [CLI](src/cli/kb.ts), [server template](src/service-templates/server.template.js), `KnowledgeBase.setupSecurity` у [KnowledgeBase.ts](src/core/KnowledgeBase.ts).

- [ ] Заборонити static export для активного authentication-плагіна або плагіна `requiresAuthentication` у самому builder, до очищення output. Перевірити CLI і прямий API, а не лише application wrapper.
- [ ] Узгодити production validation без секретів у повідомленнях. Загальний framework перевіряє контракти активних плагінів; не вимагає обов’язкової трійки passwordAuth/Drive/Work Manager.
- [ ] Додати документований опціональний liveness endpoint у шаблон: `GET /healthz` → порожній 204 без авторизації; контент, assets та пошук залишаються за auth middleware.
- [ ] Переглянути `GET /search-index.json`: зараз endpoint виставляє `public, max-age=60`. Для приватного сайту перевірити фактичні заголовки після auth middleware й виключити shared-cache збереження приватного індексу.
- [ ] Перевірити явну конфігурацію reverse proxy, `PORT`, bind address та запуск шаблону; не переносити домен Second Brain або Render-specific profile як універсальні defaults.

Критерій завершення: unauthorized-запити не повертають контент; health нейтральний; неправильна приватна конфігурація не запускає публічний сайт; заборонений export не видаляє output sentinel. Наявний password-only/14-day контракт не змінюється.

## KB-SYNC-06 — Перевірити однакову поведінку пакетних entrypoints

- **Purpose** : ***Не залишити виправлення доступними лише через server.js Second Brain***
- **Owner** : ***unassigned***
- **Area** : ***infra***
- **Date** : ***2026-11-06***
- **Priority** : ***P1***
- **Status** : ***Очікує KB-SYNC-01–05***

Точки входу: [CLI](src/cli/kb.ts), [шаблони застосунку](src/service-templates), [package.json](package.json). Використовувати окремий fixture-проєкт, не робочий Second Brain.

- [ ] Зібрати `npm pack` і встановити tarball у чистий тимчасовий проєкт без доступу до source checkout.
- [ ] Перевірити `kb init`, `kb serve`, згенерований server, `kb build` та прямий `StaticSiteBuilder`.
- [ ] Підтвердити пошук українською, layout, assets, lazy loading активних плагінів, відсутність assets вимкнених плагінів і private-build guard.
- [ ] Перевірити `kb update`: користувацькі конфігурації та application CSS не втрачаються без явного вибору.

Критерій завершення: записана матриця entrypoint × режим із фактичними результатами; проходять tests/build/lint і браузерні сценарії. `npm pack` не означає публікацію npm.

## KB-SYNC-07 — Прибрати тимчасові виправлення Second Brain після оновлення

- **Purpose** : ***Залишити одну реалізацію загальної поведінки у framework***
- **Owner** : ***unassigned***
- **Area** : ***infra***
- **Date** : ***2026-11-06***
- **Priority** : ***P2***
- **Status** : ***Очікує перевірений і окремо погоджений реліз***

- [ ] Оновити точну версію залежності й lockfile Second Brain після KB-SYNC-06 та публікації за окремим запитом.
- [ ] Видалити локальний `scripts/search-index-service.cjs`, його підключення в server/build та пряму залежність `lunr`, якщо інших споживачів немає.
- [ ] Прибрати `assets/css/content-layout.css` і запис `customCssFiles`, якщо framework повністю забезпечує погоджений вигляд.
- [ ] Замінити `PortalSiteBuilder` штатним builder лише після перенесення всіх його виправлень.
- [ ] Оновити README, перевірити сайт локально; окремо записати статус Render deployment, холодного старту та Google Drive smoke test.

Критерій завершення: Second Brain працює без локальних підмін framework; project-specific auth configuration, секрети й контент збережені. Усі видалення обмежені підтверджено зайвими адаптерами.

## Що не потрібно переносити повторно

- React/lazy-loading, Tailwind/Iconify, керування деревом навігації та плагіни passwordAuth, Google Drive, Work Manager уже присутні у локальному framework. Потрібна перевірка комплектності комітів/пакета, а не повторна реалізація.
- Файли `plan.work-manager.md` для будинку й Yapidoo — контент Second Brain. До framework можна додати нейтральний приклад, але не персональні проєкти чи їхні ID.
- Погоджене правило запису Work Manager — last write wins. Цей список не повертає вимогу distributed CAS і не змінює модель конкурентності.
