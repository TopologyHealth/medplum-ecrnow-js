#!/usr/bin/env -S ts-node -T

import * as dotenv from 'dotenv';
dotenv.config();
import { MedplumClient } from "@medplum/core";
import fetch from "node-fetch";
import { Bundle, BundleEntry, Observation, Patient, PlanDefinitionAction, Resource, ResourceType } from '@medplum/fhirtypes';
import * as fhirpath from 'fhirpath';
import { v4 as uuidv4 } from 'uuid';
import { CONTENT_BUNDLE_PROFILE, MESSAGE_HEADER_PROFILE, MESSAGE_TYPE, NAMED_EVENT_URL, PROJECT_TAG_CODE_SERVER, PROJECT_TAG_SYSTEM } from '../common/common.mjs';

const US_PUBLIC_HEALTH_FHIR_QUERY_PATTERN_EXTENSION = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-fhirquerypattern-extension";

const ECR_WORKFLOW_TAG_SYSTEM = "http://topology.health/fhir/temp-tag-uuid";
const BUNDLE_PATIENT_TAG_SYSTEM = "http://topology.health/fhir/report-bundle-patient-tag";

interface UploadedResource {
  resType: ResourceType,
  id: string,
}
export interface Context {
  patient: Patient,
  resource: Resource,
  workflowTag?: string,
  tempResources?: UploadedResource[]
}

// Gather required resources (see server.mts). Also uploads resources to Medplum so that we may use Medplum's FHIR search
export async function buildContext(resourceType: ResourceType, resourceId: string): Promise<Context> {
  if (process.env.MEDPLUM_CLIENT_ID === undefined) throw new Error("MEDPLUM_CLIENT_ID environment variable is missing");
  if (process.env.MEDPLUM_CLIENT_SECRET === undefined) throw new Error("MEDPLUM_CLIENT_SECRET environment variable is missing");
  const medplum = new MedplumClient({ fetch: fetch });
  await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);
  const notifRes: Resource = await medplum.readResource(resourceType, resourceId);

  let patient: Patient | undefined;

  /**
   * Special case for Bundles: all relevant Resources for this report will be contained in this Bundle,
   * so all contained Resources will be uploaded to Medplum temporarily to enable us to easily search
   * through them using the FHIR server search syntax. These Resources will be uniquely tagged and should
   * be deleted after execution.
   */
  if (notifRes.resourceType === "Bundle") {
    // Check that this is not a report Bundle that was created by this server
    if (notifRes.meta?.tag?.some(v => v.system === PROJECT_TAG_SYSTEM && v.code === PROJECT_TAG_CODE_SERVER)) throw new Error("Ignoring Bundle created by this server");
    // Search for Patient in Bundle
    patient = notifRes.entry?.find((v): v is BundleEntry<Patient> => v.resource?.resourceType === "Patient")?.resource;
    if (patient === undefined) {
      throw new Error("Could not find Patient");
    }
    // Upload all contained Resources to Medplum so that we may use Medplum's FHIR search
    const uploadedResources: UploadedResource[] = [];
    let uploadedResourceTag = uuidv4();
    function writeTag(tag: string, res: Resource) {
      if (!("meta" in res)) res.meta = {};
      if (!("tag" in res.meta!)) res.meta!.tag = [];
      res.meta?.tag?.push({
        system: ECR_WORKFLOW_TAG_SYSTEM,
        code: tag,
      });
    }
    writeTag(uploadedResourceTag, patient);
    for (const entry of notifRes.entry ?? []) {
      if (entry.resource === undefined) continue;
      writeTag(uploadedResourceTag, entry.resource);
      const curRes = await medplum.createResource(entry.resource);
      uploadedResources.push({
        resType: curRes.resourceType,
        id: curRes.id!,
      });
    }
    return {
      patient: patient,
      resource: notifRes,
      workflowTag: uploadedResourceTag,
      tempResources: uploadedResources,
    }
  }
  
  if ("subject" in notifRes && notifRes.subject !== undefined && "reference" in notifRes.subject) {
    // Find Patient through Resource reference
    const patientNPI = notifRes.subject.reference?.split('/')[1]; // Reference is ambiguous from CAP input
    if (patientNPI !== undefined) {
      patient = await medplum.searchOne("Patient", `identifier=urn:NPI|${patientNPI}`);
    }
  }
  if (patient === undefined) {
    throw new Error("Could not find Patient");
  }
  return {
    patient: patient,
    resource: notifRes,
  }
}

export async function performAction(pdToProcessUrl: string, actionId: string, reportEndpoint: string, context: Context) {
  if (process.env.MEDPLUM_CLIENT_ID === undefined) throw new Error("MEDPLUM_CLIENT_ID environment variable is missing");
  if (process.env.MEDPLUM_CLIENT_SECRET === undefined) throw new Error("MEDPLUM_CLIENT_SECRET environment variable is missing");
  console.log(`Performing action ${actionId} of PD ${pdToProcessUrl}`);
  const medplum = new MedplumClient({ fetch: fetch });
  await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);

  const pdToProcess = await medplum.searchOne("PlanDefinition", `url=${pdToProcessUrl}`);
  if (pdToProcess === undefined) throw new Error(`Could not find PlanDefinition with url ${pdToProcessUrl}`);
  
  // Find action to execute (the action may be nested in another action)
  let actionToProcess: PlanDefinitionAction | undefined = undefined;
  function findAction(action: PlanDefinitionAction, actionId: string): PlanDefinitionAction | null {
    for (const subaction of action.action ?? []) {
      if (subaction.id === actionId) {
        return subaction
      }
      else {
        const foundAction = findAction(subaction, actionId);
        if (foundAction !== null) {
          return foundAction;
        }
      }
    }
    return null;
  }
  for (const action of pdToProcess.action ?? []) {
    if (action.id === actionId) {
      actionToProcess = action;
      break;
    }
    else {
      const foundAction = findAction(action, actionId);
      if (foundAction !== null) {
        actionToProcess = foundAction;
        break;
      }
    }
  }
  if (actionToProcess === undefined) throw new Error(`PlanDefinition "${pdToProcessUrl}": Could not find action "${actionId}"`);

  // Collect action inputs
  const actionInputs: { [id: string]: Resource[] | undefined } = {
    patient: [context.patient],
  };
  if (actionToProcess.input !== undefined) {
    for (const input of actionToProcess.input) {
      if (input.id === undefined || input.type === undefined) continue;
      let inputQuery = '_count=100&';

      const ext = input.extension?.find(v => v.url === US_PUBLIC_HEALTH_FHIR_QUERY_PATTERN_EXTENSION);
      if (ext !== undefined) {
        let query = ext.valueString?.split('?')[1];
        if (query !== undefined) {
          query = query.replace('{{context.patientId}}', context.patient.id ?? context.patient.identifier?.[0].value ?? "")
          inputQuery += query;
        }
      }
      // Waiting for Medplum support: https://github.com/medplum/medplum/issues/1387
      // else if (actionInput.profile !== undefined) {
      //   inputQuery += `_profile=${actionInput.profile.join(',')}`;
      // }
      else if (input.codeFilter !== undefined) {
        inputQuery += (await Promise.all(input.codeFilter.map(async (v) => {

          if (v.searchParam !== undefined) return v.searchParam;
          // Note: v.path must be provided (FHIR drq-1)

          if (v.valueSet !== undefined) {
            // return `${v.path}:in=${v.valueSet}`;
            // Alternative for ValueSet search while https://github.com/medplum/medplum/issues/1376 is unresolved:
            const vs = await medplum.searchOne('ValueSet', `url=${v.valueSet}`)
            const queryCodes = vs?.compose?.include?.flatMap(include => include.concept?.map(v => `${include.system}|${v.code}`) ?? []);
            if (queryCodes !== undefined) {
              return `${v.path}=${queryCodes.join(',')}`;
            }
          }

          if (v.code !== undefined && v.code.length > 0) return `${v.path}=${v.code.map(code => `${code.system}|${code.code}`).join(',')}`;

          return `${v.path}:missing=false`;

        }))).join('&');
      }

      // TODO: actionInput.dateFilter
      if (inputQuery.endsWith("&")) inputQuery = inputQuery.slice(0, -1);
      console.log(`Building input "${input.id}" with query: ${inputQuery}`);
      actionInputs[input.id] = await medplum.searchResources(input.type as ResourceType, inputQuery);
      // Manual profile filtering until Medplum support is added
      if (input.profile !== undefined) {
        actionInputs[input.id] = actionInputs[input.id]?.filter(res => res.meta?.profile?.some(v => input.profile?.includes(v)))
      }

      // If context.workflowTag is defined, we should only operate on Resources with that tag
      if (context.workflowTag !== undefined) {
        for (const key of Object.keys(actionInputs)) {
          actionInputs[key] = actionInputs[key]?.filter(res => res.meta?.tag?.some(v => v.system === ECR_WORKFLOW_TAG_SYSTEM && v.code === context.workflowTag));
        }
      }
    }
  }

  // Check all conditions, quitting if any are false
  if (actionToProcess.condition !== undefined) {
    const fhirpathConditions = actionToProcess.condition.filter(v => v.expression?.language === "text/fhirpath");
    for (const condition of fhirpathConditions) {
      console.log(`Evaluating: ${condition.expression?.expression}:`);
      if (condition.expression?.expression !== undefined
        && fhirpath.evaluate({}, condition.expression?.expression, actionInputs).find(v => v === false))
      {
        // Some condition is false, so stop action
        console.log("Evaluated as false -- exiting action");
        return;
      }
    }
  }

  // Process any 'after*' relatedActions
  {
    const relatedActions = actionToProcess.relatedAction?.filter(v => v.relationship?.startsWith('after')) ?? [];
    for (const relatedAction of relatedActions) {
      // Note: Intentionally not dealing with relatedAction.offsetDuration here because
      //  it is too complicated to schedule the remaining work of this action to resume
      //  after this relatedAction
      // Maybe a simple setTimeout will work for short offsets
      if (relatedAction.actionId !== undefined) {
        await performAction(pdToProcessUrl, relatedAction.actionId, reportEndpoint, context);
      }
    }
  }

  // Perform event-specific logic
  /** (from eCRNow)
    initiate-reporting-workflow=com.drajer.bsa.kar.action.InitiateReporting
    execute-reporting-workflow=com.drajer.bsa.kar.action.ExecuteReportingActions
    check-trigger-codes=com.drajer.bsa.kar.action.CheckTriggerCodes
    evaluate-condition=com.drajer.bsa.kar.action.EvaluateCondition
    evaluate-measure=com.drajer.bsa.kar.action.EvaluateMeasure
    create-report=com.drajer.bsa.kar.action.CreateReport
    validate-report=com.drajer.bsa.kar.action.ValidateReport
    submit-report=com.drajer.bsa.kar.action.SubmitReport
    complete-reporting=com.drajer.bsa.kar.action.CompleteReporting
    check-participant-registration=com.drajer.bsa.kar.action.CheckParticipant
    check-response=com.drajer.bsa.kar.action.CheckResponse
   */
  const actionCode = actionToProcess.code?.[0].coding?.[0].code;
  if (actionCode === undefined) throw new Error(`PlanDefinition "${pdToProcessUrl}": Action with id "${actionToProcess.id}" does not contain a code`);
  switch (actionCode) {
    case "initiate-reporting-workflow":
      // Empty action
      break;
    case "execute-reporting-workflow":
      // Perform first sub-action
      await performAction(pdToProcessUrl, actionToProcess.action![0].id!, reportEndpoint, context);
      break;
    case "check-trigger-codes":
      // Empty action (handled when building input above)
      break;
    case "evaluate-condition":
      // Empty action (handled above)
      break;
    case "evaluate-measure":
      // TODO
      break;
    case "create-report": {
      // com.drajer.bsa.kar.action.MedMorphReportCreator
      const tags = [{ system: PROJECT_TAG_SYSTEM, code: PROJECT_TAG_CODE_SERVER }, { system: BUNDLE_PATIENT_TAG_SYSTEM, code: context.patient.id ?? context.patient.identifier?.[0].value }];
      if (context.workflowTag !== undefined) tags.push({ system: ECR_WORKFLOW_TAG_SYSTEM, code: context.workflowTag });
      const outputDR = actionToProcess.output?.find(v => v.type === "Bundle");
      if (outputDR === undefined) throw new Error("Output DataRequirement not defined for 'create-report' action -- stopping");

      /** We must also send any Observations that were referenced in the DiagnosticReport to the final endpoint
       * We will build the list of Observations here
       */
      const referencedObs: Observation[] = [];
      for (const inputList of Object.values(actionInputs)) {
        for (const input of inputList ?? []) {
          if (input.resourceType === "DiagnosticReport") {
            for (const result of input.result ?? []) {
              continue;
            }
          }
        }
      }


      const outBundle: Bundle = {
        id: outputDR.id,
        resourceType: "Bundle",
        type: "message",
        meta: {
          profile: outputDR.profile,
          tag: tags
        },
        // TODO: timestamp
        entry: [
          {
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
                  code: actionCode,
                }]
              }
            }
          },
          {
            resource: {
              resourceType: "Bundle",
              type: "collection",
              meta: {
                profile: [ CONTENT_BUNDLE_PROFILE ]
              },
              // TODO: timestamp
              entry: Object.values(actionInputs).flatMap<BundleEntry>(resList => resList?.map(v => ({ resource: v })) ?? []),
            }
          }
        ] 
      }
      const result = await medplum.createResource(outBundle);
      context.tempResources?.push({resType: "Bundle", id: result.id!})
      console.log("Created temp report Bundle on Medplum:");
      console.dir(result, {depth: undefined});
      break;
    }
    case "validate-report": {
      const reportInputId = actionToProcess.input?.find(v => v.type === "Bundle")?.id;
      const reportToValidate = actionInputs[reportInputId!]?.find(res => res.meta?.tag?.some(v => v.system === BUNDLE_PATIENT_TAG_SYSTEM && (v.code === (context.patient.id ?? context.patient.identifier?.[0].value))));
      if (reportToValidate === undefined) {
        throw new Error("Could not find report to validate");
      }
      const result = await medplum.validateResource(reportToValidate);
      if (result.issue?.some(v => v.severity === "error" || v.severity === "fatal" || v.severity === "warning")) {
        throw new Error("Report failed validation")
      }
      break;
    }
    case "submit-report": {
      const reportInputId = actionToProcess.input?.find(v => v.type === "Bundle")?.id;
      const reportToSubmit = actionInputs[reportInputId!]?.find(res => res.meta?.tag?.some(v => v.system === BUNDLE_PATIENT_TAG_SYSTEM && (v.code === (context.patient.id ?? context.patient.identifier?.[0].value))));
      if (reportToSubmit === undefined) {
        throw new Error("Could not find report to submit");
      }

      if (reportToSubmit?.meta?.profile !== undefined) reportToSubmit.meta.profile = undefined; // Profile here is CAP endpoint to return error

      console.log(`Sending the following report to endpoint ${reportEndpoint}:`);
      console.dir(reportToSubmit, {depth: undefined});
      const response = await fetch(
        reportEndpoint, {
          method: "POST",
          body: JSON.stringify(reportToSubmit),
          headers: {
            'Content-Type': 'application/fhir+json',
            'Authorization': `Bearer ${process.env.ENDPOINT_AUTH}`,
          },
        });
      console.log("Response from endpoint:");
      console.dir(await response.json(), {depth: undefined});
      break;
    }
    case "complete-reporting":
      // TODO
      break;
    case "check-participant":
      // TODO
      break;
    case "check-response":
      // TODO
      break;
  }

  // Process any 'before*' and 'concurrent*' relatedActions
  {
    const relatedActions = actionToProcess.relatedAction?.filter(v => v.relationship !== undefined && !v.relationship.startsWith('after')) ?? [];
    for (const relatedAction of relatedActions) {
      // TODO: deal with relatedAction.offsetDuration
      if (relatedAction.actionId !== undefined) {
        await performAction(pdToProcessUrl, relatedAction.actionId, reportEndpoint, context);
      }
    }
  }

}