import { Bundle, BundleEntry, Resource } from '@medplum/fhirtypes';
import { randomUUID } from 'crypto';

const MESSAGE_HEADER_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-messageheader";
const CONTENT_BUNDLE_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-content-bundle";
const MESSAGE_TYPE = "http://example.org/fhir/message-types";
const NAMED_EVENT_URL = "http://example.org/fhir/named-events";
const PROJECT_TAG_SYSTEM = "http://example.org/fhir/tags";
const PROJECT_TAG_CODE_SERVER = "server-generated";

export function createMedMorphMessageBundle(contentBundles: Bundle[], initiationType: string, eventCode: string): Bundle {
  const messageHeaderId = randomUUID();
  
  return {
    resourceType: "Bundle",
    type: "message",
    entry: [
      {
        fullUrl: `urn:uuid:${messageHeaderId}`,
        resource: {
          resourceType: "MessageHeader",
          id: messageHeaderId,
          meta: {
            profile: [MESSAGE_HEADER_PROFILE],
            tag: [{ system: PROJECT_TAG_SYSTEM, code: PROJECT_TAG_CODE_SERVER }]
          },
          extension: [{
            url: "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-report-initiation-type",
            valueCodeableConcept: {
              coding: [{
                system: "http://hl7.org/fhir/us/medmorph/ValueSet/us-ph-report-initiation-type-valueset",
                code: initiationType,
              }]
            }
          }],
          eventCoding: {
            system: MESSAGE_TYPE,
            code: eventCode,
          },
          source: {
            endpoint: "http://example.org/fhir/endpoint" // Replace with actual endpoint
          },
          destination: [
            {
              endpoint: "http://example.org/fhir/destination" // Replace with actual destination
            }
          ],
          sender: {
            reference: "Organization/example" // Replace with actual sender reference
          },
          reason: {
            coding: [{
              system: NAMED_EVENT_URL,
              code: "create-report",
            }]
          }
        }
      },
      ...contentBundles.map(bundle => ({
        fullUrl: `urn:uuid:${randomUUID()}`,
        resource: bundle
      }))
    ]
  };
}