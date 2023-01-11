#!/usr/bin/env -S ts-node -T

import * as dotenv from 'dotenv'
dotenv.config()
import express from 'express';
import { MedplumClient } from "@medplum/core";
import fetch from "node-fetch";
import { Bundle, BundleEntry, Coding, FhirResource, Identifier, Patient, PlanDefinition, PlanDefinitionAction, Reference, ValueSet } from 'fhir/r4';
import { ENDPOINT_PATH, SubNotification } from './common.mjs';
import * as fhirpath from 'fhirpath';

const app = express();
const port = process.env.PORT || 8087;

const US_PUBLIC_HEALTH_FHIR_QUERY_PATTERN_EXTENSION = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-fhirquerypattern-extension";
const MESSAGE_HEADER_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-messageheader";
const CONTENT_BUNDLE_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-content-bundle";
const MESSAGE_TYPE = "http://hl7.org/fhir/us/medmorph/CodeSystem/us-ph-messageheader-message-types";
const NAMED_EVENT_URL = "http://hl7.org/fhir/us/medmorph/CodeSystem/us-ph-triggerdefinition-namedevents";

interface Context {
  patient: Patient,
  resource: FhirResource,
}

async function buildContext(resourceType: string, resourceId: string): Promise<Context> {
  const medplum = new MedplumClient({ fetch: fetch });
  await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_SECRET);
  const notifRes: FhirResource = await medplum.readResource(resourceType, resourceId);
  let patient: Patient;
  if ("subject" in notifRes && "reference" in notifRes.subject) {
    const patientNPI = notifRes.subject.reference.split('/')[1]; // Reference is incorrect from CAP input
    patient = await medplum.searchOne("Patient", `identifier=urn:NPI|${patientNPI}`);
  }
  return {
    patient: patient,
    resource: notifRes,
  }
}

async function performAction(pdToProcessParam: string, actionId: string, context: Context) {
  console.log(`Performing action ${actionId} of PD ${pdToProcessParam}`);
  const medplum = new MedplumClient({ fetch: fetch });
  await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_SECRET);

  const pdToProcess: PlanDefinition = await medplum.searchOne("PlanDefinition", `url=${pdToProcessParam}`);
  
  // Find action to execute
  let actionToProcess: PlanDefinitionAction;
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
  if (actionToProcess === undefined) throw new Error(`PlanDefinition "${pdToProcessParam}": Could not find action "${actionId}"`);

  // Collect action inputs
  const actionInputs: { [id: string]: FhirResource[] | undefined } = {
    patient: [context.patient],
  };
  if (actionToProcess.input !== undefined) {
    for (const actionInput of actionToProcess.input) {
      let inputQuery = '';
      const ext = actionInput.extension?.find(v => v.url === US_PUBLIC_HEALTH_FHIR_QUERY_PATTERN_EXTENSION);
      if (ext !== undefined) {
        let [_resType, query] = ext.valueString?.split('?');
        query = query.replace('{{context.patientId}}', "1234567893")
        inputQuery += query;
      }
      // Waiting for Medplum support
      // else if (actionInput.profile !== undefined) {
      //   inputQuery += `_profile=${actionInput.profile.join(',')}`;
      // }
      else if (actionInput.codeFilter !== undefined) {
        inputQuery += (await Promise.all(actionInput.codeFilter.map(async (v) => {

          if (v.searchParam !== undefined) return v.searchParam;
          // Note: v.path must be provided (FHIR drq-1)

          if (v.valueSet !== undefined) {
            // return `${v.path}:in=${v.valueSet}`;
            // Alternative for ValueSet search while https://github.com/medplum/medplum/issues/1376 is unresolved:
            const vs: ValueSet = await medplum.searchOne('ValueSet', `url=${v.valueSet}`)
            const queryCodes = vs.compose.include.flatMap(include => include.concept.map(v => `${include.system}|${v.code}`));
            return `${v.path}=${queryCodes.join(',')}`;
          }

          if (v.code !== undefined && v.code.length > 0) return `${v.path}=${v.code.map(code => `${code.system}|${code.code}`).join(',')}`;

          return `${v.path}:missing=false`;

        }))).join('&');
      }
      // TODO: actionInput.dateFilter
      console.log(`Building input "${actionInput.id}" with query: ${inputQuery}`);
      actionInputs[actionInput.id] = await medplum.searchResources(actionInput.type, inputQuery);
    }
  }
  console.log(`Built inputs [${Object.keys(actionInputs).join(', ')}] for action`);

  if (actionToProcess.condition !== undefined) {
    const fhirpathConditions = actionToProcess.condition.filter(v => v.expression?.language === "text/fhirpath");
    for (const condition of fhirpathConditions) {
      console.log(`Evaluating: ${condition.expression?.expression}:`);
      if (fhirpath.evaluate({}, condition.expression?.expression, actionInputs).find(v => v === false)) {
        // Some condition is false, so stop action
        console.log("Evaluated as false -- exiting action");
        return;
      }
    }
  }

  // Process any 'after*' relatedActions
  {
    const relatedActions = actionToProcess.relatedAction?.filter(v => v.relationship.startsWith('after')) ?? [];
    for (const relatedAction of relatedActions) {
      // Note: Intentionally not dealing with relatedAction.offsetDuration here because
      //  it is too complicated to schedule the remaining work of this action to resume
      //  after this relatedAction
      await performAction(pdToProcessParam, relatedAction.actionId, context);
    }
  }

  /**
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
  if (actionCode === undefined) throw new Error(`PlanDefinition "${pdToProcessParam}": Action with id "${actionToProcess.id}" does not contain a code`);
  switch (actionCode) {
    case "initiate-reporting-workflow":
      // Empty action
      break;
    case "execute-reporting-workflow":
      // Perform first sub-action
      await performAction(pdToProcessParam, actionToProcess.action[0].id, context);
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
      const outputDR = actionToProcess.output.find(v => v.type === "Bundle");
      const outBundle: Bundle = {
        id: outputDR.id,
        resourceType: "Bundle",
        type: "message",
        meta: {
          profile: outputDR.profile
        },
        // TODO: timestamp
        entry: [
          {
            resource: {
              resourceType: "MessageHeader",
              meta: {
                profile: [ MESSAGE_HEADER_PROFILE ]
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
              entry: Object.values(actionInputs).flatMap<BundleEntry>(resList => resList.map(v => ({ resource: v }))),
            }
          }
        ] 
      }
      await medplum.createResource(outBundle);
      break;
    }
    case "validate-report": {
      const reportInputId = actionToProcess.input?.find(v => v.type === "Bundle").id;
      const reportToValidate = actionInputs[reportInputId][0];
      if (reportToValidate === undefined) {
        throw new Error("Could not find report to validate");
      }
      console.dir(reportToValidate, {depth: undefined});
      // TODO
      break;
    }
    case "submit-report": {
      const reportInputId = actionToProcess.input?.find(v => v.type === "Bundle").id;
      const reportToSubmit = actionInputs[reportInputId][0];
      if (reportToSubmit === undefined) {
        throw new Error("Could not find report to submit");
      }
      // TODO
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
    const relatedActions = actionToProcess.relatedAction?.filter(v => !v.relationship.startsWith('after')) ?? [];
    for (const relatedAction of relatedActions) {
      // TODO: deal with relatedAction.offsetDuration
      await performAction(pdToProcessParam, relatedAction.actionId, context);
    }
  }

}

app.post(`/${ENDPOINT_PATH}`, async (req: express.Request<SubNotification, any, FhirResource>, res: express.Response, next) => {
  try {
    if (req.params.pdToProcess === undefined || req.params.pdToProcess.length === 0) return res.status(500).send('Missing param "pdToProcess"');
    if (req.params.actionToProcess === undefined || req.params.actionToProcess.length === 0) return res.status(500).send('Missing param "actionToProcess"');
    const context = await buildContext(req.body.resourceType, req.body.id);
    return await performAction(req.params.pdToProcess, req.params.actionToProcess, context);
  } catch (error) {
    console.dir(error, {depth: undefined});
    return next(error);
  }
})

try {
  const context = await buildContext("Observation", "890bfbcc-3eb0-47bc-a457-67973feb464f");
  console.log(await performAction("http://hl7.org/fhir/us/central-cancer-registry-reporting/StructureDefinition/plandefinition-central-cancer-registry-reporting-example", "start-workflow", context));
  console.log("done test");
} catch (error) {
  console.dir(error, {depth: undefined});
  throw error;
}

// app.listen(port, () => console.log(`http://localhost:${port}`));