const fetch = require('isomorphic-unfetch');

const { INFERMEDICA_APP_ID, INFERMEDICA_APP_KEY } = process.env;

class Infermedica {
  constructor({ age, sex }) {
    this.age = age ?? 30;
    this.sex = sex;
  }

  async parse(text) {
    const response = await fetch('https://api.infermedica.com/v3/parse', {
      method: 'POST',
      headers: {
        'App-Id': INFERMEDICA_APP_ID,
        'App-Key': INFERMEDICA_APP_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        age: { value: this.age },
        sex: this.sex,
        text: text,
      }),
    });
    const data = await response.json();
    console.log('[ Infermedica ]', JSON.stringify(data));
    return data.mentions;
  }
}

module.exports = Infermedica;
