# Моды для Claude Code

![версия](https://img.shields.io/badge/версия-0.0.1-c6613f) ![моды](https://img.shields.io/badge/моды-4-30302e) ![лицензия](https://img.shields.io/badge/лицензия-MIT-30302e)

Четыре мода, которые встраиваются в окно Claude Code: полоса лимитов над полем ввода, подсказка после ответа, вопрос перед опасной командой и панель Docker.

**Сайт со скриншотами и архивами:** https://petrovyuri.github.io/claude-code-mods/

![Полоса limits-cache над полем ввода](docs/img/limits-cache.png)

## Моды

| Мод | Версия | Что делает |
|---|---|---|
| [docker-manager](plugins/docker-manager#readme) | 0.0.1 | Панель Docker по команде `/docker`, как в VS Code: compose-проекты и контейнеры со стартом, остановкой, логами и удалением, образы, сети и тома |
| [limits-cache](plugins/limits-cache#readme) | 0.0.1 | Полоса над полем ввода: лимиты за 5 часов и 7 дней, время жизни кеша промпта, прогрев кеша кнопкой ↻ или сам в режиме «Авто» |
| [next-step](plugins/next-step#readme) | 0.0.1 | Кнопка «Что дальше?» под ответом: на чём остановились, что дальше и готовые сообщения на выбор |
| [panic-button](plugins/panic-button#readme) | 0.0.5 | Перед `rm -rf`, `git push --force`, `DROP TABLE` и доступом к `.env` спрашивает «Разрешить / Запретить» и объясняет, что сломается |

## Установка

Подключите каталог модов один раз:

```bash
claude plugin marketplace add petrovyuri/claude-code-mods
```

Поставьте нужный мод для всех проектов:

```bash
claude plugin install docker-manager@petrovyuri-mods --scope user
```

```bash
claude plugin install limits-cache@petrovyuri-mods --scope user
```

```bash
claude plugin install next-step@petrovyuri-mods --scope user
```

```bash
claude plugin install panic-button@petrovyuri-mods --scope user
```

В открытой сессии выполните `/reload-plugins`, новые сессии подхватят моды сами.

Обновить мод до свежей версии:

```bash
claude plugin update next-step@petrovyuri-mods
```

## Версии

У каждого мода своя версия в `plugins/<мод>/.claude-plugin/plugin.json` и свой `CHANGELOG.md`. Версии идут по [SemVer](https://semver.org/lang/ru/): исправление поднимает третью цифру, новая возможность вторую. Каждый выпуск мода помечен тегом `<мод>-v<версия>`, например `next-step-v0.0.1`.

## Как устроен репозиторий

```
.claude-plugin/marketplace.json   каталог petrovyuri-mods: какие моды есть и где лежат
plugins/<мод>/                    мод: plugin.json, hooks/, tests/, README, CHANGELOG
docs/                             сайт на GitHub Pages
.github/workflows/pages.yml       сборка сайта и zip-архивов при пуше в main
```

## Проверка

```bash
claude plugin validate .
```

```bash
claude plugin test plugins/next-step
```

```bash
node --test docs/site.test.mjs
```

## Лицензия

[MIT](LICENSE): моды можно свободно использовать, менять и распространять, если сохранить уведомление об авторских правах.

## Отказ от ответственности

**Неофициальные моды, не связаны с Anthropic.** Моды поставляются «как есть» (as is), без каких-либо гарантий. Автор не несёт ответственности за последствия их использования, в том числе за потерю данных, расход лимитов или денег. Вы ставите и используете моды на свой риск.
