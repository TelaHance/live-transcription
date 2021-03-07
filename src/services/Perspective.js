/**
 * Adds sentiment to each message / block
 */
const { google } = require('googleapis');
const { PERSPECTIVE_API_KEY } = process.env;
const PERSPECTIVE_URL =
  'https://commentanalyzer.googleapis.com/$discovery/rest?version=v1alpha1';

const commonRequest = {
  requestedAttributes: {
    TOXICITY: {},
    IDENTITY_ATTACK: {},
    INSULT: {},
    PROFANITY: {},
    THREAT: {},
    FLIRTATION: {},
  },
  languages: ['en'],
  doNotStore: true,
};

async function analyzeTranscript(blocks) {
  const client = await google.discoverAPI(PERSPECTIVE_URL);

  // Convert Callback to Promise
  async function analyze(request) {
    return new Promise((resolve, reject) => {
      client.comments.analyze(
        { key: PERSPECTIVE_API_KEY, resource: request },
        (err, response) => {
          if (err) return reject(err);
          else {
            const { attributeScores } = response.data;
            const sentiment = {};
            for (const [attribute, scores] of Object.entries(attributeScores)) {
              sentiment[attribute] = scores.summaryScore.value;
            }
            resolve(sentiment);
          }
        }
      );
    });
  }

  async function addMessageSentiment(message) {
    message.sentiment = await analyze({
      comment: { text: message.fullText },
      ...commonRequest,
    });
    return message;
  }

  function compileMaxSentiment(blocks) {
    return blocks
      .map(({ sentiment }) => sentiment)
      .reduce((acc, cur) => {
        Object.entries(cur).forEach(([attribute, score]) => {
          acc[attribute] = Math.max(acc[attribute] ?? 0, score);
        });
        return acc;
      }, {});
  }

  console.log('[ Perspective ] Starting detailed sentiment analysis.');
  blocks = await Promise.all(
    blocks.map((message) => addMessageSentiment(message))
  );
  console.log('[ Perspective ] Finished detailed sentiment analysis.');
  console.log(
    '[ Perspective ] Starting compilation of maximum doctor sentiment.'
  );
  const doctor_sentiment = compileMaxSentiment(
    blocks.filter(({ speaker }) => speaker === 'DOCTOR')
  );
  console.log(
    '[ Perspective ] Finished compilation of maximum doctor sentiment.'
  );
  console.log(
    '[ Perspective ] Starting compilation of overall maximum sentiment.'
  );
  const sentiment = compileMaxSentiment(blocks);
  console.log(
    '[ Perspective ] Finished compilation of overall maximum sentiment.'
  );

  return { blocks, sentiment, doctor_sentiment };
}

module.exports = {
  analyzeTranscript,
};
