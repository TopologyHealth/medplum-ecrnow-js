import { Bundle, BundleEntry, Resource } from '@medplum/fhirtypes';

const CONTENT_BUNDLE_PROFILE = "http://hl7.org/fhir/us/medmorph/StructureDefinition/us-ph-content-bundle";

export function createMedMorphContentBundle(resources: Resource[]): Bundle {
  return {
    resourceType: "Bundle",
    type: "collection",
    meta: {
      profile: [CONTENT_BUNDLE_PROFILE]
    },
    entry: resources.map(resource => ({
      resource: resource
    }))
  };
}