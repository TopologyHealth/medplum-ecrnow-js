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
    context = await buildContext("Bundle", "35bc1415-578f-4b7e-aa17-02274b4a3a0a");
    console.log(await performAction(
      "http://hl7.org/fhir/us/central-cancer-registry-reporting/StructureDefinition/plandefinition-central-cancer-registry-reporting-example",
      "start-workflow", "http://long-dream-6bf8.michael-jackson-222.workers.dev", context));
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