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

async function update(consultId, blocks, symptoms) {
  const { start_time } = await get(consultId);

  const updateParams = {
    TableName: 'consults',
    Key: marshall({
      consult_id: consultId,
      start_time,
    }),
    UpdateExpression: 'SET transcript = :t',
    ExpressionAttributeValues: marshall({ ':t': blocks }),
    ReturnValues: 'UPDATED_NEW',
  };

  if (symptoms) {
    let updateVal = 'list_append(symptoms, :s)';
    if (isFirstSymptomsUpdate) {
      updateVal = ':s';
      isFirstSymptomsUpdate = false;
    }
    updateParams.UpdateExpression += `, symptoms = ${updateVal}`;
    updateParams.ExpressionAttributeValues = marshall({
      ':t': blocks,
      ':s': symptoms,
    });
  }
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
