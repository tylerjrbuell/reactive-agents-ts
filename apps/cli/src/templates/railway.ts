// apps/cli/src/templates/railway.ts

/** Generate a railway.json for Railway deployment */
export const railwayJsonTemplate = (
  agentName: string,
) => `{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
`;

/** Generate a Procfile for Railway (alternative to Dockerfile) */
export const railwayProcfileTemplate = () => `web: bun run src/index.ts\n`;
