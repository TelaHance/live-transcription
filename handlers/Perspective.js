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

  console.log('[ Perspective ] Starting overall sentiment analysis.');
  const sentiment = await analyze({
    comment: { text: blocks.map((message) => message.fullText).join(' ') },
    ...commonRequest,
  });
  console.log('[ Perspective ] Finished overall sentiment analysis.');

  async function addMessageSentiment(message) {
    message.sentiment = await analyze({
      comment: { text: message.fullText },
      ...commonRequest,
    });
    return message;
  }

  console.log('[ Perspective ] Starting detailed sentiment analysis.');
  blocks = await Promise.all(
    blocks.map((message) => addMessageSentiment(message))
  );
  console.log('[ Perspective ] Finished detailed sentiment analysis.');

  return { blocks, sentiment };
}

module.exports = {
  analyzeTranscript,
};
