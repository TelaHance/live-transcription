const {
  GetItemCommand,
  DynamoDBClient,
  UpdateItemCommand,
  QueryCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const { REGION } = process.env;
const dbclient = new DynamoDBClient({ region: REGION });

async function getConsult(consultId) {
  const data = await dbclient.send(
    new QueryCommand({
      TableName: 'consults',
      ExpressionAttributeValues: marshall({
        ':c': consultId,
      }),
      KeyConditionExpression: 'consult_id = :c',
    })
  );
  return unmarshall(data.Items[0]);
}

class DynamoDB {
  async initialize(consultId) {
    this.condultId = consultId;
    this.consult = await getConsult(consultId);
  }

  async getPatient() {
    const data = await dbclient.send(
      new GetItemCommand({
        TableName: 'users',
        Key: marshall({ user_id: this.consult.patient_id }),
      })
    );
    return unmarshall(data.Item);
  }

  async updateConsult({ blocks, callSid, entities, sentiment }) {
    const { consult_id, start_time } = this.consult;

    const ExpressionAttributeValues = {};
    const UpdateExpression = [];

    if (blocks) {
      ExpressionAttributeValues[':t'] = blocks;
      UpdateExpression.push('transcript = :t');
    }

    if (callSid) {
      ExpressionAttributeValues[':c'] = callSid;
      UpdateExpression.push('call_sid = :c');
    }

    if (entities) {
      this.consult = await getConsult(this.consultId);
      const newEntities = entities.filter((newEntity) =>
        this.consult.symptoms.every((entity) => entity.id !== newEntity.id)
      );
      ExpressionAttributeValues[':e'] = [
        ...this.consult.symptoms,
        ...newEntities,
      ];
      UpdateExpression.push('symptoms = :e');
    }

    if (sentiment) {
      ExpressionAttributeValues[':s'] = sentiment;
      UpdateExpression.push(`sentiment = :s`);
    }

    return dbclient.send(
      new UpdateItemCommand({
        TableName: 'consults',
        Key: marshall({ consult_id, start_time }),
        ExpressionAttributeValues: marshall(ExpressionAttributeValues),
        UpdateExpression: `SET ${UpdateExpression.join(', ')}`,
        ReturnValues: 'UPDATED_NEW',
      })
    );
  }
}

module.exports = DynamoDB;
