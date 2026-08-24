import http from 'node:http';

const KEY = process.env.OPENAI_API_KEY;

// ЕДИНЫЙ СТИЛЬ. Меняем только эту строку, чтобы поменять вид всех картинок.
const STYLE = `Editorial newspaper caricature, hand-drawn ink illustration with
bold confident linework and cross-hatching, expressive exaggerated cartoon face
on the main object, single character centered, dark navy background (#0E1620),
amber (#F5A524) and off-white accents, dramatic rim lighting, vintage financial
press engraving feel, no text, no letters, no words, no numbers, square composition.`;

function send(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 200, { ok: true });
  if (!KEY) return send(res, 500, { error: 'Не задан OPENAI_API_KEY' });

  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', async () => {
    try {
      const { scene } = JSON.parse(body || '{}');
      if (!scene) return send(res, 400, { error: 'Нет описания сцены' });

      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: scene + '\n\n' + STYLE,
          size: '1024x1024',
          quality: 'medium',
          n: 1
        })
      });

      const j = await r.json();
      if (!r.ok) return send(res, r.status, { error: j.error?.message || 'Ошибка OpenAI' });

      const b64 = j.data?.[0]?.b64_json;
      if (!b64) return send(res, 500, { error: 'Пустой ответ' });
      send(res, 200, { b64 });
    } catch (e) {
      send(res, 500, { error: String(e.message || e) });
    }
  });
});

server.listen(process.env.PORT || 3000);
