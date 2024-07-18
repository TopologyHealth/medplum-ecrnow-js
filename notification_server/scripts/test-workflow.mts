#!/usr/bin/env -S ts-node -T
/**
 * This script will upload all Resources found in `INPUT_FOLDER` to Medplum, which
 * will trigger any Bot workflows that have been configured for that Resource
 */

import * as dotenv from 'dotenv';
dotenv.config();
import { MedplumClient } from "@medplum/core";
import { Bundle } from "@medplum/fhirtypes";
import { readdirSync, readFileSync } from "fs";
import fetch from "node-fetch";
import path from "path";

const INPUT_FOLDER = "../test_artifacts/inputs";

async function main() {
  if (process.env.MEDPLUM_CLIENT_ID === undefined) throw new Error("MEDPLUM_CLIENT_ID environment variable is missing");
  if (process.env.MEDPLUM_CLIENT_SECRET === undefined) throw new Error("MEDPLUM_CLIENT_SECRET environment variable is missing");
  const medplum = new MedplumClient({ fetch: fetch });
  await medplum.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);

  try {
    // const bundle: Bundle = {
    //   resourceType: "Bundle",
    //   type: "batch",
    // }
    // console.dir(await medplum.createResource(bundle), { depth: undefined });
    const res_paths = readdirSync(INPUT_FOLDER).map(file => path.join(INPUT_FOLDER, file));
    console.log(res_paths);
    for (const path of res_paths) {
      if (!path.endsWith('.json')) continue;
      const res_obj = JSON.parse(readFileSync(path).toString())
      console.log(`Uploading Resource at ${path}`);
      await medplum.createResource(res_obj);
    }
  } catch (e) {
    console.dir(e, { depth: undefined });
  }
}

await main();