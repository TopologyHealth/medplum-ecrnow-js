import { Subscription } from '@medplum/fhirtypes';

const BACKPORT_SUBSCRIPTION = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-subscription";
const PROJECT_TAG_SYSTEM = "http://example.org/fhir/tags";
const PROJECT_TAG_CODE_BOT = "bot-generated";

export function createMedMorphSubscription(
  criteria: string,
  endpoint: string,
  headers: { [key: string]: string }
): Subscription {
  return {
    resourceType: "Subscription",
    meta: {
      profile: [BACKPORT_SUBSCRIPTION],
      tag: [{ system: PROJECT_TAG_SYSTEM, code: PROJECT_TAG_CODE_BOT }]
    },
    status: "active",
    reason: "MedMorph subscription",
    criteria: criteria,
    channel: {
      type: "rest-hook",
      endpoint: endpoint,
      header: Object.entries(headers).map(([key, value]) => `${key}: ${value}`)
    }
  };
}