const fetch = require('isomorphic-unfetch');

const { INFERMEDICA_APP_ID, INFERMEDICA_APP_KEY } = process.env;

class Infermedica {
  constructor({ age, sex }) {
    this.age = Number(age) ?? 30;
    this.sex = sex;
    this.context = [];
  }

  async parse(text) {
    const reqBody = JSON.stringify({
      age: { value: this.age },
      sex: this.sex,
      text: text,
      concept_types: ['condition', 'risk_factor', 'symptom'],
      context: this.context,
    });
    console.log('[ Infermedica ] Request: ', reqBody);
    const response = await fetch('https://api.infermedica.com/v3/parse', {
      method: 'POST',
      headers: {
        'App-Id': INFERMEDICA_APP_ID,
        'App-Key': INFERMEDICA_APP_KEY,
        'Content-Type': 'application/json',
      },
      body: reqBody,
    });

    const responseObj = await response.json();
    const { mentions } = responseObj;
    console.log('[ Infermedica ] Response: ', JSON.stringify(responseObj));

    const symptoms = mentions?.filter(({ type }) => type === 'symptom') ?? [];
    // Use the last mentioned symptom as the context for best accuracy
    if (symptoms.length > 0) {
      this.context = [symptoms[symptoms.length - 1].id];
    }

    return mentions;
  }
}

module.exports = Infermedica;
