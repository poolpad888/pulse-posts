import http from 'node:http';

const KEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-4o';

/* ---------- ТАБЛИЦА ТИКЕРОВ ---------- */
const TICKERS = {
  'Сбербанк':'SBER','Сбер':'SBER','ВТБ':'VTBR','Т-Технологии':'T',
  'Совкомбанк':'SVCB','Банк Санкт-Петербург':'BSPB','МКБ':'CBOM',
  'Московская биржа':'MOEX','Мосбиржа':'MOEX','Ренессанс страхование':'RENI',
  'АФК Система':'AFKS','Система':'AFKS',
  'Газпром':'GAZP','Лукойл':'LKOH','Роснефть':'ROSN','Татнефть':'TATN',
  'Татнефть преф':'TATNP','Сургутнефтегаз':'SNGS','Сургутнефтегаз преф':'SNGSP',
  'НОВАТЭК':'NVTK','Газпром нефть':'SIBN','Транснефть преф':'TRNFP',
  'Норникель':'GMKN','Норильский никель':'GMKN','Полюс':'PLZL',
  'ЮГК':'UGLD','Южуралзолото':'UGLD','Селигдар':'SELG',
  'Северсталь':'CHMF','НЛМК':'NLMK','ММК':'MAGN','АЛРОСА':'ALRS',
  'РУСАЛ':'RUAL','Эн+':'ENPG','ФосАгро':'PHOR','Распадская':'RASP','Мечел':'MTLR',
  'Яндекс':'YDEX','Ozon':'OZON','Озон':'OZON','VK':'VKCO','Позитив':'POSI',
  'Астра':'ASTR','Софтлайн':'SOFL','Вуш':'WUSH','Хэдхантер':'HEAD',
  'Магнит':'MGNT','Лента':'LENT','X5':'X5','МТС':'MTSS','Ростелеком':'RTKM',
  'Мать и дитя':'MDMG',
  'Интер РАО':'IRAO','РусГидро':'HYDR','Россети':'FEES','Юнипро':'UPRO',
  'Аэрофлот':'AFLT','Совкомфлот':'FLOT','НМТП':'NMTP','ПИК':'PIKK',
  'Самолёт':'SMLT','ЛСР':'LSRG','Сегежа':'SGZH',
  'Индекс МосБиржи':'IMOEX','Индекс РТС':'RTSI',
  'Доллар к рублю (спот)':'USD000UTSTOM','Юань к рублю (спот)':'CNYRUB_TOM'
};

/* ---------- ФЬЮЧЕРСЫ: АВТОПОДБОР БЛИЖАЙШЕГО ---------- */
const FUT_ASSETS = {
  oilBrent: { codes:['BR'],            label:'нефть Brent'      },
  gas:      { codes:['NG'],            label:'природный газ'    },
  gold:     { codes:['GOLD','GD'],     label:'золото'           },
  silver:   { codes:['SILV','SV'],     label:'серебро'          },
  usd:      { codes:['Si','SI'],       label:'доллар/рубль'     },
  cny:      { codes:['CNY'],           label:'юань/рубль'       }
};

let FUT_CACHE = { at:0, map:{} };

async function loadFutures(){
  if(Date.now() - FUT_CACHE.at < 6*3600*1000 && Object.keys(FUT_CACHE.map).length)
    return FUT_CACHE.map;

  const map = {};
  try{
    const url = 'https://iss.moex.com/iss/engines/futures/markets/forts/securities.json'
      + '?iss.meta=off&iss.only=securities'
      + '&securities.columns=SECID,SHORTNAME,LASTTRADEDATE,ASSETCODE';
    const r = await fetch(url);
    if(r.ok){
      const j = await r.json();
      const b = j.securities;
      const iSec = b.columns.indexOf('SECID');
      const iNam = b.columns.indexOf('SHORTNAME');
      const iExp = b.columns.indexOf('LASTTRADEDATE');
      const iAss = b.columns.indexOf('ASSETCODE');

      const cut = Date.now() + 2*24*3600*1000;

      for(const key of Object.keys(FUT_ASSETS)){
        const codes = FUT_ASSETS[key].codes;
        const rows = b.data
          .filter(r2 => codes.includes(r2[iAss]))
          .map(r2 => ({
            sec: r2[iSec],
            name: r2[iNam],
            exp: new Date(r2[iExp]).getTime()
          }))
          .filter(x => x.sec && x.exp && x.exp > cut)
          .sort((a,c) => a.exp - c.exp);

        if(rows.length) map[key] = rows[0];
      }
    }
  }catch(e){}

  if(Object.keys(map).length){ FUT_CACHE = { at:Date.now(), map }; }
  return map;
}

/* ---------- НОВОСТНЫЕ ЛЕНТЫ ---------- */
const RSS = [
  'https://rssexport.rbc.ru/rbcnews/news/30/full.rss',
  'https://www.finam.ru/net/analysis/conews/rsspoint',
  'https://www.interfax.ru/rss.asp'
];

const TOPICS = {
  oil:   ['нефт','brent','urals','газ','опек','opec','ормуз','баррел'],
  gold:  ['золот','серебр','драгметалл','унци','бессент','трежерис'],
  fx:    ['рубл','доллар','юан','валют','курс','цб рф','ключевая ставка','экспортёр','экспортер'],
  index: ['индекс','мосбирж','ммвб','ртс','акци','дивиденд','дискретн','аукцион','торги приостановлен']
};

function strip(s){
  return String(s)
    .replace(/<!\[CDATA\[|\]\]>/g,'')
    .replace(/<[^>]+>/g,'')
    .replace(/&quot;/g,'"').replace(/&amp;/g,'&')
    .replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'')
    .trim();
}

async function feed(url){
  try{
    const r = await fetch(url, { headers:{'User-Agent':'Mozilla/5.0'} });
    if(!r.ok) return [];
    const xml = await r.text();
    const items = xml.split(/<item[\s>]/i).slice(1, 80);
    return items.map(it=>{
      const t = it.match(/<title>([\s\S]*?)<\/title>/i);
      const d = it.match(/<description>([\s\S]*?)<\/description>/i);
      const p = it.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
      const ts = p ? new Date(strip(p[1])).getTime() : NaN;
      return {
        title: t ? strip(t[1]) : '',
        desc:  d ? strip(d[1]).slice(0,300) : '',
        ts:    isNaN(ts) ? null : ts
      };
    }).filter(x=>x.title);
  }catch(e){ return []; }
}

async function news(topic, extra){
  const all = (await Promise.all(RSS.map(feed))).flat();
  const keys = (TOPICS[topic] || []).concat(extra || []);

  const match = all.filter(n=>{
    const s = (n.title+' '+n.desc).toLowerCase();
    return keys.some(k=>s.includes(k));
  });

  const now = Date.now();
  const win = h => match.filter(n => n.ts && now - n.ts <= h*3600*1000);

  let list = win(12);
  let note = 'свежие, за последние 12 часов';

  if(list.length < 3){
    list = win(24);
    note = 'за последние 24 часа';
  }
  if(list.length < 3){
    list = match;
    note = 'свежих новостей по теме мало, лента без ограничения по времени';
  }

  list.sort((a,b) => (b.ts||0) - (a.ts||0));

  const body = list.slice(0,18).map(n=>{
    const when = n.ts ? new Date(n.ts).toISOString().slice(11,16)+' UTC' : 'время неизвестно';
    return `— [${when}] ${n.title}${n.desc ? ' :: '+n.desc : ''}`;
  }).join('\n');

  return `(${note})\n` + (body || 'новостей по теме не найдено');
}

/* ---------- КОТИРОВКИ ---------- */
const ISS='https://iss.moex.com/iss/engines/';
const PATHS = t => [
  `stock/markets/shares/boards/TQBR/securities/${t}.json`,
  `stock/markets/index/boards/SNDX/securities/${t}.json`,
  `futures/markets/forts/boards/RFUD/securities/${t}.json`,
  `currency/markets/selt/boards/CETS/securities/${t}.json`,
  `stock/markets/shares/securities/${t}.json`
];

function pick(b,names){
  if(!b||!b.data||!b.data.length) return null;
  for(const n of names){
    const i=b.columns.indexOf(n);
    if(i>-1 && b.data[0][i]!=null) return b.data[0][i];
  }
  return null;
}

async function quote(t){
  for(const p of PATHS(t)){
    try{
      const r=await fetch(ISS+p+'?iss.meta=off&iss.only=marketdata,securities');
      if(!r.ok) continue;
      const j=await r.json();

      const live = pick(j.marketdata,['LAST','CURRENTVALUE','LASTVALUE','LCURRENTPRICE'])
                ?? pick(j.marketdata,['MARKETPRICETODAY','WAPRICE']);
      const prev = pick(j.securities,['PREVPRICE','PREVSETTLEPRICE','PREVLEGALCLOSEPRICE']);
      const c    = pick(j.marketdata,['LASTCHANGEPRCNT','LASTTOPREVPRICE']);
      const n    = pick(j.securities,['SHORTNAME','SECNAME','NAME']);

      if(live!=null) return { t, name:n||t, v:+live, c:c==null?null:+c, stale:false };
      if(prev!=null) return { t, name:n||t, v:+prev, c:null, stale:true };
    }catch(e){}
  }
  return { t, name:t, v:null, c:null, stale:true };
}

const fmt = q => {
  if(q.v==null) return `${q.t}: данных нет — в тексте НЕ упоминать`;
  if(q.stale)   return `${q.t} (${q.name}): свежей цены нет, торги приостановлены или идёт дискретный аукцион. ${q.v} — это ЗАКРЫТИЕ ПРЕДЫДУЩЕГО ДНЯ, НЕ текущая цена. Так и написать.`;
  return `${q.t} (${q.name}): ${q.v}${q.c==null?'':', изменение '+q.c+'%'}`;
};

/* ---------- ПРАВИЛА ---------- */
const TICKER_TABLE = Object.entries(TICKERS)
  .map(([k,v]) => `${k} = $${v}`).join('\n');

const RULES = `Ты пишешь посты для соцсети Пульс от лица частного инвестора.

Формат:
— Первая строка — заголовок капсом с эмодзи.
— Текст разбит на блоки с эмодзи-подзаголовками, много эмодзи.
— Последняя строка — вопрос к читателям и эмодзи 👇.
— Объём 900–1600 знаков.

КРИТИЧЕСКИ ВАЖНО про тикеры:
— Каждый упомянутый инструмент ОБЯЗАН сопровождаться тикером со знаком доллара без скобок: $TATN, $SBER.
— Тикеры брать СТРОГО из переданной таблицы и из переданных котировок. Своих не придумывать и не переводить названия в латиницу самостоятельно.
— Если инструмента нет ни в таблице, ни в котировках — упоминать его БЕЗ тикера.
— Для фьючерсов использовать ровно тот код, который передан в котировках. Это ближайший контракт, он меняется со временем.

КРИТИЧЕСКИ ВАЖНО про цифры:
— Использовать ТОЛЬКО переданные котировки. Ничего не досчитывать и не выдумывать.
— Если сказано, что свежей цены нет, — прямо написать про приостановку торгов или дискретный аукцион и указать, что цена вчерашняя. НИКОГДА не выдавать её за текущую и не писать "без изменений".
— Если данных нет вообще — инструмент не упоминать.

КРИТИЧЕСКИ ВАЖНО про рекомендации:
— НЕ давать инвестиционных советов. Не писать "покупать", "продавать", "держать", "стоит присмотреться", "хорошая точка входа", не называть целевых цен.
— Задача поста — объяснить, что произошло и почему. Выводы читатель делает сам.
— Вместо совета уместно показать, какие факторы будут двигать инструмент дальше и на что смотреть.

КРИТИЧЕСКИ ВАЖНО про подзаголовки:
— Подзаголовки придумывать заново под конкретную новость, живым языком.
— ЗАПРЕЩЕНЫ шаблонные подзаголовки вида "Факты с цифрами", "Что происходит", "Почему это происходит", "Что это значит для инвестора". Посты одного выпуска не должны иметь ни одного совпадающего подзаголовка.
— Структура блоков тоже разная: где-то начать со сцены, где-то с цифры, где-то с вопроса. Посты должны читаться как написанные в разном настроении.

Ещё ты придумываешь сцену для картинки: один абзац на английском, символическая сцена с главным персонажем в центре и множеством деталей на фоне. Серьёзная газетная иллюстрация, взрослые реалистичные люди, без мультяшности. Без текста и букв в кадре.

ТАБЛИЦА ТИКЕРОВ:
${TICKER_TABLE}`;

async function write(task, quotes, feedText){
  const r = await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+KEY},
    body:JSON.stringify({
      model: MODEL,
      temperature: 0.85,
      response_format: { type:'json_object' },
      messages:[
        { role:'system', content: RULES },
        { role:'user', content:
`Задача: ${task}

Текущее время: ${new Date().toISOString()}

Котировки Московской биржи (задержка 15 минут):
${quotes}

Заголовки новостей ${feedText}

Верни строго JSON без markdown:
{"title":"короткий заголовок поста","text":"полный текст поста","scene":"english scene description"}` }
      ]
    })
  });
  const j = await r.json();
  if(j.error) throw new Error(j.error.message);
  return JSON.parse(j.choices[0].message.content);
}

/* ---------- СЕРВЕР ---------- */
const server = http.createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');

  if(req.method==='OPTIONS'){ res.writeHead(204).end(); return; }
  if(req.method!=='POST'){ res.writeHead(200).end('pulse-brain alive'); return; }

  let body='';
  req.on('data',c=>body+=c);
  req.on('end', async ()=>{
    try{
      const { mode, ticker } = JSON.parse(body||'{}');

      if(mode === 'asset'){
        const t = String(ticker||'').toUpperCase().replace(/[^A-Z0-9_]/g,'');
        if(!t) throw new Error('не указан тикер');
        const q = await quote(t);
        const f = await news('index', [String(q.name||'').toLowerCase(), t.toLowerCase()]);
        const p = await write(`Пост про актив ${t}. Что с ним происходит прямо сейчас и почему.`, fmt(q), f);
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({ posts:[{ ...p, cat:'stock' }] }));
        return;
      }

      const F = await loadFutures();
      const fut = k => F[k] ? F[k].sec : null;
      const some = arr => arr.filter(Boolean);

      const setOil  = some([fut('oilBrent'), fut('gas')]);
      const setGold = some([fut('gold'), fut('silver'), 'PLZL', 'UGLD']);
      const setFx   = some(['USD000UTSTOM', 'CNYRUB_TOM', fut('usd'), fut('cny')]);
      const setIdx  = ['IMOEX','RTSI','SBER','GAZP','LKOH','GMKN','TATN','OZON'];

      const [qOil, qGold, qFx, qIdx] = await Promise.all([
        Promise.all(setOil.map(quote)),
        Promise.all(setGold.map(quote)),
        Promise.all(setFx.map(quote)),
        Promise.all(setIdx.map(quote))
      ]);

      const [nOil, nGold, nFx, nIdx] = await Promise.all([
        news('oil'), news('gold'), news('fx'), news('index')
      ]);

      const jobs = [
        ['oil',   'Пост про нефть и природный газ на текущий момент.', qOil,  nOil],
        ['gold',  'Пост про золото и серебро на текущий момент.',      qGold, nGold],
        ['fx',    'Пост про курс рубля к доллару и юаню на текущий момент — что двигает валюту.', qFx, nFx],
        ['index', 'Пост про индекс МосБиржи, РТС и главные акции момента — кто растёт, кто падает и почему.', qIdx, nIdx]
      ];

      const posts = [];
      for(const [cat, task, qs, nf] of jobs){
        const p = await write(task, qs.map(fmt).join('\n'), nf);
        posts.push({ ...p, cat });
      }

      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ posts }));

    }catch(e){
      res.writeHead(500,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(process.env.PORT || 10000);
