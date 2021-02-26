const Twilio = require('twilio');

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

async function getCompletedRecording(sid, maxWaitTime = 5000) {
  console.log('[ Twilio ] Fetching completed recording for: ', sid);
  let recording = await twilioClient.recordings(sid).fetch();

  return new Promise((resolve, reject) => {
    const errmsg = `[ Twilio ] Failed to find completed recording within ${
      maxWaitTime / 1000
    } seconds`;
    const timeout = setTimeout(() => reject(errmsg), maxWaitTime);
    const interval = setInterval(() => {
      if (recording.status === 'completed') {
        console.log('[ Twilio ] Recording completed.');
        clearTimeout(timeout);
        resolve(recording);
        return clearInterval(interval);
      }
      twilioClient
        .recordings(sid)
        .fetch()
        .then((rec) => (recording = rec));
    }, 100);
  });
}

async function deleteRecording(sid) {
  console.log('[ Twilio ] Removing recording sid: ', sid);
  const removeResponse = await twilioClient.recordings(sid).remove();
  console.log(
    '[ Twilio ] Recording removed: ',
    removeResponse ? 'Success' : 'Failed'
  );
}

module.exports = {
  getCompletedRecording,
  deleteRecording,
};
