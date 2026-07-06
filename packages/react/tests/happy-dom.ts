import { afterAll, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Register happy-dom's DOM globals for this test file and UNREGISTER them in
 * afterAll.
 *
 * happy-dom's GlobalRegistrator installs process-wide globals (document, window,
 * fetch, Request, Response, …). Under the isolated per-package run they die with
 * the worker, but under a single-process root `bun test` they PERSIST and break
 * every real-HTTP test that runs afterward — judge-server and secureServe get
 * happy-dom's fetch instead of the native one. The matching unregister keeps DOM
 * registration scoped to the file that needs it.
 */
export const withHappyDom = (): void => {
  let registeredHere = false;
  beforeAll(() => {
    if (!globalThis.document) {
      GlobalRegistrator.register();
      registeredHere = true;
    }
  });
  afterAll(() => {
    if (registeredHere) GlobalRegistrator.unregister();
  });
};
