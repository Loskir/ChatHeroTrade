/*
  Собираем все potions в один конфиг из всех файлов
*/

const MODULES = [
  '1-30'
]

let allItems = {}
for (let name of MODULES) {
  let items = require(`./${name}`)
  for (let id in items) {
    allItems[id] = items[id]
  }
}

module.exports = allItems
