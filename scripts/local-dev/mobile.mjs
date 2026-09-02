#!/usr/bin/env node
import { createLocalMobileEnv, spawnInherit } from "./common.mjs";

const env = createLocalMobileEnv();

console.log(`Starting Expo mobile dev server with Cloud API: ${env.EXPO_PUBLIC_CLOUD_SERVER_URL}`);

spawnInherit("pnpm", ["--filter", "mobile", "exec", "expo", "start", "--host", "lan"], { env });
