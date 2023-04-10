/**
 * Warning: Medplum bot environment seems to not support Array.flatMap or Object.entries
 */

import { BotEvent, MedplumClient } from "@medplum/core";
import { CONTENT_BUNDLE_PROFILE, MESSAGE_HEADER_PROFILE, MESSAGE_TYPE, NAMED_EVENT_URL, PROJECT_TAG_CODE_MEDMORPH_DEMO, PROJECT_TAG_CODE_SERVER, PROJECT_TAG_SYSTEM } from '../../common/common.mjs';
import { Bundle } from '@medplum/fhirtypes';
import fetch from "node-fetch";
import { randomUUID } from 'crypto';

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const transaction = event.input as Bundle;
  const tags = [{ system: PROJECT_TAG_SYSTEM, code: PROJECT_TAG_CODE_MEDMORPH_DEMO }];

  // Check if this is a relevant Bundle
  if (!(transaction.entry?.some(entry => entry.resource?.resourceType === "DiagnosticReport" && entry.resource.meta?.profile?.some(v => v === "http://hl7.org/fhir/us/cancer-reporting/StructureDefinition/us-pathology-diagnostic-report")))) {
    console.log("Not a us-pathology-diagnostic-report -- ignoring");
    return;
  }

  const outBundle: Bundle = {
    resourceType: "Bundle",
    type: "message",
    meta: {
      tag: tags
    },
    // TODO: timestamp
    entry: [
      {
        fullUrl: `urn:uuid:${randomUUID()}`,
        resource: {
          resourceType: "MessageHeader",
          meta: {
            profile: [ MESSAGE_HEADER_PROFILE ],
            tag: [{ system: PROJECT_TAG_SYSTEM, code: PROJECT_TAG_CODE_SERVER }]
          },
          extension: [{
            url: "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-report-initiation-type",
            valueCodeableConcept: {
              coding: [{
                system: "http://hl7.org/fhir/us/medmorph/ValueSet/us-ph-report-initiation-type-valueset",
                code: "subscription-notification",
              }]
            }
          }],
          sender: {
            reference: "PLACEHOLDER"
          },
          source: {
            endpoint: "PLACEHOLDER", // TODO
          },
          destination: [
            {
              endpoint: "PLACEHOLDER" // TODO
            }
          ],
          eventCoding: {
            system: MESSAGE_TYPE,
            code: "cancer-report-message"
          },
          reason: {
            coding: [{
              system: NAMED_EVENT_URL,
              code: "create-report",
            }]
          }
        }
      },
      {
        fullUrl: `urn:uuid:${randomUUID()}`,
        resource: {
          resourceType: "Bundle",
          type: "collection",
          meta: {
            profile: [ CONTENT_BUNDLE_PROFILE ]
          },
          // TODO: timestamp
          entry: transaction.entry,
        }
      }
    ] 
  }
  console.log("Created report:");
  console.dir(outBundle, {depth: undefined});  

  console.log("Validating report through Medplum's $validate");
  const result = await medplum.validateResource(outBundle);
  if (result.issue?.some(v => v.severity === "error" || v.severity === "fatal" || v.severity === "warning")) {
    throw new Error("Report failed validation")
  }

  console.log(`Sending the report to endpoint ${outBundle}:`);
  if (event.secrets['MEDMORPH_DEMO_REPORT_ENDPOINT'].valueString === undefined) throw new Error("MEDMORPH_DEMO_REPORT_ENDPOINT is undefined.")
  if (event.secrets['MEDMORPH_DEMO_REPORT_ENDPOINT_AUTH'].valueString === undefined) throw new Error("MEDMORPH_DEMO_REPORT_ENDPOINT_AUTH is undefined.")
  const response = await fetch(
    event.secrets['MEDMORPH_DEMO_REPORT_ENDPOINT'].valueString, {
      method: "POST",
      body: JSON.stringify(outBundle),
      headers: {
        'Content-Type': 'application/fhir+json',
        'Authorization': `Bearer ${event.secrets['MEDMORPH_DEMO_REPORT_ENDPOINT_AUTH'].valueString}`,
      },
    });
  console.log("Response from endpoint:");
  console.dir(await response.json(), {depth: undefined});
}