import http from 'node:http';

const KEY = process.env.OPENAI_API_KEY;
const MODEL = 'gpt-4o';

/* ---------- НОВОСТНЫЕ ЛЕНТЫ ---------- */
const RSS = [
  'https://rssexport.rbc.ru/rbcnews/news/30/full.rss',
  'https://www.finam.ru/net/analysis/conews/rsspoint',
  'https://www.interfax.ru/rss.asp'
];

const TOPICS = {
  oil:   ['нефт','brent','urals','газ','опек','opec','ормуз','баррел'],
  gold:  ['золот','серебр','драгметалл','унци','бессент','трежерис'],
  index: ['индекс','мосбирж','ммвб','ртс','акци','дивиденд','рубл','цб рф','ключевая ставка','дискретн','аукцион','торги приостановлен']
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
    const items = xml.split(/<item[\s>]/i).slice(1, 60);
    return items.map(it=>{
      const t = it.match(/<title>([\s\S]*?)<\/title>/i);
      const d = it.match(/<description>([\s\S]*?)<\/description>/i);
      return { title: t?strip(t[1]):'', desc: d?strip(d[1]).slice(0,300):'' };
    }).filter(x=>x.title);
  }catch(e){ return []; }
}

async function news(topic, extra){
  const all = (await Promise.all(RSS.map(feed))).flat();
  const keys = (TOPICS[topic] || []).concat(extra || []);
  const hit = all.filter(n=>{
    const s = (n.title+' '+n.desc).toLowerCase();
    return keys.some(k=>s.includes(k));
  });
  const list = hit.length ? hit : all;
  return list.slice(0,18).map(n=>'— '+n.title+(n.desc?' :: '+n.desc:'')).join('\n');
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
      const st   = pick(j.marketdata,['TRADINGSTATUS']);

      if(live!=null) return { t, name:n||t, v:+live, c:c==null?null:+c, stale:false, st };
      if(prev!=null) return { t, name:n||t, v:+prev, c:null, stale:true, st };
    }catch(e){}
  }
  return { t, name:t, v:null, c:null, stale:true, st:null };
}

const fmt = q => {
  if(q.v==null) return `${q.t}: данных нет, в тексте не упоминать`;
  if(q.stale)   return `${q.t} (${q.name}): ВНИМАНИЕ, свежей цены нет — торги, вероятно, приостановлены или идёт дискретный аукцион. Последняя известная цена ${q.v} — это ЗАКРЫТИЕ ПРЕДЫДУЩЕГО ДНЯ, НЕ текущая цена. Так и написать в посте.`;
  return `${q.t} (${q.name}): ${q.v}${q.c==null?'':', изменение '+q.c+'%'}`;
};

/* ---------- ГЕНЕРАЦИЯ ---------- */
const RULES = `Ты пишешь посты для соцсети Пульс от лица частного инвестора.
Правила:
— Тикеры пишутся со знаком доллара без скобок: $TATN, $BRU6, $PLZL.
— Много эмодзи, текст разбит на блоки с эмодзи-подзаголовками.
— Первая строка — заголовок капсом с эмодзи.
— Последняя строка — вопрос к читателям и эмодзи 👇.
— Объём 900–1600 знаков.

КРИТИЧЕСКИ ВАЖНО про цифры:
— Использовать ТОЛЬКО переданные котировки. Ничего не досчитывать и не выдумывать.
— Если про инструмент сказано, что свежей цены нет, — прямо написать, что торги приостановлены или идёт дискретный аукцион, и указать, что названная цена это закрытие прошлого дня. НИКОГДА не выдавать вчерашнюю цену за сегодняшнюю и не писать "без изменений".
— Если данных по инструменту нет вообще — не упоминать его.

КРИТИЧЕСКИ ВАЖНО про подзаголовки:
— Подзаголовки блоков придумывать заново под конкретную новость, живым языком.
— ЗАПРЕЩЕНЫ шаблонные подзаголовки вида "Факты с цифрами", "Что происходит", "Почему это происходит", "Что это значит для инвестора". Три поста одного выпуска не должны иметь ни одного совпадающего подзаголовка.
— Структура блоков тоже разная: где-то начать с человеческой сцены, где-то с цифры, где-то с вопроса. Пост про нефть, пост про металлы и пост про индекс должны читаться как написанные в разном настроении.

Ещё ты придумываешь сцену для картинки: один абзац на английском, символическая сцена с главным персонажем в центре и множеством деталей на фоне. Серьёзная газетная иллюстрация, взрослые реалистичные люди, без мультяшности. Без текста и букв в кадре.`;

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

Котировки Московской биржи (задержка 15 минут):
${quotes}

Заголовки новостей за последнее время:
${feedText}

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

      const [oilQ, goldQ, idxQ] = await Promise.all([
        Promise.all(['BRU6','NGU6'].map(quote)),
        Promise.all(['PLZL','UGLD'].map(quote)),
        Promise.all(['IMOEX','RTSI','USD000UTSTOM','TATN','LKOH','GMKN','SBER','GAZP'].map(quote))
      ]);

      const [oilN, goldN, idxN] = await Promise.all([
        news('oil'), news('gold'), news('index')
      ]);

      const jobs = [
        ['oil',   'Утренний пост про нефть и природный газ.',            oilQ,  oilN],
        ['gold',  'Утренний пост про золото и серебро.',                 goldQ, goldN],
        ['index', 'Утренний пост про индекс МосБиржи, РТС и главные акции дня — кто рос, кто падал и почему.', idxQ, idxN]
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
