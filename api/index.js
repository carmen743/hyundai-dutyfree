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
 
  const makeJsonRequest = (hostname, path, body, apiKey) => {
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
      const request = https.request(options, (response) => {
        let result = '';
        response.on('data', (chunk) => result += chunk);
        response.on('end', () => {
          try { resolve(JSON.parse(result)); }
          catch(e) { reject(e); }
        });
      });
      request.on('error', reject);
      request.write(data);
      request.end();
    });
  };
 
  const makeStabilityRequest = (prompt, apiKey) => {
    return new Promise((resolve, reject) => {
      const formData = `--boundary\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n--boundary\r\nContent-Disposition: form-data; name="output_format"\r\n\r\npng\r\n--boundary--`;
      
      const options = {
        hostname: 'api.stability.ai',
        path: '/v2beta/stable-image/generate/core',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'Content-Type': 'multipart/form-data; boundary=boundary',
          'Content-Length': Buffer.byteLength(formData)
        }
      };
 
      const request = https.request(options, (response) => {
        let result = '';
        response.on('data', (chunk) => result += chunk);
        response.on('end', () => {
          try { 
            const parsed = JSON.parse(result);
            resolve(parsed);
          }
          catch(e) { reject(new Error(result)); }
        });
      });
      request.on('error', reject);
      request.write(formData);
      request.end();
    });
  };
 
  try {
    if (type === 'text') {
      const result = await makeJsonRequest('api.openai.com', '/v1/chat/completions', payload, openaiKey);
      res.status(200).json(result);
 
    } else if (type === 'image') {
      const result = await makeStabilityRequest(payload.prompt, stabilityKey);
      
      if (result?.image) {
        res.status(200).json({
          data: [{ b64_json: result.image }]
        });
      } else {
        res.status(500).json({ error: 'Image generation failed', detail: JSON.stringify(result) });
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
 
