/**
 * Warning: Medplum bot environment seems to not support Array.flatMap or Object.entries
 */

import { BotEvent, MedplumClient } from "@medplum/core";
import { CONTENT_BUNDLE_PROFILE, MESSAGE_HEADER_PROFILE, MESSAGE_TYPE, NAMED_EVENT_URL, PROJECT_TAG_CODE_MEDMORPH_DEMO, PROJECT_TAG_CODE_SERVER, PROJECT_TAG_SYSTEM } from '../../common/common.mjs';
import { Bundle, BundleEntry, DiagnosticReport, Observation, Resource } from '@medplum/fhirtypes';
import fetch from "node-fetch";
import { randomUUID } from 'crypto';

const MESSAGE_HEADER_FULLURL = "urn:uuid:07a76e52-0668-464a-a0c3-2b6ba22cebfc";

interface BundleEntryExisting<T extends Resource = Resource> extends BundleEntry<T> {
  resource: NonNullable<BundleEntry<T>["resource"]>
}

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const transaction = event.input as Bundle;
  const tags = [{ system: PROJECT_TAG_SYSTEM, code: PROJECT_TAG_CODE_MEDMORPH_DEMO }];

  if (transaction.entry === undefined) {
    console.log("Empty Bundle -- ignoring");
    return;
  }

  const diagnosticReports = transaction.entry.filter((entry): entry is BundleEntryExisting<DiagnosticReport> =>
    entry.resource?.resourceType === "DiagnosticReport"
    && entry.resource.meta?.profile !== undefined
    && entry.resource.meta?.profile?.some(v => v === "http://hl7.org/fhir/us/cancer-reporting/StructureDefinition/us-pathology-diagnostic-report")
  );
  if (diagnosticReports.length === 0) {
    console.log(`No reports with profile "http://hl7.org/fhir/us/cancer-reporting/StructureDefinition/us-pathology-diagnostic-report" found -- ignoring Bundle`);
    return;
  }

  // Collect all Patient, Practitioner, PractitionerRole, ServiceRequest, and Organization Resources
  const collectedEntries = transaction.entry.filter(entry => ["Patient", "Practitioner", "PractitionerRole", "ServiceRequest", "Organization"].includes(entry.resource?.resourceType ?? ""));

  // Create a collection Bundle per DiagnosticReport
  const reportCollections: BundleEntry<Bundle>[] = [];
  for (const report of diagnosticReports) {
    const collectionBundle: Bundle = {
      resourceType: "Bundle",
      meta: { profile: [ CONTENT_BUNDLE_PROFILE ] },
      type: "collection",
      entry: [],
    }

    // Find referenced Observations
    const observationEntries: BundleEntry<Observation>[] = [];
    for (const result of report.resource.result ?? []) {
      const foundObservation = transaction.entry.find((entry): entry is BundleEntryExisting<Observation> =>
        entry.resource?.resourceType === "Observation"
        && entry.resource.identifier !== undefined
        && entry.resource.identifier.some(idt => idt.system === result.identifier?.system && idt.value === result.identifier?.value)
      );
      if (foundObservation !== undefined) {
        observationEntries.push(foundObservation);
      }
    }

    collectionBundle.entry?.push(...collectedEntries);

    // Add DiagnosticReport to collection Bundle
    collectionBundle.entry?.push(report);

    // Add referenced Observations to collection Bundle
    collectionBundle.entry?.push(...observationEntries);
    
    reportCollections.push({
      fullUrl: `urn:uuid:${randomUUID()}`,
      resource: collectionBundle
    });
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
        fullUrl: MESSAGE_HEADER_FULLURL,
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
      }
    ]
  }

  outBundle.entry?.push(...reportCollections);

  console.log("Created report:");
  console.dir(outBundle, {depth: undefined});  

  console.log("Validating report through Medplum's $validate");
  const result = await medplum.validateResource(outBundle);
  if (result.issue?.some(v => v.severity === "error" || v.severity === "fatal" || v.severity === "warning")) {
    throw new Error("Report failed validation")
  }
  const created = await medplum.createResource(outBundle);

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