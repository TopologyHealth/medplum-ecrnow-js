# Medmorph Demo Bot

## Setup
Create a bot on Medplum and add the ID to `medplum.config.json`. Create a Subscription on Medplum with criteria "Bundle" and have it trigger the bot you've just created. Set project secrets "MEDMORPH_DEMO_REPORT_ENDPOINT" and "MEDMORPH_DEMO_REPORT_ENDPOINT_AUTH" to the endpoint that the bot should send the final results to. Finally, run the following commands in this directory to upload the bot to Medplum:

```
cp .env.example .env
{Add values for MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET in .env}
nvm use
npm install
npm run build-then-upload-bot
```

## Testing
To verify that the bot has been configured correctly, run the "test-workflow" script in the "notification_server" project (in the parent directory).

### Detailed
```
cd ../notification_server
cp .env.example .env
{set variables MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET}
nvm use
npm install
npm run test-workflow
```
This will upload all files in ../test_artifacts/inputs to Medplum, which should then trigger the creation of an AuditEvent for the bot's Subscription.