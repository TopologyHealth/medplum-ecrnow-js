#!/usr/bin/env -S ts-node -T
/**
 * This script tests the server's logic on a preset Bundle and PD
 * that should be present on Medplum
 */

import * as dotenv from 'dotenv';
dotenv.config();
import { MedplumClient } from "@medplum/core";
import fetch from "node-fetch";
import { buildContext, performAction, Context } from "../server-logic.mjs";

try {
  // Testing
  let context: Context | undefined = undefined;
  try {
    context = await buildContext("Bundle", "b7d72ae2-3077-4c72-bb05-cc968c78b27b");
    console.log(await performAction(
      "http://hl7.org/fhir/us/central-cancer-registry-reporting/StructureDefinition/plandefinition-central-cancer-registry-reporting-example",
      "start-workflow", "http://20.84.81.240:8080/r4/fhir/$process-message", context));
  }
  catch (error) {
    throw error;
  }
  finally {
    if (context?.workflowTag !== undefined) {
      // Delete all uploaded temporary Resources
      if (process.env.MEDPLUM_CLIENT_ID === undefined) throw new Error("MEDPLUM_CLIENT_ID environment variable is missing");
      if (process.env.MEDPLUM_CLIENT_SECRET === undefined) throw new Error("MEDPLUM_CLIENT_SECRET environment variable is missing");
      const medplum = new MedplumClient({ fetch: fetch });
      await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);
      for (const res of context.tempResources ?? []) {
        await medplum.deleteResource(res.resType, res.id);
      }
    }
  }
} catch (error) {
  console.dir(error, { depth: undefined });
  throw error;
}