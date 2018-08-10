/*
  Собираем все items в один конфиг из всех файлов
*/

const MODULES = [
  '1-30',
  '31-40',
  '41-70',
  '71-90',
  '91-120'
]

let allItems = {}
for (let name of MODULES) {
  let items = require(`./${name}`)
  for (let id in items) {
    allItems[id] = items[id]
  }
}

module.exports = allItems
