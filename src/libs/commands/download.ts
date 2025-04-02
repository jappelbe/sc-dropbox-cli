import { DropboxClient, IDropboxClientOpts } from '../../dropbox.js'
import { Dropbox, DropboxResponse, files } from 'dropbox'
import * as fs from 'fs'
import * as Path from 'path'
import { UploadChunk } from '../upload/chunk.js'
import { RateLimiter } from '../upload/ratelimiter.js'

const MAX_BATCH_SIZE = 1000
const MAX_BATCH_CONCURRENCY = 20
const BATCH_RETRIES = 3

interface IDownloadFile {
    srcPath: string
    dstPath: string
    recursive?: boolean
    overwrite: boolean
    loginOptions: IDropboxClientOpts
}

export async function downloadFile(opts: IDownloadFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbClient = await dropboxClient
    let destPathIsDir = false
    const sanitizedDestPath = getAbsDestPath(opts.dstPath, opts.srcPath)
    
    const srcPathIsString = false // TODO: FIXME
    if (opts.recursive) {
        if (!srcPathIsString) {
            console.warn (`Provided path '${opts.srcPath}' is not a folder. Please use the --'recursive' flag only to download a folder`)
            process.exit(1)
        }
        //await dropBoxDownloadFolder(dbClient, opts.srcPath, opts.dstPath, opts.overwrite)
    } else {
        if (srcPathIsString) {
            console.warn (`Provided path '${opts.srcPath}' is a folder. Please use the --'recursive' flag to download a folder`)
            process.exit(1)
        }
        await dropBoxDownloadFile(dbClient, opts.srcPath, opts.dstPath, opts.overwrite)
    }
}

interface IDownloadTask {
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

function getAbsDestPath(destPathInput: string, srcPath: string): string {
    const baseName = Path.basename(srcPath)
    const absDestPathInput = getAbsFilePath(destPathInput)
    const absDirName = Path.dirname(absDestPathInput)
    if (fs.existsSync(destPathInput)) {
        if (fs.lstatSync(destPathInput).isDirectory()) {
            return Path.join(absDestPathInput, baseName)
        }
        return absDestPathInput
    }
    if (!fs.existsSync(absDirName)) {
        throw `Parent folder '${absDirName}' of destination path does not exist, check inputs or create destination folder`
    }
    if (!fs.lstatSync(absDirName).isDirectory()) {
        throw `Cannot download to '${destPathInput}' because '${absDirName}' is not a folder`
    }
    return Path.join(absDestPathInput)
}

async function dropBoxDownloadFile(dropboxClient: DropboxClient, srcPath: string, destPath: string, overwrite: boolean): Promise<void> {
    console.log(`Download: '${srcPath}' from dropbox to '${destPath}' on filesystem`)
    const absDestFilePath = getAbsFilePath(destPath)
    const fileExists = fs.existsSync(absDestFilePath)
    if (fileExists && !overwrite) {
        return Promise.reject(`Error: File '${absDestFilePath}' already exists and overwrite argument is set to false`)
    }

    try {
        console.log('Download file')
        try {
            const dbx = await dropboxClient.getClient()
            const dbResp = await dbx.filesDownload({path: srcPath})
            console.log(`Response: ${JSON.stringify(dbResp)}`)
        } catch(err) {
            return Promise.reject(`Failed to download file '${srcPath}': ${JSON.stringify(err)}`)
        }
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
