import { DropboxClient, ILoginOptions } from '../../dropbox.js'
import { DropboxResponse, files } from 'dropbox'
import * as fs from 'fs'
import * as Path from 'path'
import { UploadChunk } from '../upload/chunk.js'

interface IUploadFile {
    srcPath: string
    dstPath: string
    recursive?: boolean
    loginOptions: ILoginOptions
}

export async function uploadFile(opts: IUploadFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbClient = await dropboxClient
    await dropBoxUploadFile(dbClient, opts.srcPath, opts.dstPath)
}


function getAbsFilePath(path: string): string {
    let absFilePath = ""
    if (Path.isAbsolute(path)) {
        absFilePath = path
    } else {
        absFilePath = Path.join(process.cwd(), path)
    }
    return absFilePath
}

async function uploadInChunks(dropboxClient: DropboxClient, filePath: string, destPath: string): Promise<DropboxResponse<files.FileMetadata>> {
    const maxChunkSize = 64 * 1024 * 1024; // 64MB - Dropbox JavaScript API suggested chunk size 8MB, max 150. API doens't allow parallel chunks
                                           // so compromise on 64MB
    var readStream = fs.createReadStream(filePath,{ highWaterMark: maxChunkSize, encoding: undefined });

    const fileSize = fs.statSync(filePath).size

    const dbx = await dropboxClient.getClient()
    let sessionId: undefined | string
    let chunkIdx = 0
    let dataSent = 0
    let prevUploadPromise: Promise<void> | undefined
    const tStart = process.hrtime.bigint()

    // For the first chunk: wait until chunk done (So we get the sessionID)
    // For subsequent chunks:
    // 1. prepare chunk <N>
    // 2. wait for chunk <N - 1> to finish uploading
    // 3. put chunk <N> to upload but do not wait
    // 4. Goto 1
    // On a m1max macbook the preparation takes 0.86s for a 1.2gb file so it's a minor optimization
    // Improvement: Add a class to manage the entire session
    for await (const chunk of readStream) {
        const chunkUpload = new UploadChunk(chunk, {
            chunkIdx,
            dataSent,
            fileSize,
            sessionId,
            retryCount: 5,
            retryIncrementMultiplier: 5,
            retryWaitMs: 1000
        })

        await chunkUpload.prepare()
        if (chunkIdx === 0) {
            // First chunk gets the sessionID
            await chunkUpload.uploadChunkWithRetry(dbx)
            sessionId = chunkUpload.sessionId
            if (sessionId === undefined) {
                throw new Error(`Could not get the session id from first chunk upload!`)
            }
        } else {
            if (prevUploadPromise) {
                await prevUploadPromise
            }
            prevUploadPromise = chunkUpload.uploadChunkWithRetry(dbx)
        }
        chunkIdx += 1
        dataSent += chunk.length
    }
    if (prevUploadPromise) {
        await prevUploadPromise
    }

    const tDoneBignumMs = (process.hrtime.bigint() - tStart) / BigInt(1000 * 1000)
    console.log(`Upload done in ${Number(tDoneBignumMs)/1000}s`)
    
    if (sessionId === undefined) {
        throw new Error("uploadInChunks(): File end: No sessionId! Stopping");
    }
    console.log(`dataSent=${dataSent}, fileSize = ${fileSize}`)
    var cursor = { session_id: sessionId, offset: dataSent }
    var commit = { path: destPath, mode: {".tag": 'overwrite' as 'overwrite'}, autorename: false, mute: false }
    return dbx.filesUploadSessionFinish({ cursor: cursor, commit: commit })
}

async function dropBoxUploadFile(dbx: DropboxClient, srcPath: string, destPath: string): Promise<void> {
    const absFilePath = getAbsFilePath(srcPath)
    const fileExists = fs.existsSync(absFilePath)
    if (!fileExists) {
        return Promise.reject(`Error: File '${absFilePath}' doesn't exist`)
    }

    try {
        console.log('Upload file')
        const dbResp = await uploadInChunks(dbx, absFilePath, destPath)

        console.log('Done!')
        console.log(dbResp);
    } catch(e) {
        console.log(`Error uploading file '${e}'`)
        Promise.reject(e)
    }
}