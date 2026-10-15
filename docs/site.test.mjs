// Страница модов совпадает с marketplace: у каждого мода есть карточка, команда установки и архив.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const html = readFileSync(new URL('docs/index.html', root), 'utf8')
const marketplace = JSON.parse(readFileSync(new URL('.claude-plugin/marketplace.json', root), 'utf8'))
const mods = marketplace.plugins.map(plugin => plugin.name)

test('у каждого мода из marketplace есть карточка', () => {
  for (const mod of mods) {
    assert.match(html, new RegExp(`<article class="mod[^"]*" id="${mod}" data-mod="${mod}">`), mod)
  }
})

test('на странице нет модов, которых нет в marketplace', () => {
  const shown = [...html.matchAll(/data-mod="([^"]+)"/g)].map(match => match[1])
  assert.deepEqual(shown.sort(), [...mods].sort())
})

test('у каждого мода есть команда установки и ссылка на архив', () => {
  for (const mod of mods) {
    assert.ok(html.includes(`claude plugin install ${mod}@${marketplace.name} --scope user`), mod)
    assert.ok(html.includes(`href="downloads/${mod}.zip"`), mod)
  }
})

test('версия на странице совпадает с plugin.json и marketplace', () => {
  for (const plugin of marketplace.plugins) {
    const manifest = JSON.parse(readFileSync(new URL(`${plugin.source.replace('./', '')}/.claude-plugin/plugin.json`, root), 'utf8'))
    assert.equal(plugin.version, manifest.version, plugin.name)
    assert.match(html, new RegExp(`<h2>${plugin.name} <span class="ver">v${manifest.version.replaceAll('.', '\.')}</span></h2>`), plugin.name)
  }
})

test('у каждого мода есть README и CHANGELOG с текущей версией', () => {
  for (const plugin of marketplace.plugins) {
    const dir = plugin.source.replace('./', '')
    assert.ok(existsSync(new URL(`${dir}/README.md`, root)), `${plugin.name}: README`)
    const changelog = readFileSync(new URL(`${dir}/CHANGELOG.md`, root), 'utf8')
    assert.ok(changelog.includes(`## ${plugin.version}`), `${plugin.name}: CHANGELOG`)
  }
})

test('у каждого мода есть скриншот', () => {
  for (const mod of mods) {
    const start = html.indexOf(`id="${mod}" data-mod="${mod}"`)
    const card = html.slice(start, html.indexOf('</article>', start))
    assert.match(card, /<figure class="shot[" ]/, mod)
  }
})

test('только тёмная тема', () => {
  assert.match(html, /:root \{\s*color-scheme: dark;/)
  assert.ok(!html.includes('data-theme'), 'светлой темы и переключателя быть не должно')
  assert.ok(!html.includes('prefers-color-scheme'), 'тема не должна зависеть от настроек системы')
})

test('страница не выдаёт себя за официальную', () => {
  assert.ok(html.includes('Неофициальные моды, не связаны с Anthropic.'))
})

test('картинки на странице лежат в docs/', () => {
  for (const [, src] of html.matchAll(/<img src="([^"]+)"/g)) {
    assert.ok(existsSync(new URL(`docs/${src}`, root)), src)
  }
})
