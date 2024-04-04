#! /usr/bin/env node

import { listFiles } from './list.js'
import { uploadFile } from './upload.js'
import { sharePath } from './share.js'
import pkg from 'figlet'
const { textSync } = pkg;
import { Command } from 'commander';

const ACCESS_TOKEN_ENV_VAR_NAME = 'SC_DROPBOX_TOKEN'
let accessToken: undefined | string = undefined

const program = new Command();

const main = program
    .name("sc-dropbox")
    .usage("[global options] command")
    .version("0.2.1")
    .description("SC DropBox CLI for uploading files to dropbox. Designed for use by CI-machines")
    .argument('command', 'Command to run [upload, list]')
    .option('-h, --help', 'usage help')

main.command('upload')
    .argument('<srcPath>', 'Path of file to upload')
    .argument('<dstPath>', 'Path in dropbox to store the file')
    .option('-h, --help', 'usage help')
    .option('-t, --accessToken [dropbox access token]', `Set access token (preferably this should be set in the ENV variable ${ACCESS_TOKEN_ENV_VAR_NAME})`)
    .option('-r, --refreshToken [dropbox refresh token]', 'Set the refresh token, this will not expire unlike the accessToken')
    .option('-k, --appKey [appKey / clientId]', 'The appKey to use, must be set with refreshToken')
    .action((srcPath, dstPath, options, command) => uploadFile({
        appKey: options.appKey,
        accessToken: options.accessToken,
        refreshToken: options.refreshToken,
        srcPath,
        dstPath
    }))

main.command('list')
    .argument('<path>')
    .option('-h, --help', 'usage help')
    .option('-r, --recursive', 'Path to file to upload')
    .option('-t, --accessToken [dropbox access token]', `Set access token (preferably this should be set in the ENV variable ${ACCESS_TOKEN_ENV_VAR_NAME})`)
    .option('-r, --refreshToken [dropbox refresh token]', 'Set the refresh token, this will not expire unlike the accessToken')
    .option('-k, --appKey [appKey / clientId]', 'The appKey to use, must be set with refreshToken')
    .action((path, options, command) => listFiles({
        appKey: options.appKey,
        accessToken: options.accessToken,
        refreshToken: options.refreshToken,
        path,
        recursive: options.recursive
    }))

main.command('share')
    .argument('<path>')
    .argument('[users]', 'Comma-separated list of user emails')
    .option('--accessLevel [access level]', 'AccessLevel for new users. [viewer(default), editor, owner]')
    .option('-h, --help', 'usage help')
    .option('-t, --accessToken [dropbox access token]', `Set access token (preferably this should be set in the ENV variable ${ACCESS_TOKEN_ENV_VAR_NAME})`)
    .option('-r, --refreshToken [dropbox refresh token]', 'Set the refresh token, this will not expire unlike the accessToken')
    .option('-k, --appKey [appKey / clientId]', 'The appKey to use, must be set with refreshToken')
    .action((path, users, options, command) => sharePath({
        appKey: options.appKey,
        accessToken: options.accessToken,
        refreshToken: options.refreshToken,
        accessLevel: options.accessLevel,
        path,
        users: users.split(','),
        recursive: options.recursive
    }))

    program.parse(process.argv);
    const options = main.opts();

console.log(textSync('SC-DropBox'))
