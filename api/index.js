const https = require('https');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { type, payload } = req.body;
  const openaiKey = process.env.OPENAI_API_KEY;
  const stabilityKey = process.env.STABILITY_API_KEY;

  const makeRequest = (hostname, path, body, apiKey) => {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const options = {
        hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(data)
        }
      };
      const req = https.request(options, (response) => {
        let result = '';
        response.on('data', (chunk) => result += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(result)); }
          catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  };

  try {
    if (type === 'text') {
      const result = await makeRequest('api.openai.com', '/v1/chat/completions', payload, openaiKey);
      res.status(200).json(result);

    } else if (type === 'image') {
      const stabilityPayload = {
        prompt: payload.prompt,
        output_format: 'png',
        aspect_ratio: '1:1'
      };

      const result = await makeRequest(
        'api.stability.ai',
        '/v2beta/stable-image/generate/core',
        stabilityPayload,
        stabilityKey
      );

      if (result?.image) {
        res.status(200).json({
          data: [{ b64_json: result.image }]
        });
      } else {
        res.status(500).json({ error: 'Image generation failed', detail: result });
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
