## Intro
This bot will generate Subscriptions that each trigger a workflow specified by PlanDefinitions found in a provided Knowledge Artifact Repository (KAR) Bundle. If the bot is configured correctly, any KAR uploaded to Medplum will automatically cause Subscriptions to be generated for each contained PlanDefinition. Each Subscription will trigger a POST to a notification server whenever a Resource is uploaded to Medplum that matches the criteria defined in the respective PlanDefinition.action. The notification server performs the actual workflow specified by that PlanDefinition.action, and code for that server is also in this repository under a separate folder (`../notification_server`).

## Setup
This project should compile the relevant source into a single .js file and upload it as a Medplum bot using the Medplum CLI. See script "build-then-upload-bot" in `package.json`

The Medplum CLI expects a `.env` file in this folder with MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET set.

Use the correct version of node as described in `.nvmrc`. If you have `nvm` installed, running `nvm use` in this directory will switch to the correct version.

To setup the Medplum CLI, copy `.env.example` to `.env` and enter your client ID and secret. You must also enter your bot's ID in `medplum.config.json`. This bot should be configured to trigger on any Bundle, which may be done by following [these instructions](https://www.medplum.com/docs/bots/bot-basics#executing-automatically-using-a-subscription)

On Medplum, you'll need to set the project secret "ECR_SUBSCRIPTION_SERVER_URL" to the URL where the server at `../notification_server` is running. If running locally (using `npm run test-bot-logic`), set ECR_SUBSCRIPTION_SERVER_URL in `.env`

Finally, run `npm run build-then-upload-bot` to upload the bot onto Medplum.

## Usage
Once the bot is uploaded to Medplum, it can be triggered by uploading a Bundle conforming to the profile "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-specification-bundle"

You may manually create Subscriptions by placing Bundles in `KAR_FOLDER` as described in `scripts/test-bot-logic.mts` and running `npm run test-bot-logic`, which will perform the same logic as the bot

## Misc
To delete all Subscriptions created by the bot, use `npm run clean`
