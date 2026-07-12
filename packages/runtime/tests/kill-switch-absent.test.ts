/**
 * pause/resume/stop/terminate must FAIL CLEARLY without .withKillSwitch(),
 * not crash the caller.
 *
 * All four are documented public methods. All four requested KillSwitchService
 * by its raw tag, and that service is only in the layer when .withKillSwitch()
 * was called — `Layer.empty` otherwise, which is the DEFAULT. A missing service
 * is an Effect DEFECT, and a defect is not catchable by the `catchAll` those
 * methods wrapped themselves in, so every one of them died with
 * "Service not found: KillSwitchService" on a default agent. A caller's
 * try/catch around the un-awaited promise doesn't help either — it surfaces as
 * an unhandled rejection and takes the process down.
 *
 * Found by the cross-tier ablation (2026-07-12): the bench's cleanup does
 * `try { agent.terminate?.() } catch {}` and the whole `manual-react` arm
 * crashed to a zero-byte report — the baseline the entire experiment depended on.
 *
 * The remedy must NAME itself: the error says to call .withKillSwitch().
 * (Silently no-oping would be worse — the caller asked to stop the agent and
 * would be told it worked.)
 *
 * Run: bun test packages/runtime/tests/kill-switch-absent.test.ts
 */
import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src/builder.js";

const CONTROL_METHODS = ["pause", "resume", "stop", "terminate"] as const;

describe("kill-switch control methods without .withKillSwitch()", () => {
    for (const method of CONTROL_METHODS) {
        test(`${method}() rejects with an actionable error instead of "Service not found"`, async () => {
            const agent = await ReactiveAgents.create()
                .withName(`ks-absent-${method}`)
                .withTestScenario([{ text: "ok" }])
                .build();
            try {
                const call = agent[method] as (reason?: string) => Promise<void>;
                let caught: unknown;
                try {
                    await call.call(agent, "because");
                } catch (e) {
                    caught = e;
                }

                expect(caught).toBeDefined();
                const msg = String(
                    (caught as { message?: string })?.message ?? caught,
                );
                // Names the method and the remedy…
                expect(msg).toContain(`agent.${method}()`);
                expect(msg).toContain(".withKillSwitch()");
                // …and is NOT the raw Effect service-resolution defect.
                expect(msg).not.toContain("Service not found");
            } finally {
                await agent.dispose();
            }
        }, 20000);
    }

    test("with .withKillSwitch(), terminate() resolves normally", async () => {
        const agent = await ReactiveAgents.create()
            .withName("ks-present")
            .withTestScenario([{ text: "ok" }])
            .withKillSwitch()
            .build();
        try {
            // The point of the fix is that the opted-in path still works — the
            // guard must not be achievable by breaking the feature.
            await agent.terminate("test");
        } finally {
            await agent.dispose();
        }
    }, 20000);
});
