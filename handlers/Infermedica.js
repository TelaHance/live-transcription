const fetch = require('isomorphic-unfetch');

async function parse(age, text) {
  const response = await fetch('https://api.infermedica.com/v3/parse', {
    method: 'POST',
    headers: {
      'App-Id': process.env.INFERMEDICA_APP_ID,
      'App-Key': process.env.INFERMEDICA_APP_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      age: { value: age },
      text: text,
    }),
  });
  const data = await response.json();
  console.log('[ Infermedica ]', JSON.stringify(data));
  return data.mentions;
}

module.exports = {
  parse,
};
