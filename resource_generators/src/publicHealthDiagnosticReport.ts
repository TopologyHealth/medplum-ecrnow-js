import { CareTeam, Device, DiagnosticReport, Group, Location, Observation, Organization, Patient, Practitioner, PractitionerRole, Reference } from '@medplum/fhirtypes';

const US_PUBLIC_HEALTH_DIAGNOSTIC_REPORT_PROFILE = "http://hl7.org/fhir/us/cancer-reporting/StructureDefinition/us-pathology-diagnostic-report";

export function createUSPublicHealthDiagnosticReport(
  subject: Reference<Device | Group | Location | Patient>,
  performer: Reference<CareTeam | Organization | Practitioner | PractitionerRole>,
  results: Reference<Observation>[]
): DiagnosticReport {
  return {
    resourceType: "DiagnosticReport",
    meta: {
      profile: [US_PUBLIC_HEALTH_DIAGNOSTIC_REPORT_PROFILE]
    },
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v2-0074",
            code: "PAT",
            display: "Pathology"
          }
        ]
      }
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "60568-3",
          display: "Pathology Synoptic report"
        }
      ]
    },
    subject: subject,
    performer: [performer],
    result: results
  };
}