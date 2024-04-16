import { DropboxClient, ILoginOptions } from '../../dropbox.js'
import { Dropbox, sharing } from 'dropbox'

type TAccesLevels = 'viewer' | 'editor' | 'owner'

interface IShareFile {
    path: string
    users: string[] | undefined
    recursive?: boolean
    accessLevel?: TAccesLevels
    loginOptions: ILoginOptions
}

export async function sharePath(opts: IShareFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbx = await dropboxClient.getClient()

    let memberSelectorEmails: sharing.MemberSelectorEmail[] = []
    if (opts.users && opts.users.length > 0) {
        for (const email of opts.users) {
            memberSelectorEmails.push({
                '.tag': 'email',
                email
            })
        }
        console.log(`memberSelectorEmails: ${JSON.stringify(memberSelectorEmails)}`)
        let accessLevel: sharing.AccessLevel = { '.tag': 'viewer' }
        if (opts.accessLevel) {
            accessLevel = { '.tag': opts.accessLevel }
        }
        if (!opts.users || opts.users.length < 1) {
            console.log('No users listed to share with')
            return
        }
        const emailCsv = memberSelectorEmails.map((e) => { return e.email }).join(',')
        if (await dropboxClient.pathIsFile(opts.path)) {
            console.log(`Setting '${accessLevel['.tag']}' access to users '${emailCsv}' on file '${opts.path}'`)
            await dbx.sharingAddFileMember({
                file: opts.path,
                members: memberSelectorEmails,
                access_level: accessLevel
            })
        } else if (await dropboxClient.pathIsFolder(opts.path)) {
            console.log(`Setting '${accessLevel['.tag']}' access to users '${emailCsv}' on folder '${opts.path}'`)
            let sharedFolderId = await dropboxClient.getSharedFolderId(opts.path)
            if (sharedFolderId) {
                console.log(`Path '${opts.path}' is already shared with id '${sharedFolderId}'`)
            } else {
                console.log(`Path '${opts.path}' has not been shared yet, making it into a shared folder`)
                const res = await dbx.sharingShareFolder({
                    path: opts.path,
                    force_async: true
                })
                if (res.status < 200 || res.status > 299) {
                    throw Error(`Error making '${opts.path}' into a shared folder: ${res.status} '${JSON.stringify(res.result)}'`)
                }
                sharedFolderId = await dropboxClient.getSharedFolderId(opts.path)
            }
            if (sharedFolderId === undefined) {
                throw new Error(`Could not get a sharedFolderId for '${opts.path}', this is unexpected`)
            }
            console.log(`Sharing '${opts.path}' with users: '${emailCsv}'`)
            const members: sharing.AddMember[] = memberSelectorEmails.map(member => { return {member, access_level: accessLevel}})
            const res = await dbx.sharingAddFolderMember({
                shared_folder_id: sharedFolderId,
                members
            })
            if (res.status < 200 || res.status > 299) {
                throw Error(`Error sharing '${opts.path}' with users: ${JSON.stringify(members)} '${JSON.stringify(res.result)}'`)
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