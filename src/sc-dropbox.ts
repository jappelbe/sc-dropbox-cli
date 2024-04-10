#! /usr/bin/env node
import { ILoginOptions } from './dropbox.js'
import { listFiles } from './libs/commands/list.js'
import { uploadFile } from './libs/commands/upload.js'
import { sharePath } from './libs/commands/share.js'
import { removePath } from './libs/commands/remove.js'
import { moveFile } from './libs/commands/move.js'

import pkg from 'figlet'
const { textSync } = pkg;
import { Command } from 'commander';

const ACCESS_TOKEN_ENV_VAR_NAME = 'SC_DROPBOX_TOKEN'
let accessToken: undefined | string = undefined

const program = new Command()

program
    .name("sc-dropbox")
    .usage("[global options] command")
    .version("0.3.0")
    .description("SC DropBox CLI for uploading files to dropbox. Designed for use by CI-machines")
    .option('-t, --accessToken [dropbox access token]', `Set access token (preferably this should be set in the ENV variable ${ACCESS_TOKEN_ENV_VAR_NAME})`)
    .option('-r, --refreshToken [dropbox refresh token]', 'Set the refresh token, this will not expire unlike the accessToken')
    .option('-k, --appKey <appKey / clientId>', 'The appKey to use, must be set with refreshToken')

const loginOptions: ILoginOptions = program.opts()

//program.command('help', {isDefault: true})

program.command('upload')
    .description('Upload a file')
    .argument('<srcPath>', 'Path of file to upload')
    .argument('<dstPath>', 'Path in dropbox to store the file')
    .action(async (srcPath, dstPath, options, command) => await uploadFile({
        loginOptions,
        srcPath,
        dstPath
    }).catch((err) => printError(err)
    ))

program.command('list')
    .description('List files on dropbox account')
    .argument('[path]', 'Path to list', '')
    .option('--recursive', 'List folders recursively')
    .action(async (path, options, command) => await listFiles({
        loginOptions,
        path,
        recursive: options.recursive
    }).catch((err) => printError(err)
    ))

program.command('share')
    .description('Share a file with a list of users')
    .argument('<path>')
    .argument('[users]', 'Comma-separated list of user emails')
    .option('--accessLevel [access level]', 'AccessLevel for new users. [viewer(default), editor, owner]')
    .action(async (path, users, options, command) => await sharePath({
        loginOptions,
        path,
        users: users.split(','),
    }).catch((err) => printError(err)
    ))

program.command('remove')
    .description('Will remove the file or directory given')
    .argument('<path>')
    .option('--recursive', 'Remove folder recursively')
    .action((path, options, command) => removePath({
        loginOptions,
        path,
        recursive: options.recursive
    }).catch((err) => printError(err)
    ))

program.command('move')
    .description('Will move the file to location (or id) given')
    .argument('<srcPath>', 'Path or ID of file to move')
    .argument('<dstPath>', 'Path or ID to new location on dropbox')
    .action((srcPath, destPath, options, command) => moveFile({
        loginOptions,
        srcPath,
        destPath
    }).catch((err) => printError(err)
    ))

console.log(textSync('SC-DropBox'))

program.parse()


function printError(err: any) {
    console.log(err)
}