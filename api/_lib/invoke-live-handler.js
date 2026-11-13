"use strict";

/**
 * Runs the existing read-only FPL live handler in-process.
 * This avoids an HTTP self-request, which can be blocked by Vercel Deployment Protection.
 */
async function invokeLiveHandler(handler, gameweek) {
    if (typeof handler !== "function") {
        throw new Error("LIVE_HANDLER_UNAVAILABLE");
    }

    const req = {
        method: "GET",
        url: `/api/live?gw=${encodeURIComponent(gameweek)}`,
        headers: {}
    };

    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) {
            this.headers[String(name).toLowerCase()] = value;
        },
        end(body) {
            this.body = body;
        }
    };

    await handler(req, res);

    let payload = null;
    try {
        payload = typeof res.body === "string" ? JSON.parse(res.body) : res.body;
    } catch (error) {
        throw new Error("LIVE_API_INVALID_RESPONSE");
    }

    if (!payload || typeof payload !== "object") {
        throw new Error("LIVE_API_EMPTY_RESPONSE");
    }

    return { statusCode: res.statusCode, payload };
}

module.exports = { invokeLiveHandler };
