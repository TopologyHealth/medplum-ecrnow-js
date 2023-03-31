#!/usr/bin/env -S ts-node -T

import * as dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import { MedplumClient } from "@medplum/core";
import fetch from "node-fetch";
import { Resource } from '@medplum/fhirtypes';
import { ENDPOINT_PATH, SubNotification } from '../common/common.mjs';
import { buildContext, performAction, Context } from './server-logic.mjs';

const app = express();
app.use(express.json({type: "application/fhir+json", limit: "50mb"}));

app.post(`/${ENDPOINT_PATH}`, async (req: express.Request<any, any, Resource>, res: express.Response, next) => {
  // Gather all necessary Resources, like the referenced PlanDefinition into a "context" object
  let context: Context | undefined = undefined;
  try {
    const pdToProcess = req.header("pd-to-process");
    const actionToProcess = req.header("action-to-process");
    const reportEndpoint = req.header("report-endpoint");
    if (pdToProcess === undefined || pdToProcess.length === 0) return res.status(500).send('Missing header "pd-to-process"');
    if (actionToProcess === undefined || actionToProcess.length === 0) return res.status(500).send('Missing header "action-to-process"');
    if (reportEndpoint === undefined || reportEndpoint.length === 0) return res.status(500).send('Missing header "report-endpoint"');
    try {
      context = await buildContext(req.body.resourceType, req.body.id!);
    }
    catch (error) {
      return res.send("The Resource cannot be handled by this server -- ignoring");
    }

    // Perform the PlanDefinition action with the provided context
    await performAction(decodeURIComponent(pdToProcess), actionToProcess, decodeURIComponent(reportEndpoint), context);

  } catch (error) {
    console.dir(error, {depth: undefined});
    return next(error);
  } finally {
    // Delete any temporarily uploaded Resources
    if (context?.workflowTag !== undefined) {
      if (process.env.MEDPLUM_CLIENT_ID === undefined) throw new Error("MEDPLUM_CLIENT_ID environment variable is missing");
      if (process.env.MEDPLUM_CLIENT_SECRET === undefined) throw new Error("MEDPLUM_CLIENT_SECRET environment variable is missing");
      const medplum = new MedplumClient({ fetch: fetch });
      await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);
      for (const res of context.tempResources ?? []) {
        await medplum.deleteResource(res.resType, res.id);
      }
    }
  }
  return res.send("Processed event without error");
})

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`http://localhost:${port}`));