import { DropboxClient } from './dropbox.js'
import { DropboxResponse, files } from 'dropbox'
import * as fs from 'fs'
import * as Path from 'path'
import { DropboxContentHasherTS }from './libs/ext/dropbox_content_hasher.js'

interface IUploadFile {
    srcPath: string
    dstPath: string
    recursive?: boolean
    appKey: string
    accessToken?: string
    refreshToken?: string
}

export async function uploadFile(opts: IUploadFile) {
    console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient({
        appKey: opts.appKey,
        accessToken: opts.accessToken,
        refreshToken: opts.refreshToken
    })
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
    let prevUploadPromise: Promise<DropboxResponse<void>> | undefined
    const maxWorkers = 1
    for await (const chunk of readStream) {
        const dbContentHasher = new DropboxContentHasherTS
        dbContentHasher.update(chunk, undefined)
        const sha256Str = dbContentHasher.digest('hex')
        if (chunkIdx === 0) {
            console.log('First Chunk')
            const dbxResp = await dbx.filesUploadSessionStart({ close: false, contents: chunk, content_hash: sha256Str})
            sessionId = dbxResp.result.session_id
        } else {
            if (sessionId === undefined) {
                throw new Error("uploadInChunks(): No sessionId! Stopping");
            }
            console.log(`${Math.round((dataSent * 100) / fileSize)}% done`)
            const cursor = { session_id: sessionId, offset: dataSent }
            let response: DropboxResponse<void> | undefined
            if (prevUploadPromise) {
                response = await prevUploadPromise
            }
            prevUploadPromise = dbx.filesUploadSessionAppendV2({ cursor: cursor, close: false, contents: chunk, content_hash: sha256Str })
            if (response) {
                if (response.status < 200 || response.status > 299) {
                    console.log(`Upload error: ${response.status} on chunk ${chunkIdx}`)
                    throw new Error(`Upload error: ${response.status} on chunk ${chunkIdx}`)
                }
            }
        }
        chunkIdx += 1
        dataSent += chunk.length
    }
    if (prevUploadPromise) {
        const response = await prevUploadPromise
        if (response) {
            if (response.status < 200 || response.status > 299) {
                console.log(`Upload error: ${response.status} on chunk ${chunkIdx}`)
            }
        }
    }
    
    if (sessionId === undefined) {
        throw new Error("uploadInChunks(): File end: No sessionId! Stopping");
    }
    console.log(`dataSent=${dataSent}, fileSize = ${fileSize}`)
    var cursor = { session_id: sessionId, offset: dataSent };
    var commit = { path: destPath, mode: {".tag": 'overwrite' as 'overwrite'}, autorename: false, mute: false };              
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