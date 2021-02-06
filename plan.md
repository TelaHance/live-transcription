# Plan for Live Transcription

## Outbound <-> Inbound
  [ ] Create new text block

## words.length !== 0
  [ ] Sorted insert into local blocks array
  [ ] Update DynamoDB
  [ ] Update client

## Whenever transcript doesn't change on same track
  [ ] Don't update client
