// Common for the Subscription bot and notification server

export interface SubNotification {
    "pd-to-process": string,
    "action-to-process": string,
    "report-endpoint": string,
}

export const ENDPOINT_PATH = 'kar_notification'

export const PROJECT_TAG_SYSTEM = "http://topology.health/fhir/CodeSystem/medplum-ecrnow-js";
export const PROJECT_TAG_CODE_BOT = "medplum-ecrnow-js-bot";
export const PROJECT_TAG_CODE_SERVER = "medplum-ecrnow-js-server";