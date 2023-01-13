## Intro

## Setup
Copy `.env.example` to `.env` and enter your Medplum info as well as the Bearer token that should be sent with all output reports.

## Usage
Run `npm start` to start the server locally

Run `npm run test-server-logic` to test the workflow on a specific PlanDefinition and input. See `./scripts/test-server-logic.mts` for details

Run `npm run test-workflow` to upload all Resources in INPUT_FOLDER to Medplum, which will then trigger any active Subscriptions

## Misc