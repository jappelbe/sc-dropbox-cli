import { Dropbox } from "dropbox"
import { DropboxContentHasherTS } from "../ext/dropbox_content_hasher.js"
import { sleep } from "../utils.js"

export interface IUploadChunkOpts {
    chunkIdx: number
    dataSent: number
    fileSize: number
    sessionId: any
    retryCount: number
    retryWaitMs: number
    retryIncrementMultiplier: number
}

export class UploadChunk implements IUploadChunkOpts {
    chunk: any
    chunkIdx: number
    dataSent: number
    fileSize: number
    sessionId: any
    retryCount: number
    retryWaitMs: number
    retryIncrementMultiplier: number
    sha256Str: string | undefined

    status: 'not_started' | 'done' | 'error'

    constructor(chunk: any, opts: IUploadChunkOpts) {
        this.chunk = chunk
        this.chunkIdx = opts.chunkIdx
        this.dataSent = opts.dataSent
        this.fileSize = opts.fileSize
        this.sessionId = opts.sessionId
        this.status = 'not_started'
        this.retryCount = opts.retryCount
        this.retryWaitMs = opts.retryWaitMs
        this.retryIncrementMultiplier = opts.retryIncrementMultiplier
    }

    async prepare(): Promise<void> {
        const dbContentHasher = new DropboxContentHasherTS
        dbContentHasher.update(this.chunk, undefined)
        this.sha256Str = dbContentHasher.digest('hex')
        return Promise.resolve()
    }

    async uploadChunk(dbx: Dropbox): Promise<void> {
        if (this.sha256Str === undefined) {
            throw new Error(`sha256 not calculated for uploadChunk ${this.chunkIdx}!`)
        } 
        if (this.sha256Str.length < 1) {
            throw new Error(`sha256 zero length for uploadChunk ${this.chunkIdx}!`)
        }
        if (this.sessionId === undefined) {
            console.log('First Chunk')
            const dbxResp = await dbx.filesUploadSessionStart({
                close: false,
                contents: this.chunk,
                content_hash: this.sha256Str
            })
            this.sessionId = dbxResp.result.session_id
        } else {
            console.log(`${Math.round((this.dataSent * 100) / this.fileSize)}% done`)
            const cursor = { session_id: this.sessionId, offset: this.dataSent }
            let close = false
            if (this.dataSent + this.chunk.length === this.fileSize) {
                close = true
            }
            let response = await dbx.filesUploadSessionAppendV2({
                cursor,
                close,
                contents: this.chunk,
                content_hash: this.sha256Str })
            if (response) {
                if (response.status < 200 || response.status > 299) {
                    console.log(`Upload error: ${response.status} on chunk ${this.chunkIdx}`)
                    this.status = 'error'
                    return Promise.reject()
                } else {
                    this.status = 'done'
                }
            }
        }
        return Promise.resolve()
    }

    async uploadChunkWithRetry(dbx: Dropbox): Promise<void> {
        let retriesToGo = this.retryCount
        while(true) {
            try {
                const res = await this.uploadChunk(dbx)
                return Promise.resolve(res)
            } catch (err) {
                if (retriesToGo < 1) {
                    console.warn(`uploadInChunks(), chunkId=${this.chunkIdx}. Retried ${this.retryCount} times. Giving up`)
                    Promise.reject(new Error(`Failed to upload chunk #${this.chunkIdx} after ${this.retryCount} tries. Giving up`))
                }
                retriesToGo -= 1
                const retryWaitTimeMs = this.retryWaitMs * this.retryIncrementMultiplier
                console.warn(`Error uploading chunk ${this.chunkIdx}. Retries left: ${retriesToGo}. Waiting ${retryWaitTimeMs}ms: ${JSON.stringify(err)}`)
                await sleep(retryWaitTimeMs)
            }
        }
    }
}