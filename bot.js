const tokens = require('./tokens.js');
const host = 'https://api.chatherobot.ru';
// const host = 'https://chathero.ru';

const Telegraf = require('telegraf');
const rp = require('request-promise');
const PM = require('promise-mongo');
const fs = require('mz/fs');

const items_prices = require('./data/items/index.js');
const items = require('./data/item.js');
const equip = require('./data/equip.js');
const equip_prices = {};
fs.readdir('./data/equip')
    .then(v => {
        v.map(i => fs.readFile('./data/equip/'+i).then(f => {
            equip_prices[i.slice(0, -5)] = JSON.parse(f)
        }))
    });

const bot = new Telegraf(tokens.bot);

const pm = new PM();
let db, cur;
pm.initDb(['users', 'players', 'trades'], 'mongodb://127.0.0.1:27017/ChatHeroTrade')
    .then(() => {
        console.log('Done');
        db = pm.cols;
        cur = pm.cur;
    });

let getPlayerByToken = t => new Promise(res => rp(`${host}/api/${tokens.api}/exchange/resources?accessToken=${t}`)
    .then(v => {res(JSON.parse(v))})
    .catch(v => {
        try {res(JSON.parse(v.error))}
        catch(e) {console.log(v.error, e)}
    }));
let getPlayers = async () => {
    let players = await db.players.find().then(cur.toArray);
    players.filter(v => v.expirationTimestamp <= Date.now()).forEach(v => db.players.deleteOne(v));
    return players.filter(v => v.expirationTimestamp > Date.now())
};

const selectedIcon = '🔹';
const str = {
    noToken: 'Действующий токен не найден. Зайди сюда через @ChatHeroBot',
    tokenExpired: 'Возможно, твое разрешение на торговлю просрочилось. Получи новое в @ChatHeroBot',
    confirmTrade: 'Теперь подтверди сделку в @ChatHeroBot',
    nobodyHere: 'Что-то в лавке совсем никого нет. Подожди, пока кто-нибудь придет, и попробуй снова.',
    playerGone: 'Что-то пошло не так... возможно, игрок уже ушел',
    smthWentWrong: 'Что-то пошло не так...',
    tradeNotFound: 'Что-то пошло не так, сделка не найдена'
};
const tradeModes = ['inline', 'commands'];

let getS = s => s === 'm' ? '👱' : s === 'f' ? '👩' : '🚷';
let getName = p => getS(p.sex)+p.name;
let ib = (text, callback_data) => ({text, callback_data});
const updateKeyboard = [[ib('🔄 Обновить', 'update')]];
let getPlayersKeyboard = players => [
    ...players.map(v => [ib(getName(v.player), 'id_'+v._id)]),
    ...updateKeyboard
];
let getTradeKeyboard = (trade_id, i, p, selectedId, tab) => {
    let selected = id => id === selectedId ? selectedIcon : '';
    let kb = [
        
        ...[p.money].filter(v => v > 0).map(() => [ib(selected('money')+getItemName('money'), `select_${i}_${trade_id}_money`)]),
        ...Object.keys(p.items).map(v => {
            let id = 'items.'+v;
            return [ib(selected(id)+getItemName(id), `select_${i}_${trade_id}_${id}`)]
        }),
        ...Object.keys(p.equip).map(v => {
            let id = 'equip.'+v;
            return [ib(selected(id)+getItemName(id), `select_${i}_${trade_id}_${id}`)]
        }),
    ];
    let maxtab = Math.ceil(kb.length/10);
    return [
        [
            // ib('-1000', `edit_${i}_${trade_id}_-1000`),
            ib('-100', `edit_${i}_${trade_id}_-100`),
            ib('-10', `edit_${i}_${trade_id}_-10`),
            ib('-1', `edit_${i}_${trade_id}_-1`),
            ib('+1', `edit_${i}_${trade_id}_1`),
            ib('+10', `edit_${i}_${trade_id}_10`),
            ib('+100', `edit_${i}_${trade_id}_100`),
            // ib('+1000', `edit_${i}_${trade_id}_1000`)
        ],
        ...kb.slice((tab-1)*10, tab*10),
        ...[kb.length].filter(v => v > 10).map(v => [
            ib('<', `tab_${i}_${trade_id}_${Math.max(tab-1, 1)}`),
            ib(`${tab}/${maxtab}`, `tab_${i}_${trade_id}_${tab}`),
            ib('>', `tab_${i}_${trade_id}_${Math.min(tab+1, maxtab)}`),
        ]),
        [ib('✅Готов', `ready_${i}_${trade_id}`)]
    ];
};
let getItemName = i => {
    if (i === 'money') return '💰';
    let s = i.split('.');
    if (s[0] === 'items') return items[parseInt(s[1])];
    if (s[0] === 'equip') {
        let t = s[1].split('_');
        return equip[t[0]][t[1]]
    }
    return '❓'+i
};
let getItemPrice = i => {
    if (i === 'money') return 1;
    let s = i.split('.');
    if (s[0] === 'items') return items_prices[s[1]].price;
    if (s[0] === 'equip') {
        let t = s[1].split('_');
        return equip_prices[t[0]][t[1]].price;
    }
};
let getPlayerTradeItemsText = t => {
    let arr = [
        ...[t.money || 0].filter(v => v > 0).map(v => `<b>${getItemName('money')}</b>${v}`),
        ...Object.keys(t.items).filter(v => t.items[v] > 0).map(v => `<b>${getItemName('items.'+v)}</b> ${t.items[v]}`),
        ...Object.keys(t.equip).filter(v => t.equip[v] > 0).map(v => `<b>${getItemName('equip.'+v)}</b> ${t.equip[v]}`)
    ];
    return {
        text: arr.length === 0 ? 'Ничего' : arr.join('\n'),
        empty: arr.length === 0
    }
};
let getPlayerTradePrice = t => {
    return getItemPrice('money')*t.money
        + Object.keys(t.items).map(v => getItemPrice('items.'+v)*t.items[v]).reduce((a, v) => a+v, 0)
        + Object.keys(t.equip).map(v => getItemPrice('equip.'+v)*t.equip[v]).reduce((a, v) => a+v, 0)
};
let getPlayerTradeText = t => {
    let tradeText = getPlayerTradeItemsText(t);
    return tradeText.text + (tradeText.empty ? '' : `\n\nОбщая стоимость: ${getItemName('money')}${getPlayerTradePrice(t)}`);
};
let getTradeText = t => `Ты предлагаешь:
${getPlayerTradeText(t)}`;

let getPlayerConfirmText = (p, t) => {
    let text = getPlayerTradeItemsText(t);
    return `${getName(p)} предлагает:
${text.text}${text.empty ? '' : `\nОбщая стоимость: ${getItemName('money')}${getPlayerTradePrice(t)}`}`
};
let getConfirmText = (p1, t1, p2, t2) => {
    return `${getPlayerConfirmText(p1, t1)}

${getPlayerConfirmText(p2, t2)}

Всё верно?`
};
let getConfirmKeyboard = (trade_id, i) => [[ib('✅Да', `confirm_${i}_${trade_id}`), ib('❌Нет', `cancel_${i}_${trade_id}`)]];

let getSettingsKeyboard = settings => [
    [ib(`Режим торговли: ${tradeModes[settings.tradeMode]}`, `set_tradeMode_${(settings.tradeMode+1) % tradeModes.length}`)]
]

let timeouts = [];

bot
    .use(async (ctx, next) => {
        let user = await db.users.findOne({id: ctx.from.id});
        if (!user) {
            let u = {
                id: ctx.from.id,
                settings: {
                    tradeMode: 0
                }
            };
            let r = await db.users.insertOne(u);
            u._id = r.insertedId;
            ctx.state.user = u;
        }
        else ctx.state.user = user;
        next()
    })
    .settings(async ctx => {
        ctx.reply('Здесь ты можешь изменить настройки', {
            reply_markup: {
                inline_keyboard: getSettingsKeyboard(ctx.state.user.settings)
            }
        })
    })
    .action(/^set_(.+)_(.+)$/, async ctx => {
        let [, prop, val] = ctx.match;
        switch(prop) {
            case 'tradeMode':
                val = parseInt(val);
                break
        }
        db.users.updateOne({_id: ctx.state.user._id}, {$set: {[`settings.${prop}`]: val}});
        ctx.state.user.settings[prop] = val;
        ctx.editMessageReplyMarkup({inline_keyboard: getSettingsKeyboard(ctx.state.user.settings)})
    })
    .start(async ctx => {
        let player;
        let players = await getPlayers();
        if (ctx.message.text === '/start') {
            player = players.find(v => v.id === ctx.from.id);
            if (!player) {
                ctx.reply(str.noToken);
                return;
            }
            player = player.player;
            players = players.filter(v => v.id !== ctx.from.id)
        }
        else {
            let token = ctx.message.text.substring(7);
            
            player = await getPlayerByToken(token);
            if (!player.success) {
                console.error(player);
                ctx.reply(str.smthWentWrong+'\n'+player.message);
                return
            }
            
            if (player.id !== ctx.from.id) {
                ctx.reply('Ты не тот, за кого себя выдаешь...');
                return
            }
            
            players = players.filter(v => v.id !== ctx.from.id);
            db.players.deleteMany({id: ctx.from.id})
                .then(r => db.players.insertOne({
                    id: ctx.from.id,
                    token,
                    player,
                    expirationTimestamp: Date.now() + player.ttl*1000}))
                .then(r => timeouts.push({
                    id: ctx.from.id,
                    timeout: setTimeout(() => {
                        db.players.deleteOne({_id: r.insertedId});
                        timeouts.splice(timeouts.findIndex(v => v.id === ctx.from.id))
                    }, player.ttl*1000)
                }));
        }
        
        let text = `Ну что ж, привет, ${getName(player)}\n\n`;
        
        if (players.length === 0) {
            ctx.reply(text+str.nobodyHere, {reply_markup: {inline_keyboard: updateKeyboard}});
            return;
        }
        ctx.reply(text+'С кем будем торговаться?', {reply_markup: {inline_keyboard: getPlayersKeyboard(players)}});
    })
    .action('update', async ctx => {
        let players = await getPlayers();
        
        let player = players.find(v => v.id === ctx.from.id);
        if (!player) {
            ctx.editMessageText(str.noToken);
            return;
        }
        players = players.filter(v => v.id !== ctx.from.id);
        
        let text = `Ну что ж, привет, ${getName(player.player)}\n\n`;
        
        ctx.answerCbQuery('Щелк!');
        if (players.length === 0) {
            text += str.nobodyHere;
            ctx.editMessageText(text, {reply_markup: {inline_keyboard: updateKeyboard}}).catch();
            return;
        }
        ctx.editMessageText(text+'С кем будем торговаться?', {reply_markup: {inline_keyboard: getPlayersKeyboard(players)}}).catch();
    })
    .action(/^id_(.+)$/, async ctx => {
        let players = await getPlayers();
        let p1 = players.find(v => v.id === ctx.from.id);
        if (!p1) {
            ctx.answerCbQuery(str.tokenExpired);
            ctx.editMessageReplyMarkup();
            return;
        }
        let p2 = await db.players.findOne({_id: pm.mongo.ObjectId(ctx.match[1])});
        if (!p2) {
            ctx.answerCbQuery(str.playerGone);
            ctx.editMessageReplyMarkup({inline_keyboard: getPlayersKeyboard(players.filter(v => v.id !== ctx.from.id))});
            return
        }
        ctx.telegram.sendMessage(p2.id, `К тебе подошел ${getName(p1.player)} и предложил свой товар.`, {
            reply_markup: {
                inline_keyboard: [
                    [{text: 'Начать торговлю', callback_data: `start_accept_${p1._id}`}],
                    [{text: 'Отказаться', callback_data: `start_decline_${p1._id}`}]
                ]
            }
        });
        ctx.answerCbQuery(`Ждем ответа...`);
        ctx.editMessageText(`Ждем ответа от ${getName(p2.player)}...`)
    })
    .action(/^start_(accept|decline)_(.+)$/, async ctx => {
        let players = await getPlayers();
        let p1 = players.find(v => v.id === ctx.from.id);
        if (!p1) {
            ctx.answerCbQuery(str.tokenExpired);
            ctx.editMessageReplyMarkup();
            return;
        }
        let p2 = players.find(v => v._id.toString() === ctx.match[2]);
        if (!p2) {
            ctx.answerCbQuery(str.playerGone);
            ctx.editMessageReplyMarkup({inline_keyboard: getPlayersKeyboard(players.filter(v => v.id !== ctx.from.id))});
            return
        }
        ctx.editMessageReplyMarkup();
        if (ctx.match[1] === 'decline') {
            ctx.answerCbQuery('Ты прогнал незваного торговца');
            ctx.deleteMessage();
            ctx.telegram.sendMessage(p2.id, `${getName(p1.player)} отказался торговаться с тобой`)
        }
        else {
            ctx.answerCbQuery(`Начинается торговля с ${getName(p2.player)}`);
            ctx.telegram.sendMessage(p2.id, `Начинается торговля с ${getName(p1.player)}`);
            let t = {money: 0, items: {}, equip: {}};
            // let trade = await db.trades.insertOne({p1: p1._id, p2: p2._id, t1, t2, selected: {}, tab: {'1': 1, '2': 1}});
            let trade = await db.trades.insertOne({
                p: {
                    '1': p1._id,
                    '2': p2._id
                },
                t: {
                    '1': t,
                    '2': t
                },
                selected: {},
                tab: {
                    '1': 1,
                    '2': 1
                }
            });
            ctx.reply(getTradeText(t), {
                parse_mode: 'HTML',
                reply_markup: {inline_keyboard: getTradeKeyboard(trade.insertedId, 1, p1.player, undefined, 1)}
            });
            ctx.telegram.sendMessage(p2.id, getTradeText(t), {
                parse_mode: 'HTML',
                reply_markup: {inline_keyboard: getTradeKeyboard(trade.insertedId, 2, p2.player, undefined, 1)}
            });
        }
    })
    .action(/^select_(\d)_(.+?)_(.+)$/, async ctx => {
        let [, index, trade_id, item_id] = ctx.match;
        
        let trade = await db.trades.findOne({_id: pm.mongo.ObjectId(trade_id)});
        if (!trade) {
            ctx.answerCbQuery(str.tradeNotFound);
            return
        }
        
        let players = await getPlayers();
        let player_id = trade.p[index];
        
        let p = players.find(v => v._id.toString() === player_id.toString());
        if (!p) {
            ctx.answerCbQuery(str.tokenExpired);
            ctx.editMessageReplyMarkup();
            return;
        }
        ctx.editMessageText(getTradeText(trade.t[index]), {
            parse_mode: 'HTML',
            reply_markup: {inline_keyboard: getTradeKeyboard(trade_id, index, p.player, item_id, trade.tab[index])}
        });
        db.trades.updateOne({_id: pm.mongo.ObjectId(trade_id)}, {$set: {['selected.'+index]: item_id}})
            .then(r => {
                if (r.result.n > 0) ctx.answerCbQuery('Выбран '+getItemName(item_id));
                else {
                    ctx.answerCbQuery(str.smthWentWrong);
                    console.log(r.result)
                }
            })
    })
    .action(/^edit_(\d)_(.+?)_([\d\.-]+)$/, async ctx => {
        let [, index, trade_id, count] = ctx.match;
        count = parseInt(count);
        
        let trade = await db.trades.findOne({_id: pm.mongo.ObjectId(trade_id)});
        if (!trade) {
            ctx.answerCbQuery(str.tradeNotFound);
            return
        }
        let t = trade.t[index];
        
        let item_id = trade.selected[index];
        if (!item_id) {
            ctx.answerCbQuery('Сначала выбери что-нибудь');
            return
        }
        
        let players = await getPlayers();
        let player_id = trade.p[index];
        
        let p = players.find(v => v._id.toString() === player_id.toString());
        if (!p) {
            ctx.answerCbQuery(str.tokenExpired);
            ctx.editMessageReplyMarkup();
            return;
        }
        
        let curr;
        if (item_id === 'money') curr = t.money || 0;
        else curr = t[item_id.split('.')[0]][item_id.split('.')[1]] || 0;
        
        let max;
        if (item_id === 'money') max = p.player.money;
        else max = p.player[item_id.split('.')[0]][item_id.split('.')[1]];
        
        let total = Math.min(Math.max(0, curr+count), max);
        let delta = total - curr;
        
        await db.trades.updateOne({_id: pm.mongo.ObjectId(trade_id)}, {$set: {[`t.${index}.${item_id}`]: total}});
        trade = await db.trades.findOne({_id: pm.mongo.ObjectId(trade_id)});
        t = trade.t[index];
        ctx.editMessageText(getTradeText(t), {
            parse_mode: 'HTML',
            reply_markup: {inline_keyboard: getTradeKeyboard(trade_id, index, p.player, trade.selected[index], trade.tab[index])}
        });
        ctx.answerCbQuery(getItemName(item_id)+' '+(delta > 0 ? '+' : '')+delta)
    })
    .action(/^tab_(\d)_(.+)_(\d+)/, async ctx => {
        let [, index, trade_id, tab] = ctx.match;
        tab = parseInt(tab);
        
        let trade = await db.trades.findOne({_id: pm.mongo.ObjectId(trade_id)});
        if (!trade) {
            ctx.answerCbQuery(str.tradeNotFound);
            return
        }
        
        let players = await getPlayers();
        let player_id = trade.p[index];
        
        let p = players.find(v => v._id.toString() === player_id.toString());
        if (!p) {
            ctx.answerCbQuery(str.tokenExpired);
            ctx.editMessageReplyMarkup();
            return;
        }
        ctx.editMessageText(getTradeText(trade.t[index]), {
            parse_mode: 'HTML',
            reply_markup: {inline_keyboard: getTradeKeyboard(trade_id, index, p.player, trade.selected[index], tab)}
        });
        db.trades.updateOne({_id: pm.mongo.ObjectId(trade_id)}, {$set: {['tab.'+index]: tab}})
            .then(r => {
                if (r.result.n > 0) ctx.answerCbQuery('Щелк!');
                else {
                    ctx.answerCbQuery(str.smthWentWrong);
                    console.log(r.result)
                }
            })
    })
    .action(/^ready_(\d)_(.+?)$/, async ctx => {
        let [, index, trade_id] = ctx.match;
        
        ctx.editMessageReplyMarkup();
        
        let trade = await db.trades.findOne({_id: pm.mongo.ObjectId(trade_id)});
        if (!trade) {
            ctx.answerCbQuery(str.tradeNotFound);
            return
        }
        let players = await getPlayers();
        let p1 = players.find(v => v._id.toString() === trade.p['1'].toString());
        if (!p1) {
            ctx.answerCbQuery(str.tokenExpired);
            return
        }
        let p2 = players.find(v => v._id.toString() === trade.p['2'].toString());
        if (!p2) {
            ctx.answerCbQuery(str.playerGone);
            return
        }
        let me = index === '1' ? p1 : p2;
        let he = index === '1' ? p2 : p1;
        if (!trade.ready) {
            ctx.editMessageText(getTradeText(trade.t[index])+'\n\nЖдем готовности твоего визави', {parse_mode: 'HTML'});
            ctx.telegram.sendMessage(he.id, `${getName(me.player)} предлагает:
${getPlayerTradeText(trade.t[index])}`, {parse_mode: 'HTML'});
            db.trades.updateOne({_id: pm.mongo.ObjectId(trade_id)}, {$set: {ready: true}});
        }
        else {
            let text = getConfirmText(p1.player, trade.t['1'], p2.player, trade.t['2']);
            ctx.reply(text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: getConfirmKeyboard(trade_id, index)
                }
            });
            ctx.telegram.sendMessage(he.id, text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: getConfirmKeyboard(trade_id, index === '1' ? '2' : '1')
                }
            });
        }
    })
    .action(/^confirm_(\d)_(.+?)$/, async ctx => {
        let [, index, trade_id] = ctx.match;
        
        let trade = await db.trades.findOne({_id: pm.mongo.ObjectId(trade_id)});
        if (!trade) {
            ctx.answerCbQuery(str.tradeNotFound);
            ctx.editMessageReplyMarkup();
            return
        }
        let players = await getPlayers();
        let p1 = players.find(v => v._id.toString() === trade.p['1'].toString());
        if (!p1) {
            ctx.answerCbQuery(str.tokenExpired);
            ctx.editMessageReplyMarkup();
            return
        }
        let p2 = players.find(v => v._id.toString() === trade.p['2'].toString());
        if (!p2) {
            ctx.answerCbQuery(str.playerGone);
            ctx.editMessageReplyMarkup();
            return
        }
        let me = index === '1' ? p1 : p2;
        let he = index === '1' ? p2 : p1;
        
        if (!trade.confirmed) {
            db.trades.updateOne({_id: pm.mongo.ObjectId(trade_id)}, {$set: {confirmed: true}});
            ctx.editMessageText('Ждем подтверждения от твоего визави');
            ctx.telegram.sendMessage(he.id, 'Твой визави подтвердил сделку')
        }
        else {
            ctx.answerCbQuery('✅ОК');
            ctx.editMessageReplyMarkup();
            
            db.players.deleteOne(p1);
            db.players.deleteOne(p2);
            
            //region фильтрация нулей
            let t = {};
            ['1', '2'].forEach(i => {
                t[i] = {};
                if (trade.t[i].money > 0) t[i].money = trade.t[i].money;
                if (Object.keys(trade.t[i].items).length > 0) {
                    t[i].items = {};
                    Object.keys(trade.t[i].items).forEach(v => {
                        if (trade.t[i].items[v] <= 0) return;
                        t[i].items[v] = trade.t[i].items[v]
                    });
                }
                if (Object.keys(trade.t[i].equip).length > 0) {
                    t[i].equip = {};
                    Object.keys(trade.t[i].equip).forEach(v => {
                        if (trade.t[i].equip[v] <= 0) return;
                        t[i].equip[v] = trade.t[i].equip[v]
                    });
                }
            });
            //endregion
            
            let payload = {
                accessToken1: p1.token,
                accessToken2: p2.token,
                player1: t['1'],
                player2: t['2']
            };
            rp({
                method: 'POST',
                uri: `${host}/api/${tokens.api}/exchange/deal`,
                body: payload,
                json: true
            })
                .then(v => {
                    ctx.reply(str.confirmTrade);
                    ctx.telegram.sendMessage(he.id, str.confirmTrade);
                })
                .catch(v => {
                    ctx.reply(str.smthWentWrong+'\n'+v.message);
                    ctx.telegram.sendMessage(he.id, str.smthWentWrong+'\n'+v.message);
                    console.log(v)
                })
        }
    })
    .action(/^cancel_(\d)_(.+?)$/, async ctx => {
        let [, index, trade_id] = ctx.match;
        
        let trade = await db.trades.findOne({_id: pm.mongo.ObjectId(trade_id)});
        if (!trade) {
            ctx.answerCbQuery(str.tradeNotFound);
            ctx.editMessageReplyMarkup();
            return
        }
        let players = await getPlayers();
        let p1 = players.find(v => v._id.toString() === trade.p['1'].toString());
        if (!p1) {
            ctx.answerCbQuery(str.tokenExpired);
            ctx.editMessageReplyMarkup();
            return
        }
        let p2 = players.find(v => v._id.toString() === trade.p['2'].toString());
        if (!p2) {
            ctx.answerCbQuery(str.playerGone);
            ctx.editMessageReplyMarkup();
            return
        }
        let me = index === '1' ? p1 : p2;
        let he = index === '1' ? p2 : p1;
        ctx.editMessageText('Ты отказался от совершения сдлелки');
        ctx.telegram.sendMessage(he.id, 'Твой визави отказался от проведения сделки. Шанс упущен...')
    })
    .help(ctx => {
        ctx.replyWithHTML(`Элизабет - обменник для @ChatHeroBot.
Позволяет быстро и просто обменять монеты, предметы и экипировку.

Написано @Loskir
Сурсы <a href="https://github.com/Loskir/ChatHeroTrade">тут</a>`)
    })
    .catch(console.log)
    .startPolling();