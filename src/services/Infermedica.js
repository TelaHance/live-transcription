const fetch = require('isomorphic-unfetch');

const { INFERMEDICA_APP_ID, INFERMEDICA_APP_KEY } = process.env;

class Infermedica {
  constructor({ age, sex }) {
    this.age = Number(age) ?? 30;
    this.sex = sex;
    this.context = [];
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
        concept_types: ['condition', 'risk_factor', 'symptom'],
        context: this.context,
      }),
    });
    const { mentions } = await response.json();
    console.log('[ Infermedica ]', JSON.stringify(mentions));

    const symptoms = mentions.filter(({ type }) => type === 'symptom');
    // Use the last mentioned symptom as the context for best accuracy
    if (symptoms.length > 0) {
      this.context = [symptoms[symptoms.length - 1]];
    }

    return mentions;
  }
}

module.exports = Infermedica;
