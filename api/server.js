import http from 'node:http';

const KEY = process.env.OPENAI_API_KEY;

const STYLE = ` Rendered as a serious editorial illustration for a financial newspaper: painterly digital realism with the restraint of a broadsheet op-ed page. Muted, sober palette of deep slate blue, graphite, warm ochre and cold steel. Dramatic directional light, deep shadows, visible brush and ink texture, no gloss, no plastic surfaces. Human figures are anatomically believable adults with weight and gravity in their posture, never cartoonish, never big-eyed, never rounded and toy-like. Composition is dense and cinematic with meaningful background detail. Absolutely no cartoon or animated-film aesthetic, no 3D render look, no text, letters, numbers or logos anywhere in the frame.`;const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method !== 'POST') { res.writeHead(200).end('pulse-art alive'); return; }

  let body = '';
  req.on('data', c => body += c);
  req.on('end', async () => {
    try {
      const { scene } = JSON.parse(body || '{}');
      if (!scene) throw new Error('no scene');

      const r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + KEY
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: scene + ' ' + STYLE,
          size: '1024x1024',
          quality: 'medium'
        })
      });

      const j = await r.json();
      if (j.error) throw new Error(j.error.message);

      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ b64: j.data[0].b64_json }));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(process.env.PORT || 10000);
