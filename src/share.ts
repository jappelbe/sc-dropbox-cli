import { DropboxClient } from './dropbox.js'
import { Dropbox, sharing } from 'dropbox'

interface IShareFile {
    path: string
    users: string[] | undefined
    recursive?: boolean
    appKey: string
    accessToken?: string
    refreshToken?: string
}

export async function sharePath(opts: IShareFile) {
    console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient({
        appKey: opts.appKey,
        accessToken: opts.accessToken,
        refreshToken: opts.refreshToken
    })
    const dbx = await dropboxClient.getClient()
    const res = await dbx.sharingListFileMembers({
        file: opts.path
    })

    let memberSelectorEmails: sharing.MemberSelectorEmail[] = []
    if (opts.users && opts.users.length > 0) {
        for (const email of opts.users) {
            memberSelectorEmails.push({
                '.tag': 'email',
                email
            })
        }
        console.log(`memberSelectorEmails: ${JSON.stringify(memberSelectorEmails)}`)
        if (await dropboxClient.pathIsFile(opts.path)) {
            if (opts.users) {
                await dbx.sharingAddFileMember({
                    file: opts.path,
                    members: memberSelectorEmails
                })
            }
        }
    }

    listShare(dropboxClient, opts)
}

async function listShare(dropBoxClient: DropboxClient, opts: IShareFile) {
    console.log(`file: ${opts.path}`)
    const sharedEntities = await dropBoxClient.getShareEntities(opts.path)
    console.log('** Users:')
    for (const e of sharedEntities.users) {
        console.log(`\t- ${e.user.display_name}}`)
        console.log(`\t\t email: ${e.user.email}}`)
        console.log(`\t\t access: ${e.access_type['.tag']}}`)
    }
    console.log('** groups:')
    for (const e of sharedEntities.groups) {
        console.log(`\t- ${e.group.group_name}}`)
        console.log(`\t\t id: ${e.group.group_id}}`)
        console.log(`\t\t access: ${e.access_type['.tag']}}`)
    }
    console.log('** Invitees:')
    for (const e of sharedEntities.invitees) {
        console.log(`\t- ${e.invitee['.tag']}}`)
    }
}