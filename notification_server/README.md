## Intro
This server will listen for POSTs that trigger a PlanDefinition.action for a provided Resource. These actions are expected to trigger further actions on completion (through action.relatedAction), which together form a workflow. The final action of that workflow will likely trigger the submission of some generated report to an endpoint, which is currently provided by a header in the initial POST (since that endpoint is defined in the KAR).

## Setup
Copy `.env.example` to `.env` and enter your Medplum info as well as the Bearer token that should be sent with all output reports.

## Usage
Run `npm start` to start the server locally

Run `npm run test-server-logic` to test the workflow on a specific PlanDefinition and input. See `./scripts/test-server-logic.mts` for details

Run `npm run test-workflow` to upload all Resources in INPUT_FOLDER to Medplum, which will then trigger any active Subscriptions

## Misc