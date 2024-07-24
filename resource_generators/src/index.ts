import { createMedMorphContentBundle } from './medmorphContentBundle';
import { createMedMorphMessageBundle } from './medmorphMessageBundle';
import { createMedMorphSubscription } from './medmorphSubscription';
import { createUSPublicHealthDiagnosticReport } from './publicHealthDiagnosticReport';

// Sample data for US Public Health Diagnostic Report
const sampleDiagnosticReport = createUSPublicHealthDiagnosticReport(
  { reference: 'Patient/123' },
  { reference: 'Practitioner/456' },
  [{ reference: 'Observation/789' }, { reference: 'Observation/101' }]
);

console.log('US Public Health Diagnostic Report:');
console.log(JSON.stringify(sampleDiagnosticReport, null, 2));
console.log('\n');

// Sample data for MedMorph Content Bundle
const sampleContentBundle = createMedMorphContentBundle([
  sampleDiagnosticReport,
  {
    resourceType: 'Patient',
    id: '123',
    name: [{ family: 'Doe', given: ['John'] }]
  },
  {
    resourceType: 'Observation',
    id: '789',
    status: 'final',
    code: { text: 'Sample Observation' }
  }
]);

console.log('MedMorph Content Bundle:');
console.log(JSON.stringify(sampleContentBundle, null, 2));
console.log('\n');

// Sample data for MedMorph Message Bundle
const sampleMessageBundle = createMedMorphMessageBundle(
  [sampleContentBundle],
  'subscription-notification',
  'cancer-report-message'
);

console.log('MedMorph Message Bundle:');
console.log(JSON.stringify(sampleMessageBundle, null, 2));
console.log('\n');

// Sample data for MedMorph Subscription
const sampleSubscription = createMedMorphSubscription(
  'DiagnosticReport?category=http://terminology.hl7.org/CodeSystem/v2-0074|PAT',
  'https://example.com/fhir/subscription-endpoint',
  {
    'Content-Type': 'application/fhir+json',
    'Authorization': 'Bearer TOKEN'
  }
);

console.log('MedMorph Subscription:');
console.log(JSON.stringify(sampleSubscription, null, 2));