#! /usr/bin/env node
import { IDropboxClientOpts } from './dropbox.js'

// Commands
import { accountInfo } from './libs/commands/accountinfo.js'
import { listFiles } from './libs/commands/list.js'
import { moveFile } from './libs/commands/move.js'
import { removePath } from './libs/commands/remove.js'
import { uploadFile } from './libs/commands/upload.js'
import { downloadFile } from './libs/commands/download.js'
import { sharePath } from './libs/commands/share.js'


import pkg from 'figlet'
const { textSync } = pkg;
import { Argument, Command, Option} from 'commander';

const ACCESS_TOKEN_ENV_VAR_NAME = 'SC_DROPBOX_TOKEN'
let accessToken: undefined | string = undefined

const program = new Command()

program
    .name("sc-dropbox")
    .version("0.5.1")
    .description("SC DropBox CLI for uploading files to dropbox. Designed for use by CI-machines")
    .addOption(new Option('--refreshToken [dropbox refresh token]',
            'Set the refresh token, this will not expire unlike the accessToken')
        .makeOptionMandatory(true)
        .env(ACCESS_TOKEN_ENV_VAR_NAME))
    .addOption(new Option('--appKey <appKey / clientId>',
            'The appKey to use, must be set')
        .makeOptionMandatory(true))
    .addOption(new Option('--pathRootSharedName <Path to team space>',
            'If using a team space you can to specify the pathRoot either with --pathRootSharedName or --pathRootSharedId. Use \'listshared\' command to list shares')
        .makeOptionMandatory(false))
    .addOption(new Option('--pathRootSharedId <Id of shared team space>',
        'If using a team space you can to specify the pathRoot either with --pathRootSharedName or --pathRootSharedId. Use \'listshared\' command to list shares')
        .makeOptionMandatory(false))

const loginOptions: IDropboxClientOpts = program.opts()

//program.command('help', {isDefault: true})

program.command('upload')
    .description('Upload a file')
    .argument('<srcPath>', 'Path of file to upload')
    .argument('<dstPath>', 'Path in dropbox to store the file. When uploading a single file, also provide the filename in path')
    .addOption(new Option('--recursive', 'Upload a folder recursively').default(false))
    .action(async (srcPath, dstPath, options, command) => await uploadFile({
        dstPath,
        loginOptions,
        recursive: options.recursive,
        srcPath,
    }).catch((err) => {
        printError(err)
        process.exit(1)
    }))

program.command('download')
    .description('Download a file')
    .argument('<srcPath>', 'Path of file to download (in dropbox)')
    .argument('<dstPath>', 'Path on filesystem to store the file.')
    .addOption(new Option('--recursive', 'Download a folder recursively').default(false))
    .addOption(new Option('--overwrite', 'Overwrites existing files').default(false))
    .action(async (srcPath, dstPath, options, command) => await downloadFile({
        dstPath,
        loginOptions,
        recursive: options.recursive,
        srcPath,
        overwrite: options.overwrite
    }).catch((err) => {
        printError(err)
        process.exit(1)
    }))

program.command('list')
    .description('List files on dropbox account')
    .argument('[path]', 'Path to list', '')
    .option('--recursive', 'List folders recursively')
    .action(async (path, options, command) => await listFiles({
        loginOptions,
        path,
        recursive: options.recursive
    }).catch((err) => {
        printError(err)
        process.exit(1)
    }))

program.command('share')
    .description('Share a file with a list of users')
    .argument('<path>')
    .addArgument(new Argument('[users]', 'Comma-separated list of user emails').default(''))
    .option('--accessLevel [access level]', 'AccessLevel for new users. [viewer(default), editor, owner]')
    .option('--remove-not-listed', 'Set this flag to remove access to the share for all users which are not listed')
    .addOption(new Option('--quiet', 'Do not send notifications of this share-operation').default(false))
    .action(async (path, users, options, command) => await sharePath({
        loginOptions,
        path,
        accessLevel: options.accessLevel,
        removeNotListed: options.removeNotListed,
        users: users.split(','),
        quiet: options.quiet
    }).catch((err) => {
        printError(err)
        process.exit(1)
    }))

program.command('remove')
    .description('Will remove the file or directory given')
    .argument('<path>')
    .option('--recursive', 'Remove folder recursively')
    .action((path, options, command) => removePath({
        loginOptions,
        path,
        recursive: options.recursive
    }).catch((err) =>{
        printError(err)
        process.exit(1)
    }))

program.command('move')
    .description('Will move the file to location (or id) given')
    .argument('<srcPath>', 'Path or ID of file to move')
    .argument('<dstPath>', 'Path or ID to new location on dropbox')
    .action((srcPath, destPath, options, command) => moveFile({
        loginOptions,
        srcPath,
        destPath
    }).catch((err) => {
        printError(err)
        process.exit(1)
    }))


program.command('accountinfo')
    .description('Prints info on the current account')
    .action(() => accountInfo({
        loginOptions
    }).catch((err) => {
        printError(err)
        process.exit(1)
    }))

console.log(textSync('SC-DropBox'))

program.parse()


function printError(err: any) {
    console.error(err)
}