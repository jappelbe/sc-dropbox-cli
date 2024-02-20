#! /usr/bin/env node

import { Dropbox, DropboxResponse, Error, files } from 'dropbox'
import * as fs from 'fs'
import * as Path from 'path'
import { DropboxContentHasherTS }from './libs/ext/dropbox_content_hasher.js'
import pkg from 'figlet'
const { textSync } = pkg;
import { Command } from 'commander';

const ACCESS_TOKEN_ENV_VAR_NAME = 'SC_DROPBOX_TOKEN'
let accessToken: undefined | string = undefined

const program = new Command();

program
    .name("sc-dropbox")
    .usage("[global options] command")
    .version("0.1.0")
    .description("SC DropBox CLI for uploading files to dropbox. Designed for use by CI-machines")
    .option('-h, --help', 'usage help')
    .option('-s, --srcFilePath <file path>', 'Path to file to upload')
    .option('-d, --destPath <path in dropbox>', 'Path in dropbox to store the file')
    .option('-t, --accessToken [dropbox access token]', `Set access token (preferably this should be set in the ENV variable ${ACCESS_TOKEN_ENV_VAR_NAME})`)

program.parse(process.argv);
const options = program.opts();

function checkArgs() {
    if (options.help) {
        program.help()
    }
    if (!options.srcFilePath) {
        console.log("Input error, please specify value for srcFilePath")
        program.help({error: true})
    } else {
        const exists = fs.existsSync(options.srcFilePath)
        if (!exists) {
            console.log(`No such file found! '${options.srcFilePath}'`)
            program.help({error: true})
        }
    }
    if (!options.destPath) {
        console.log("Input error, please specify value for destFile")
        program.help({error: true})
    }
    if (options.accessToken) {
        accessToken = options.accessToken
    }

    if (process.env[ACCESS_TOKEN_ENV_VAR_NAME]) {
        accessToken = process.env[ACCESS_TOKEN_ENV_VAR_NAME]
    }
    if (!accessToken) {
        console.log(`Please specify the a DropBox access token with the ENV variable ${ACCESS_TOKEN_ENV_VAR_NAME} or as an input option`)
        program.help({error: true})
    }
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

async function getFileSha256(filePath: string): Promise<string> {
    const dbContentHasher = new DropboxContentHasherTS
    const fileStream: fs.ReadStream = fs.createReadStream(filePath, 'binary')
    fileStream.on('data', (chunk: Buffer) => {
        dbContentHasher.update(chunk, undefined)
    })

    const retPromise = new Promise<string>((resolve) => {
        fileStream.on('end', ()=> {
            const sha256Str = dbContentHasher.digest('hex')
            console.log(`sha256 = ${sha256Str}`)
            resolve(sha256Str)
        })
    })

    return retPromise
}

async function uploadInChunks(filePath: string, destPath: string): Promise<DropboxResponse<files.FileMetadata>> {
    const maxChunkSize = 64 * 1024 * 1024; // 64MB - Dropbox JavaScript API suggested chunk size 8MB, max 150. API doens't allow parallel chunks
                                           // so compromise on 64MB
    var readStream = fs.createReadStream(filePath,{ highWaterMark: maxChunkSize, encoding: undefined });

    const fileSize = fs.statSync(filePath).size
    const dbx = new Dropbox({ accessToken });
    dbx.filesUploadSessionStart({})
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

async function uploadFile(accessToken: string, srcPath: string, destPath: string): Promise<void> {
    const dbx = new Dropbox({ accessToken });

    const absFilePath = getAbsFilePath(srcPath)
    const fileExists = fs.existsSync(absFilePath)
    if (!fileExists) {
        return Promise.reject(`Error: File '${absFilePath}' doesn't exist`)
    }
    
    console.log('Get SHA256')
    const fileSha256Hash = await getFileSha256(absFilePath)

    // This uploads basic.js to the root of your dropbox
    try {
        console.log('Upload file')
        //const dbResp = await dbx.filesUpload({ path: destPath, contents: fileStream, content_hash: fileSha256Hash, mode: {".tag": 'overwrite'}})
        const dbResp = await uploadInChunks(absFilePath, destPath)

        dbx.filesUploadSessionStart({})
        console.log('Done!')
        console.log(dbResp);
    } catch(e) {
        console.log(`Error uploading file '${e}'`)
        Promise.reject(e)
    }
}

console.log(textSync('SC-DropBox'))

try {
    checkArgs()
    if (accessToken !== undefined) {
        uploadFile(accessToken, options.srcFilePath, options.destPath)
    }
} catch (e) {
    console.log("Caught error during upload!")
    console.log(`${e}`)
}