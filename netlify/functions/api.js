const https = require('https');

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { type, payload } = JSON.parse(event.body);
  const apiKey = process.env.OPENAI_API_KEY;

  const makeRequest = (hostname, path, body) => {
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
      const req = https.request(options, (res) => {
        let result = '';
        res.on('data', (chunk) => result += chunk);
        res.on('end', () => resolve(JSON.parse(result)));
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  };

  try {
    if (type === 'text') {
      const result = await makeRequest('api.openai.com', '/v1/chat/completions', payload);
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(result)
      };
    } else if (type === 'image') {
      const result = await makeRequest('api.openai.com', '/v1/images/generations', payload);
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(result)
      };
    }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
