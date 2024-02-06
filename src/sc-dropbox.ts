#! /usr/bin/env node

import { Dropbox, Error, files } from 'dropbox'
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
    .version("0.0.1")
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

function getFileSha256(fileBuffer: Buffer): string {
    const dbContentHasher = new DropboxContentHasherTS
    dbContentHasher.update(fileBuffer, null)
    return dbContentHasher.digest('hex')
}

async function uploadFile(accessToken: string, srcPath: string, destPath: string): Promise<void> {
    const dbx = new Dropbox({ accessToken });

    const absFilePath = getAbsFilePath(srcPath)
    const fileExists = fs.existsSync(absFilePath)
    if (!fileExists) {
        return Promise.reject(`Error: File '${absFilePath}' doesn't exist`)
    }
    const fileBuffer: Buffer = fs.readFileSync(absFilePath, null)
    const fileSha256Hash = getFileSha256(fileBuffer)

    // This uploads basic.js to the root of your dropbox
    try {
        const dbResp = await dbx.filesUpload({ path: destPath, contents: fileBuffer, content_hash: fileSha256Hash })
        console.log(dbResp);
    } catch(e) {
        console.log(`Error uploading file '${e}'`)
        Promise.reject(e)
    }
}

console.log(textSync('SC-DropBox'))

checkArgs()
if (accessToken !== undefined) {
    uploadFile(accessToken, options.srcFilePath, options.destPath)
}