import http from 'node:http';

const KEY = process.env.OPENAI_API_KEY;

const STYLE = `Rendered as a hybrid of a classic Economist political caricature and a Pixar animated film still. Characters are appealing, rounded, three-dimensional, with soft volumetric lighting, subtle subsurface glow and cinematic depth of field, like a high-end 3D animation frame — but the composition, wit and symbolic storytelling are pure editorial cartoon. Expressive exaggerated faces with real emotion and personality. Warm cinematic color grading, one dominant accent color. Dense layered background full of small meaningful props and tiny secondary characters that reward close inspection. Every element is symbolic and connected to finance and markets. Absolutely no text, no letters, no numbers, no words, no logos anywhere in the image.`;

const server = http.createServer(async (req, res) => {
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
