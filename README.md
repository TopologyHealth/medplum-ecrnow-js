# medplum-ecrnow-js

Is a [MedPlum](medplum.com/) [Bot](https://www.medplum.com/docs/bots) that follows the [MedMorph](https://build.fhir.org/ig/HL7/fhir-medmorph/) Reference architecture, which defines a common standard for registry reporting for multiple use cases. This bot behaves as a MedMorph 'Health Data Exchange App (HDEA)'

When a FHIR [Transaction Bundle](https://www.hl7.org/fhir/bundle.html) is posted to MedPlum the bot will send a MedMorph compliant message bundle to the registry endpoint.

Currently this bot only supports the [Cancer Pathology Data Sharing](https://hl7.org/fhir/us/cancer-reporting/) Implementation Guide, but in the future could support other guides which utilize the MedMorph architecture. 

This app is split between the MedPlum Bot and Notification Server. Instruction for each of those components can be found in their respective folders.
