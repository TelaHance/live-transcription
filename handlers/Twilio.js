const Twilio = require('twilio');

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

function getDownloadUrl(recording) {
  const { apiVersion, sid } = recording;
  return `https://api.twilio.com/${apiVersion}/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
}

async function getRecording(callSid, maxWaitTime = 5000) {
  console.log('[ Twilio ] Fetching recording for call: ', callSid);
  let recordings = await twilioClient.recordings.list({ callSid, limit: 1 });
  let recording = recordings[0];

  await new Promise((resolve, reject) => {
    const errmsg = `[ Twilio ] Failed to find completed recording within ${
      maxWaitTime / 1000
    } seconds`;
    const timeout = setTimeout(() => reject(errmsg), maxWaitTime);
    const interval = setInterval(() => {
      console.log(
        `[ Twilio ] Found recording with status: ${recording.status}`
      );
      if (recording.status === 'completed') {
        clearTimeout(timeout);
        resolve(true);
        return clearInterval(interval);
      } else {
        twilioClient.recordings
          .list({ callSid, limit: 1 })
          .then((recordings) => (recording = recordings[0]));
      }
    }, 500);
  });

  console.log(
    '[ Twilio ] Found completed recording: ',
    JSON.stringify(recording)
  );

  return recording;
}

async function deleteRecording(sid) {
  // Deleting recording
  console.log('[ Twilio ] Removing recording sid: ', sid);
  const removeResponse = await twilioClient.recordings(sid).remove();
  console.log(
    '[ Twilio ] Recording removed: ',
    removeResponse ? 'Success' : 'Failed'
  );
}

module.exports = {
  getDownloadUrl,
  getRecording,
  deleteRecording,
};
