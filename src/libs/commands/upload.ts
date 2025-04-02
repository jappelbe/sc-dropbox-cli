import { DropboxClient, IDropboxClientOpts } from '../../dropbox.js'
import { Dropbox, DropboxResponse, files } from 'dropbox'
import * as fs from 'fs'
import * as Path from 'path'
import { UploadChunk } from '../upload/chunk.js'
import { RateLimiter } from '../upload/ratelimiter.js'

const MAX_BATCH_SIZE = 1000
const MAX_BATCH_CONCURRENCY = 20
const BATCH_RETRIES = 3

interface IUploadFile {
    srcPath: string
    dstPath: string
    recursive?: boolean
    loginOptions: IDropboxClientOpts
}

export async function uploadFile(opts: IUploadFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbClient = await dropboxClient
    const pathIsDir = fs.lstatSync(opts.srcPath).isDirectory()
    if (opts.recursive) {
        if (!pathIsDir) {
            console.warn (`Provided path '${opts.srcPath}' is not a folder. Please use the --'recursive' flag only to upload a folder`)
            process.exit(1)
        }
        await dropBoxUploadFolder(dbClient, opts.srcPath, opts.dstPath)
    } else {
        if (pathIsDir) {
            console.warn (`Provided path '${opts.srcPath}' is a folder. Please use the --'recursive' flag to upload a folder`)
            process.exit(1)
        }
        await dropBoxUploadFile(dbClient, opts.srcPath, opts.dstPath)
    }
}

interface IUploadTask {
    batchUpload: boolean
    srcPath: string
    destPath: string
    sessionId?: string
    rateLimiter: RateLimiter
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

export interface IUploadInChunksRes {
    dropboxRes?: DropboxResponse<files.FileMetadata>
    uploadFinishArg: files.UploadSessionFinishArg
}

async function uploadInChunks(dropboxClient: DropboxClient, task: IUploadTask): Promise<IUploadInChunksRes> {
    const maxChunkSize = 16 * 4194304   // 64MB - Dropbox JavaScript API suggested chunk size 8MB, max 150. API doens't allow parallel chunks
                                        // so compromise on 64MB
                                        // Additionally for concurrent uploads you must use a chunk size that is a multiple of 4MB
    const filePath = task.srcPath
    const destPath = task.destPath
    let sessionId = task.sessionId

    var readStream = fs.createReadStream(filePath,{ highWaterMark: maxChunkSize, encoding: undefined });

    const fileSize = fs.statSync(filePath).size

    const dbx = await dropboxClient.getClient()
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
            batchUpload: task.batchUpload,
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
            // First chunk gets the sessionID unless this is a batch-upload
            await chunkUpload.uploadChunkWithRetry(dbx, task.rateLimiter)
            if (sessionId === undefined) {
                sessionId = chunkUpload.sessionId
            }
            if (sessionId === undefined) {
                throw new Error(`Could not get the session id from first chunk upload and it wasn't defined by batch!`)
            }
        } else {
            if (prevUploadPromise) {
                await prevUploadPromise
            }
            prevUploadPromise = chunkUpload.uploadChunkWithRetry(dbx, task.rateLimiter)
        }
        chunkIdx += 1
        dataSent += chunk.length
    }
    if (prevUploadPromise) {
        await prevUploadPromise
    }

    const tDoneBignumMs = (process.hrtime.bigint() - tStart) / BigInt(1000 * 1000)
    console.log(`${task.srcPath} [${fileSize}bytes]- Upload done in ${Number(tDoneBignumMs)/1000}s`)
    
    if (sessionId === undefined) {
        throw new Error("uploadInChunks(): File end: No sessionId! Stopping");
    }
    var cursor = { session_id: sessionId, offset: dataSent }
    var commit = { path: destPath, mode: {".tag": 'overwrite' as 'overwrite'}, autorename: false, mute: false }
    
    // If we were provided a sessionId it means we're doing batch upload and don't need to close session per file
    let dropboxRes = undefined
    if (task.sessionId === undefined) {
        dropboxRes = await dbx.filesUploadSessionFinish({ cursor: cursor, commit: commit })
    }
    return Promise.resolve({
        dropboxRes,
        uploadFinishArg: { cursor: cursor, commit: commit }
    })
}

async function dropBoxUploadFile(dropboxClient: DropboxClient, srcPath: string, destPath: string): Promise<void> {
    const absFilePath = getAbsFilePath(srcPath)
    const rateLimiter = new RateLimiter()
    const fileExists = fs.existsSync(absFilePath)
    if (!fileExists) {
        return Promise.reject(`Error: File '${absFilePath}' doesn't exist`)
    }

    try {
        console.log('Upload file')
        const dbResp = await uploadInChunks(dropboxClient, {
            srcPath: absFilePath,
            destPath,
            batchUpload: false,
            rateLimiter
        })

        console.log('Done!')
        console.log(dbResp);
    } catch(e) {
        console.log(`Error uploading file '${e}'`)
        Promise.reject(e)
    }
}

async function getSessionIds(dbx: Dropbox, batchSize: number, rateLimiter: RateLimiter): Promise<string[]> {
    let retries = 3
    while(true) {
        try {
            await rateLimiter.waitUntilUploadAllowed()
            const batchRes = await dbx.filesUploadSessionStartBatch({
                num_sessions: batchSize,
                session_type: {".tag": 'sequential'}
            })
            return Promise.resolve([...batchRes.result.session_ids])
        } catch (err) {
            if (!rateLimiter.isRateLimitError(err)) {
                console.warn('getSessionIds(): unrecognized error:')
                console.warn(`${JSON.stringify(err)}`)
            }
            if (retries < 1) {
                throw('getSessionIds(): giving up, used all retries')
            }
            retries -= 1
        }
    }
}

async function dropBoxUploadFolder(dropboxClient: DropboxClient, srcPath: string, destPath: string): Promise<void> {
    const rateLimiter = new RateLimiter()
    const absDirPath = getAbsFilePath(srcPath)
    const fileExists = fs.existsSync(absDirPath)
    if (!fileExists) {
        return Promise.reject(`Error: File or folder '${absDirPath}' doesn't exist`)
    }

    try {
        console.log(`Upload folder`)

        const uploadTasks: IUploadTask[] = []
        const entries = fs.readdirSync(absDirPath, {withFileTypes: true, recursive: true})
        for (const fsEntry of entries) {
            if (!fsEntry.isFile()){
                if (fsEntry.isDirectory()) {
                    //console.debug(`${fsEntry.name} is a folder`)
                } else {
                    throw new Error(`${fsEntry.name} is not a file nor folder!`)
                }
                continue
            }
            const absFilePath = Path.join(fsEntry.path, fsEntry.name)
            uploadTasks.push({
                batchUpload: true,
                srcPath: absFilePath,
                destPath: Path.join(destPath, Path.relative(absDirPath, absFilePath)),
                rateLimiter: rateLimiter
            })
        }

        const dbx = await dropboxClient.getClient()
        const totalUploadTasks = uploadTasks.length
        let uploadTasksCompleted = 0

        while (uploadTasks.length > 0) {
            const batchSize = Math.min(uploadTasks.length, MAX_BATCH_SIZE)
            const batchTasks = uploadTasks.splice(0, batchSize)

            const sessionIds = await getSessionIds(dbx, batchSize, rateLimiter)

            if (sessionIds.length !== batchSize) {
                throw new Error(`Internal assertion failure. SessionIDs count for batch doesn't match batch tasks amount! ${batchSize} !== ${sessionIds.length}`)
            }

            const workers: Promise<boolean>[] = []

            for (const task of batchTasks) {
                task.sessionId = sessionIds.pop()
            }

            const results: IUploadInChunksRes[] = []
            for (let i = 0 ; i < MAX_BATCH_CONCURRENCY ; i++) {
                const worker = new Promise<boolean>(async (resolve, reject) => {
                    let task = batchTasks.pop()
                    let retries = BATCH_RETRIES
                    while (task) {
                        try {
                            const chunkUploadRes = await uploadInChunks(dropboxClient, task)
                            results.push(chunkUploadRes)
                            uploadTasksCompleted += 1
                            console.log(`[${uploadTasksCompleted}/${totalUploadTasks}] upload tasks done`)
                        } catch (err: any) {
                            console.warn(`Error: ${err}. status: ${err.status}`)
                            if (err.error) {
                                console.log(`error.error: ${JSON.stringify(err.error)}`)
                            }
                            if (retries > 0) {
                                retries -= 1
                                console.error(`Failed to upload task (retries ${retries}): ${JSON.stringify(task)}: ${err}`)
                                continue
                            } else {
                                console.error(`Ran out of retries uploading '${task.srcPath}'. Giving up`)
                                return reject()
                            }
                        }

                        retries = BATCH_RETRIES
                        task = batchTasks.pop()
                    }
                    return resolve(true)
                })
                workers.push(worker)
            }
            try {
                await Promise.all(workers)
            } catch (err: any) {
                console.error(`Failure in upload task: ${err}`)
                if (err.status) {
                    console.log(`error status: ${err}`)
                }
                throw new Error(err)
            }
            const entries = results.map ((result) => { return result.uploadFinishArg })
            await dbx.filesUploadSessionFinishBatchV2({
                entries
            })
        }
    } catch(e) {
        console.log(`Error uploading folder '${e}'`)
        Promise.reject(e)
    }
}