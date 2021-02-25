const axios = require('axios');
const { S3 } = require('aws-sdk');
const S3UploadStream = require('s3-upload-stream');
const Twilio = require('twilio');

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;

function get_download_url(recording) {
  const { apiVersion, sid } = recording;
  return `https://api.twilio.com/${apiVersion}/Accounts/${TWILIO_ACCOUNT_SID}/Recordings/${sid}.mp3`;
}

function get_upload_path(recording) {
  const recordingDate = new Date(recording.dateCreated);
  const year = recordingDate.getFullYear();
  const callSid = recording.callSid;
  return `Recordings/${year}/${callSid}.mp3`;
}

async function transfer_recording(download_url, upload_stream) {
  const response = await axios({
    method: 'GET',
    url: download_url,
    responseType: 'stream',
  });
  response.data.pipe(upload_stream);
  return new Promise((resolve, reject) => {
    upload_stream.on('uploaded', resolve);
    upload_stream.on('error', reject);
  });
}

async function uploadRecording(callSid, maxWaitTime = 5000) {
  const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  let recordings = await twilioClient.recordings.list({ callSid, limit: 1 });
  let recording = recordings[0];

  await new Promise((resolve, reject) => {
    const errmsg = `[ S3 ] Failed to upload within ${
      maxWaitTime / 1000
    } seconds`;
    const timeout = setTimeout(() => reject(errmsg), maxWaitTime);
    const interval = setInterval(() => {
      console.log(`[ S3 ] Found recording with status: ${recording.status}`);
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

  console.log('[ S3 ] Found recording: ', JSON.stringify(recording));

  const download_url = get_download_url(recording);
  const upload_path = get_upload_path(recording);
  let s3Stream = S3UploadStream(new S3());
  let upload_stream = s3Stream.upload({
    Bucket: 'teleconsults',
    Key: upload_path,
    ContentType: 'audio/mpeg',
  });

  await transfer_recording(download_url, upload_stream);

  // Deleting recording
  console.log('[ S3 ] Recording Sid to remove: ', recording.sid);
  const removeResponse = await twilioClient.recordings(recording.sid).remove();
  console.log('[ S3 ] Remove response: ', removeResponse);
}

module.exports = {
  uploadRecording,
};
