/** Shared between projects */

export interface SubNotification {
    "pd-to-process": string,
    "action-to-process": string,
    "report-endpoint": string,
}

export const ENDPOINT_PATH = 'kar_notification'

export const PROJECT_TAG_SYSTEM = "http://topology.health/fhir/CodeSystem/medplum-ecrnow-js";
export const PROJECT_TAG_CODE_BOT = "medplum-ecrnow-js-bot";
export const PROJECT_TAG_CODE_SERVER = "medplum-ecrnow-js-server";
export const PROJECT_TAG_CODE_MEDMORPH_DEMO = "medmorph-demo-bot";

export const MESSAGE_HEADER_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-messageheader";
// export const MESSAGE_HEADER_PROFILE = "http://hl7.org/fhir/us/cancer-reporting/StructureDefinition/us-pathology-message-header";
export const CONTENT_BUNDLE_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-content-bundle";
export const MESSAGE_TYPE = "http://hl7.org/fhir/us/medmorph/CodeSystem/us-ph-messageheader-message-types";
export const NAMED_EVENT_URL = "http://hl7.org/fhir/us/medmorph/CodeSystem/us-ph-triggerdefinition-namedevents";