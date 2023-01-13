/**
 * Warning: Medplum bot environment seems to not support Array.flatMap or Object.entries
 */

import { BotEvent, MedplumClient } from "@medplum/core";
import { ENDPOINT_PATH, SubNotification } from '../../common/common.mjs';
import { Bundle, BundleEntry, Endpoint, PlanDefinition, Subscription, TriggerDefinition } from '@medplum/fhirtypes';

// TODO: ersd_v2.json uses "http://.../us/ecr/..." for extension names
const KAR_BUNDLE_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-specification-bundle";
const RECEIVER_ADDRESS_URL = "http://hl7.org/fhir/us/medmorph/StructureDefinition/ext-receiverAddress";
const NAMED_EVENT_EXTENSION = "http://hl7.org/fhir/us/medmorph/StructureDefinition/ext-us-ph-namedEventType";
const NAMED_EVENT_CODE_SYSTEM = "http://hl7.org/fhir/us/medmorph/CodeSystem/us-ph-triggerdefinition-namedevents";
const NAMED_EVENT_CODE_SYSTEM_CUSTOM = "http://topology.health/fhir/CodeSystem/topology-custom-triggerdefinition-namedevents";
const BACKPORT_SUBSCRIPTION = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-subscription";
const BACKPORT_TOPIC = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-topic-canonical";
const BACKPORT_PAYLOAD = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-payload-content";
const BACKPORT_ADDITIONAL_CRITERIA = "http://hl7.org/fhir/uv/subscriptions-backport/StructureDefinition/backport-additional-criteria";

export const PROJECT_TAG_SYSTEM = "http://topology.health/fhir/CodeSystem/medplum-ecrnow-js";
export const PROJECT_TAG_CODE = "medplum-ecrnow-js-bot";

function findUsPhNamedEventCriteria(trigger: TriggerDefinition): string | undefined {
  const named_ev_ext = trigger.extension?.find(v => v.url === NAMED_EVENT_EXTENSION)
  if (named_ev_ext === undefined) return;
  if (named_ev_ext.valueCodeableConcept === undefined) return;
  const named_ev_coding = named_ev_ext.valueCodeableConcept.coding?.find(v => v.system === NAMED_EVENT_CODE_SYSTEM);
  if (named_ev_coding === undefined || named_ev_coding.code === undefined) return;

  // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.namedEventToCriteria
  const code_parts = named_ev_coding.code.split('-');
  let event_name: string;
  if (code_parts[0] === "new" || code_parts[0] === "modified") {
    event_name = code_parts[1];
  }
  else if (code_parts[1] === "change" || code_parts[1] === "start" || code_parts[1] === "close") {
    event_name = code_parts[0];
  }
  else return;

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
    default:
      return;
  }
  // END com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.namedEventToCriteria
  return subscription_criteria;
}

function findCustomNamedEventCriteria(trigger: TriggerDefinition): string | undefined {
  const named_ev_ext = trigger.extension?.find(v => v.url === NAMED_EVENT_EXTENSION)
  if (named_ev_ext === undefined) return;
  if (named_ev_ext.valueCodeableConcept === undefined) return;
  const named_ev_coding = named_ev_ext.valueCodeableConcept.coding?.find(v => v.system === NAMED_EVENT_CODE_SYSTEM_CUSTOM);
  if (named_ev_coding === undefined || named_ev_coding.code === undefined) return;

  const event_name = named_ev_coding.code;

  let subscription_criteria: string;
  switch (event_name) {
    case "new-bundle":
      subscription_criteria = "Bundle";
      break;
    default:
      return;
  }
  return subscription_criteria;
}

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const kar = event.input as Bundle;
  if (kar.entry === undefined || !(kar.meta?.profile?.some(v => v === KAR_BUNDLE_PROFILE))) return;

  // Upload dependencies
  for (const entry of kar.entry) {
    if (entry.resource === undefined || !("url" in entry.resource) || entry.resource.url === undefined) continue;
    switch (entry.resource.resourceType) {
      case "ValueSet":
        const existing = await medplum.searchOne("ValueSet", `url=${entry.resource.url}`);
        if (existing) await medplum.deleteResource("ValueSet", existing.id!);
        await medplum.createResourceIfNoneExist(entry.resource, `url=${entry.resource.url}`);
        break;
      case "Library":
        // TODO: Ignore?
        break;
    }
  }

  // Create FHIR Subscriptions
  // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.createSubscriptions
  // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.subscriptionsFromBundle
  const subscription_endpoint = new URL(ENDPOINT_PATH, event.secrets.ECR_SUBSCRIPTION_SERVER_URL.valueString).href;

  const pd_list = kar.entry.filter(
    (v): v is BundleEntry<PlanDefinition> => v.resource?.resourceType === "PlanDefinition"
  ).map(v => v.resource).filter((v): v is PlanDefinition => v !== undefined);

  const new_subscriptions: Subscription[] = [];
  for (const pd of pd_list) {
    if (pd.id === undefined || pd.url === undefined) continue;

    let report_endpoint: string;
    const receiver_address_ext = pd.extension?.find(v => v.url === RECEIVER_ADDRESS_URL);
    if (receiver_address_ext === undefined) continue;
    if (receiver_address_ext.valueString !== undefined) {
      report_endpoint = receiver_address_ext.valueString;
    }
    else if (receiver_address_ext.valueReference !== undefined
        && receiver_address_ext.valueReference.reference?.startsWith('Endpoint/'))
      {
      const [_resType, endpoint_id] = receiver_address_ext.valueReference.reference.split('/');
      const endpoint_res = kar.entry.find((v): v is BundleEntry<Endpoint> => v.resource?.resourceType === "Endpoint" && v.resource.id === endpoint_id);
      if (endpoint_res === undefined || endpoint_res.resource?.address === undefined) continue;
      report_endpoint = endpoint_res.resource.address;
    }
    else continue;

    const existing = await medplum.searchOne("PlanDefinition", `url=${pd.url}`);
    if (existing) await medplum.deleteResource("PlanDefinition", existing.id!);
    await medplum.createResourceIfNoneExist(pd, `url=${pd.url}`);
    // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.subscriptionsFromPlanDef
    for (const action of pd.action ?? []) {
      // com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.generateSubscription
      if (action.trigger === undefined || action.id === undefined) continue;
      for (const trigger of action.trigger) {
        let subscription_criteria = findUsPhNamedEventCriteria(trigger);
        if (subscription_criteria === undefined) subscription_criteria = findCustomNamedEventCriteria(trigger);
        if (subscription_criteria === undefined) continue;

        // if (subscription_criteria.search(/\?/) === -1) subscription_criteria += "?" // Line 166: "HAPI expects some criteria"

        const notif_params: SubNotification = {
          "pd-to-process": encodeURIComponent(pd.url),
          "action-to-process": action.id,
          "report-endpoint": encodeURIComponent(report_endpoint),
        }

        const cur_subscription: Subscription = {
          id: `sub-${pd.id}-${action.id}-${trigger.id}`,
          meta: {
            profile: [BACKPORT_SUBSCRIPTION],
            tag: [{ system: PROJECT_TAG_SYSTEM, code: PROJECT_TAG_CODE }]
          },
          // TODO: Is this necessary?
          // extension: [{
          //   url: BACKPORT_TOPIC,
          //   valueString: `http://example.org/medmorph/subscriptiontopic/${named_ev_coding.code}`,
          // }],
          resourceType: "Subscription",
          criteria: subscription_criteria,
          status: "active",
          channel: {
            // Medplum includes the triggering resource as the body of a notification:
            // https://github.com/medplum/medplum/blob/5ab223a6ba76f2c4b0ae234484ff4e5d6240ab35/packages/server/src/workers/subscription.ts#L304
            type: "rest-hook",
            endpoint: subscription_endpoint,
            header: Object.keys(notif_params).map((v) => `${v}: ${(notif_params as any)[v]}`),
          },
          reason: "PLACEHOLDER", // TODO: Find where this is set in eCRNow
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
          (cur_subscription as any)._criteria = {
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
  console.log(`Generated ${new_subscriptions.length} new Subscription(s) from KAR:`);
  console.dir(new_subscriptions, { depth: undefined });
  const created_subscriptions: Subscription[] = [];
  for (const sub of new_subscriptions) {
    created_subscriptions.push(await medplum.createResource(sub));
  }

  // END com.drajer.bsa.ehr.subscriptions.impl.SubscriptionGeneratorImpl.createSubscriptions
}