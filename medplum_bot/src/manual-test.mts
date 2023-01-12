#!/usr/bin/env -S ts-node -T

import * as dotenv from 'dotenv'
dotenv.config()
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { MedplumClient } from "@medplum/core";
import fetch from "node-fetch";
import { handler } from './bot.mjs';
import { Bundle } from '@medplum/fhirtypes';

const KAR_FOLDER = "../test_artifacts/kars";

function isCollectionBundle(res: any): res is Bundle {
  return "resourceType" in res && res["resourceType"] == "Bundle"
    && res["type"] === "collection";
}

async function main(kar_dir: string) {
  if (process.env.MEDPLUM_CLIENT_ID === undefined) throw new Error("MEDPLUM_CLIENT_ID environment variable is missing");
  if (process.env.MEDPLUM_CLIENT_SECRET === undefined) throw new Error("MEDPLUM_CLIENT_SECRET environment variable is missing");
  const medplum = new MedplumClient({ fetch: fetch });
  await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);
  try {
    const ka_paths = readdirSync(kar_dir).map(file => path.join(kar_dir, file));
    console.log(ka_paths);
    for (const path of ka_paths) {
      const ka_obj = JSON.parse(readFileSync(path).toString())
      console.log(`Processing bundle at ${path}`);
      if (isCollectionBundle(ka_obj)) {
        console.log(`Uploading bundle at ${path}`);
        await medplum.createResource(ka_obj);
      //   await handler(medplum, { input: ka_obj, contentType: "", secrets: { ECR_SUBSCRIPTION_SERVER_URL: { valueString: "https://long-dream-6bf8.michael-jackson-222.workers.dev" } } });
      }
      console.log(`Finished processing bundle at ${path}`);
    }

  } catch (e) {
    console.dir(e, { depth: undefined });
  }
}

main(KAR_FOLDER);