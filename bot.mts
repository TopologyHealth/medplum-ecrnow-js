#!/usr/bin/env -S ts-node -T

import * as dotenv from 'dotenv'
dotenv.config()
import { Bundle, BundleEntry, Condition, Library, PlanDefinition, PlanDefinitionAction, Subscription, ValueSet } from "fhir/r4";
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { MedplumClient } from "@medplum/core";
import fetch from "node-fetch";
import * as fs from 'fs';
import { ENDPOINT_PATH, SubNotification } from './common.mjs';


const LOG_FILE = "./bot_out";
function write_log(str_or_obj) {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '');
  }
  if (typeof(str_or_obj) === 'object') str_or_obj = JSON.stringify(str_or_obj, null, 2);
  try {
    fs.appendFileSync(LOG_FILE, str_or_obj);
  } catch (err) {
    console.error(err);
  }
}

// const ersd_obj = ERSD as Bundle;
const KAR_FOLDER = "./deps/kars";
// TODO: ersd_v2.json uses "http://.../us/ecr/..." for extension names
const RECEIVER_ADDRESS_URL = "http://hl7.org/fhir/us/medmorph/StructureDefinition/ext-receiverAddress";
const NAMED_EVENT_EXTENSION = "http://hl7.org/fhir/us/medmorph/StructureDefinition/ext-us-ph-namedEventType";
const NAMED_EVENT_CODE_SYSTEM = "http://hl7.org/fhir/us/medmorph/CodeSystem/us-ph-triggerdefinition-namedevents";
const BACKPORT_SUBSCRIPTION = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-subscription";
const BACKPORT_TOPIC = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-topic-canonical";
const BACKPORT_PAYLOAD = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-payload-content";
const BACKPORT_ADDITIONAL_CRITERIA = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-additional-criteria";
const SUBSCRIPTION_ENDPOINT = `http://www.example.com/${ENDPOINT_PATH}`;

// Knowledge Artifact (comments from eCRNow com.drajer.bsa.kar.model.KnowledgeArtifact)
interface KnowledgeArtifact {
  /**
   * The original Bundle containing all the components of a knowledge artifact. This is flattened
   * into what is required for processing in the other attributes.
   */
  originalBundle: Bundle,
  path?: string,
  /**
   * The unique id for the KnowledgeArtifact, this along with the version will make the
   * KnowledgeArtifact unique.
   */
  id: string,
  /**
   * The version of the KnowledgeArtifact, this along with the karId will make the KnowledgeArtifact
   * unique.
   */
  version: string,
  /** The human friendly name of the KnowledgeArtifact */
  name?: string,
  /** The publisher name of the KnowledgeArtifact */
  publisher?: string,
  /**
   * The Map of actions present in the KnowledgeArtifact. The string(Key) is the Action id present
   * in the Knowledge Artifact.
   */
  actions: Map<string, Set<PlanDefinitionAction>>,
  /** This attribute represents the receivers of the Report created by the BSA. */
  receiverAddresses: string[],
  dependencies: {
    "ValueSet": Map<string, ValueSet>,
    // "TODO (Group Instances)": Map<string, Set<TODO>>,
    "Library": Map<string, Library>,
  }
}

async function processKa(ka_bundle: Bundle, medplum: MedplumClient): Promise<KnowledgeArtifact> {
  const ka: KnowledgeArtifact = {
    originalBundle: ka_bundle,
    id: ka_bundle.id,
    version: ka_bundle.meta?.versionId ?? "",
    actions: new Map(),
    receiverAddresses: [],
    dependencies: {
      "ValueSet": new Map(),
      "Library": new Map(),
    },
  }

  if (ka_bundle.entry === undefined) return ka;

  for (const entry of ka_bundle.entry) {
    if (entry.resource === undefined) continue;
    switch (entry.resource.resourceType) {
      case "ValueSet":
        if (ka.dependencies.ValueSet.has(entry.resource.url)) {
          console.log(`Warning: Additional ValueSet with url ${entry.resource.url} found in knowledge artifact -- skipping `);
          continue;
        }
        ka.dependencies.ValueSet.set(entry.resource.url, entry.resource);
        await medplum.createResourceIfNoneExist(entry.resource, `url=${entry.resource.url}`);
        break;
      case "PlanDefinition":
        if (ka.name !== undefined) {
          // Avoid overwriting previous PD info
          console.log("Warning: Additional PlanDefinition found in knowledge artifact -- skipping");
          continue;
        }

        // com.drajer.bsa.service.impl.KarParserImpl.processPlanDefinition
        const pd = entry.resource;
        ka.name = pd.name ?? `PD ID: ${pd.id}`;
        ka.publisher = pd.publisher;

        // com.drajer.bsa.service.impl.KarParserImpl.processExtensions
        if (pd.extension !== undefined) {
          const receiver_address_ext = pd.extension.find(v => v.url === RECEIVER_ADDRESS_URL);
          if (receiver_address_ext !== undefined && receiver_address_ext.valueString !== undefined) {
            ka.receiverAddresses.push(receiver_address_ext.valueString);
          }
        }
        // END com.drajer.bsa.service.impl.KarParserImpl.processExtensions

        for (const action of pd.action ?? []) {
          if (action.code === undefined || action.code.length === 0) continue;
          if (action.code[0].coding === undefined || action.code[0].coding.length === 0) continue;
          const firstCoding = action.code[0].coding[0]; // eCRNow only processes first code's first Coding
          // TODO (Possibly not needed)
        }
        // END com.drajer.bsa.service.impl.KarParserImpl.processPlanDefinition
        await medplum.createResource(entry.resource);
        break;
      case "Library":
        // TODO: Ignore?
        break;
    }
  }

  // Create FHIR Subscriptions
  // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.createSubscriptions
  // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.subscriptionsFromBundle
  const pd_list = ka_bundle.entry.filter(
    (v): v is BundleEntry<PlanDefinition> => v.resource.resourceType === "PlanDefinition"
  ).map(v => v.resource);

  const new_subscriptions: Subscription[] = [];
  for (const pd of pd_list) {
    // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.subscriptionsFromPlanDef
    for (const action of pd.action ?? []) {
      // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.generateSubscription
      if (action.trigger === undefined) continue;
      for (const trigger of action.trigger) {
        if (trigger.extension === undefined) continue;
        const named_ev_ext = trigger.extension.find(v => v.url === NAMED_EVENT_EXTENSION)
        if (named_ev_ext === undefined) continue;
        if (named_ev_ext.valueCodeableConcept === undefined) continue;
        const named_ev_coding = named_ev_ext.valueCodeableConcept.coding.find(v => v.system === NAMED_EVENT_CODE_SYSTEM);
        if (named_ev_coding === undefined || named_ev_coding.code === undefined) continue;

        // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.namedEventToCriteria
        const code_parts = named_ev_coding.code.split('-');
        let event_name: string;
        if (code_parts[0] === "new" || code_parts[0] === "modified") {
          event_name = code_parts[1];
        }
        else if (code_parts[1] === "change" || code_parts[1] === "start" || code_parts[1] === "close") {
          event_name = code_parts[0];
        }
        if (event_name === undefined) continue;
        let subscription_criteria: string;
        switch (event_name) {
          case "encounter":
            subscription_criteria = "Encounter";
            break;
          case "diagnosis":
            subscription_criteria = "Condition";
            break;
          case "medication":
            subscription_criteria = "Medication";
            break;
          case "labresult":
            subscription_criteria = "Observation?category=laboratory";
            break;
          case "order":
            subscription_criteria = "ServiceRequest";
            break;
          case "procedure":
            subscription_criteria = "Procedure";
            break;
          case "immunization":
            subscription_criteria = "Immunization";
            break;
          case "demographic":
            subscription_criteria = "Patient";
            break;
        }
        // END com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.namedEventToCriteria
        if (subscription_criteria === undefined) continue;

        if (subscription_criteria.search(/\?/) === -1) subscription_criteria += "?" // Line 166: "HAPI expects some criteria"

        const notif_params: SubNotification = {
          pdToProcess: pd.id,
          actionToProcess: action.id,
        }

        const cur_subscription: Subscription = {
          id: `sub-${pd.id}-${action.id}-${named_ev_coding.code}`,
          meta: {
            profile: [BACKPORT_SUBSCRIPTION]
          },
          extension: [{
            url: BACKPORT_TOPIC,
            valueString: `http://example.org/medmorph/subscriptiontopic/${named_ev_coding.code}`,
          }],
          resourceType: "Subscription",
          criteria: subscription_criteria,
          status: "requested",
          channel: {
            // Medplum includes the triggering resource as the body of a notification:
            // https://github.com/medplum/medplum/blob/5ab223a6ba76f2c4b0ae234484ff4e5d6240ab35/packages/server/src/workers/subscription.ts#L304
            type: "rest-hook",
            endpoint: SUBSCRIPTION_ENDPOINT,
            header: Object.entries(notif_params).map(v => `${v[0]}: ${v[1]}`),
          },
          reason: "", // TODO: Find where this is set in eCRNow
        }

        /**
         * eCRNow creates a Subscription that uses the following payload, which is 
         * unsupported by Medplum at the moment. However, if Medplum adds support 
         * for "application/fhir+json" but not for the `BACKPORT_PAYLOAD` extension 
         * as well, then this payload will be processed entirely incorrect.
         * 
         * To be safe, this payload should not be used while Medplum is the target EHR
         */
        // cur_subscription.channel.payload = "application/fhir+json";
        // cur_subscription.channel._payload = {
        //     extension: [{
        //         url: BACKPORT_PAYLOAD,
        //         valueCode: "full-resource",
        //     }],
        // };

        if (subscription_criteria === "Medication") {
          cur_subscription._criteria = {
            extension: [{
              url: BACKPORT_ADDITIONAL_CRITERIA,
              valueString: "MedicationDispense"
            }, {
              url: BACKPORT_ADDITIONAL_CRITERIA,
              valueString: "MedicationStatement"
            }, {
              url: BACKPORT_ADDITIONAL_CRITERIA,
              valueString: "MedicationAdministration"
            }]
          }
        }

        new_subscriptions.push(cur_subscription)

      }
      // END com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.generateSubscription
    }
    // END com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.subscriptionsFromPlanDef
  }
  // END com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.subscriptionsFromBundle

  // Create Subscriptions in Medplum
  console.dir(new_subscriptions, { depth: undefined });
  const created_subscriptions: Subscription[] = [];
  for (const sub of new_subscriptions) {
    // created_subscriptions.push(await medplum.createResource(sub));
  }

  // END com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.createSubscriptions
  return ka;
}

function isCollectionBundle(res: any): res is Bundle {
  return "resourceType" in res && res["resourceType"] == "Bundle"
    && res["type"] === "collection";
}

async function main(kar_dir: string, medplum: MedplumClient) {
  const ka_paths = readdirSync(kar_dir).map(file => path.join(kar_dir, file));
  console.log(ka_paths);
  const ka_list: KnowledgeArtifact[] = [];
  for (const path of ka_paths) {
    const ka_obj = JSON.parse(readFileSync(path).toString())
    console.log(`Processing bundle at ${path}`);
    if (isCollectionBundle(ka_obj)) {
      ka_list.push(await processKa(ka_obj, medplum));
    }
    console.log(`Finished processing bundle at ${path}`);
  }
  console.log(ka_list);
}

const medplum = new MedplumClient({ fetch: fetch });
await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_SECRET);
const cond: Condition = {
  id: 'test-condition-delete11',
  resourceType: "Condition",
  subject: {
    reference: "Patient/test-patient",
  },
  code: {
    coding: [{
      system: "http://snomed.info/sct",
      code: "408643008",
    }]
  }
}
try {
  console.dir(await medplum.createResourceIfNoneExist(cond, `code=408643008`), { depth: undefined });
  // console.dir(await medplum.deleteResource('PlanDefinition', `9be1e693-cabe-4e70-811f-d3f33e99e70f`), { depth: undefined });
  console.dir(await medplum.search('Condition', 'code:in=http://hl7.org/fhir/us/medmorph/ValueSet/valueset-cancer-trigger-codes-example'), { depth: undefined });
  console.dir(await medplum.search('Condition', 'code:in=Valueset/9bb384c5-47a4-45df-87f4-db4f553701b4'), { depth: undefined });
  console.dir(await medplum.search('Condition', 'code=408643008'), { depth: undefined });
  // console.dir(await medplum.search('Patient', 'code=408643008'), { depth: undefined });
  await main(KAR_FOLDER, medplum);
} catch (e) {
  console.dir(e, { depth: undefined });
}