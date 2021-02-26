const {
  DynamoDBClient,
  UpdateItemCommand,
  QueryCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const { REGION } = process.env;
const dbclient = new DynamoDBClient({ region: REGION });

let isFirstSymptomsUpdate = true;

async function get(consultId) {
  const queryParams = {
    TableName: 'consults',
    ExpressionAttributeValues: marshall({
      ':c': consultId,
    }),
    KeyConditionExpression: 'consult_id = :c',
    ProjectionExpression: 'start_time',
  };
  const data = await dbclient.send(new QueryCommand(queryParams));
  return unmarshall(data.Items[0]);
}

async function update(consultId, { blocks, symptoms, sentiment }) {
  const { start_time } = await get(consultId);

  const UpdateExpression = ['SET transcript = :t'];
  const ExpressionAttributeValues = { ':t': blocks };

  if (symptoms) {
    ExpressionAttributeValues[':symptoms'] = symptoms;
    UpdateExpression.append(
      `symptoms = ${
        isFirstSymptomsUpdate ? 'list_append(symptoms, :symptoms)' : ':symptoms'
      }`
    );
    isFirstSymptomsUpdate = false;
  }

  if (sentiment) {
    ExpressionAttributeValues[':sentiment'] = sentiment;
    UpdateExpression.append(`sentiment = :sentiment`);
  }

  const updateParams = {
    TableName: 'consults',
    Key: marshall({
      consult_id: consultId,
      start_time,
    }),
    ExpressionAttributeValues: marshall(ExpressionAttributeValues),
    UpdateExpression: UpdateExpression.join(', '),
    ReturnValues: 'UPDATED_NEW',
  };

  return dbclient.send(new UpdateItemCommand(updateParams));
}

async function updateCallSid(consultId, callSid) {
  const { start_time } = await get(consultId);
  const updateParams = {
    TableName: 'consults',
    Key: marshall({
      consult_id: consultId,
      start_time,
    }),
    UpdateExpression: 'SET call_sid = :id',
    ExpressionAttributeValues: marshall({ ':id': callSid }),
    ReturnValues: 'UPDATED_NEW',
  };
  return dbclient.send(new UpdateItemCommand(updateParams));
}

module.exports = {
  get,
  update,
  updateCallSid,
};
