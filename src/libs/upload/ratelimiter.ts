import { sleep } from "../utils.js"

const MAX_EXTRA_THROTTLE_MS = 500

export class RateLimiter {
    private waitTimeMs: number
    private blockUntil: number
    private throttleUntil: number // set a period of throttling request after new requests are allowed
    private requestsSinceThrottleStarted: number

    constructor() {
        this.waitTimeMs = 0
        this.blockUntil = 0
        this.throttleUntil = 0
        this.requestsSinceThrottleStarted = 0
    }

    setRateLimit(limitMs: number): void {
        this.waitTimeMs = limitMs
        this.blockUntil = new Date().getTime() + limitMs
        this.throttleUntil = new Date().getTime() + 2 * limitMs
        this.requestsSinceThrottleStarted = 0
    }

    async waitUntilUploadAllowed(): Promise<void> {
        const timeNow = new Date().getTime()
        if (this.throttleUntil < timeNow) {
            this.waitTimeMs = 0
            this.throttleUntil = 0
            return Promise.resolve()
        }
        this.requestsSinceThrottleStarted += 1
        const extraWait = this.requestsSinceThrottleStarted * MAX_EXTRA_THROTTLE_MS
        let waitTime = 0
        if (this.blockUntil > timeNow) {
            waitTime = this.blockUntil - timeNow
        }
        const totalWait = waitTime + extraWait
        console.debug(`throttling for ${totalWait}ms`)
        await sleep(totalWait)
    }

    isRateLimitError(err: any): boolean {
        if (err.status !== 429) {
            return false
        }
        console.warn(`Hit ratelimit`)
        let rateLimitWaitForMs = 5000
        if (err.error.error?.retry_after) {
            rateLimitWaitForMs = err.error.error.retry_after * 1000
        }
        this.setRateLimit(rateLimitWaitForMs)
        console.warn(`Hitting Dropbox API rate limits, start throttling Set ratelimit to wait for ${rateLimitWaitForMs}ms`)
        return true
    }
}