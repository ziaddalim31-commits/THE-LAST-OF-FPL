"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { invokeLiveHandler } = require("../api/_lib/invoke-live-handler");

test("invokes the read-only live handler in-process for the requested gameweek", async () => {
    let receivedRequest;

    const handler = async (req, res) => {
        receivedRequest = req;
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
            ok: true,
            gw: 12,
            final: true,
            data_checked: true,
            players: {}
        }));
    };

    const result = await invokeLiveHandler(handler, 12);

    assert.equal(receivedRequest.method, "GET");
    assert.equal(receivedRequest.url, "/api/live?gw=12");
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.gw, 12);
});

test("preserves a live handler error response without an HTTP self-request", async () => {
    const handler = async (_req, res) => {
        res.statusCode = 503;
        res.end(JSON.stringify({ ok: false, error: "live_data_unavailable" }));
    };

    const result = await invokeLiveHandler(handler, 9);

    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error, "live_data_unavailable");
});

test("rejects malformed live handler responses", async () => {
    const handler = async (_req, res) => {
        res.statusCode = 200;
        res.end("not-json");
    };

    await assert.rejects(
        invokeLiveHandler(handler, 9),
        /LIVE_API_INVALID_RESPONSE/
    );
});
