import { DropboxClient, IDropboxClientOpts } from '../../dropbox.js'
import { Dropbox, sharing, team } from 'dropbox'
import * as Utils from '../utils.js'

type TAccesLevels = 'viewer' | 'editor' | 'owner'

interface IShareFile {
    path: string
    users: string[] | undefined
    accessLevel?: TAccesLevels
    removeNotListed: boolean
    loginOptions: IDropboxClientOpts
    quiet: boolean
}

async function createSharedFolder(dbx: Dropbox, path: string): Promise<void> {
    const res = await dbx.sharingShareFolder({
        path: path
    })
    if (res.status < 200 || res.status > 299) {
        throw Error(`Error making '${path}' into a shared folder: ${res.status} '${JSON.stringify(res.result)}'`)
    }
    if ('async_job_id' in res.result) {
        let shareDone = false
        let triesToGo = 5 * 60
        while (!shareDone) {
            const pollRes = await dbx.sharingCheckShareJobStatus({
                async_job_id: res.result.async_job_id
            })
            const status = pollRes.result['.tag']
            if (status === 'complete') {
                shareDone = true
                break
            }
            if (status === 'failed') {
                throw Error(`Failure when sharing folder: ${JSON.stringify(pollRes)}`)
            }
            if (status === 'in_progress') {
                console.log('Waiting for folder to come online')
                Utils.sleep(2000)
                triesToGo--
            }
            if (triesToGo < 0) {
                throw new Error(`Timeout while waiting for shared folder to come online! ${JSON.stringify(pollRes)}`)
            }
        }
    }
    return Promise.resolve()
}


interface IRemoveSharedUsers {
    path: string
    keep?: string[]
}

interface IDropBoxErr {
    error?: {
        error_summary?: string,
        error?: {
            '.tag'?: string
        }

    }
}

// This will not remove groups
async function removeSharedUsers(dropboxClient: DropboxClient, opts: IRemoveSharedUsers) {
    console.log(`Pruning excess users for path ${opts.path}`)
    const sharedEntities = await dropboxClient.getShareEntities(opts.path)
    let usersToRemove = sharedEntities.users
    if (opts.keep !== undefined) {
        const usersToKeep = opts.keep
        usersToRemove = sharedEntities.users.filter(entity => { return usersToKeep.includes(entity.user.email) })
    }
    const currentUsers: {[key: string]: any} = {
        active: sharedEntities.users,
        invited: sharedEntities.invitees
    }
    for (const userType in currentUsers) {
        console.log(`\tChecking ${userType}:`)
        if (currentUsers[userType].length < 1) {
            console.log(`\t- [None]`)
            continue
        }
        for (const e of currentUsers[userType]) {
            let email
            let displayName
            if (e.is_inherited) {
                console.log(`\t- Skipping user ${e.user.display_name} they have inherited access`)
                continue
            }
            if (userType === 'active') {
                email = e.user.email
                displayName = e.user.display_name
            } else {
                email = e.invitee.email
                displayName = `INVITEE:${email}`
            }
            if (opts.keep !== undefined && opts.keep.includes(email)) {
                console.log(`\t- Keeping user ${displayName}`)
                continue
            } else {
                console.log(`\t- Removing user ${displayName}`)
                const dbx = await dropboxClient.getClient()
                if (await dropboxClient.pathIsFile(opts.path)) {
                    await removeSharedUserFromFile(dbx, opts, email, e)
                } else if (await dropboxClient.pathIsFolder(opts.path)) {
                    await removeSharedUserFromFolder(dbx, dropboxClient, opts, email, e, userType)
                } else {
                    throw Error (`RemoveSharedUsers: Unsupported type of path '${opts.path}'`)
                }
            }
        }
    }
}

export async function sharePath(opts: IShareFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbx = await dropboxClient.getClient()
    const quiet = opts.quiet
    console.log(`Notifications enabled: ${quiet === false}`)

    if (opts.users && opts.users.length > 0) {
        let memberSelectorEmails = getShareEmailAddresses(opts.users)
        console.log(`memberSelectorEmails: ${JSON.stringify(memberSelectorEmails)}`)
        let accessLevel: sharing.AccessLevel = { '.tag': 'viewer' }
        if (opts.accessLevel) {
            accessLevel = { '.tag': opts.accessLevel }
        }

        if (await dropboxClient.pathIsFile(opts.path)) {
            await shareFile(dropboxClient, memberSelectorEmails, accessLevel, opts)
        } else if (await dropboxClient.pathIsFolder(opts.path)) {
            await shareFolder(dropboxClient, memberSelectorEmails, accessLevel, opts)
        }
    }
    if (opts.removeNotListed) {
        console.log('Checking for extra users who should have their access revoked')
        await removeSharedUsers(dropboxClient, {path: opts.path, keep: opts.users})
    }
    listShare(dropboxClient, opts)
}

function getShareEmailAddresses(users: string[] | undefined): sharing.MemberSelectorEmail[] {
    let memberSelectorEmails: sharing.MemberSelectorEmail[] = []
    if (!users || users.length < 1) {
        return []
    }
    for (const email of users) {
        if (email.length < 1) {
            continue
        }
        if (!email.includes('@')) {
            throw Error(`'${email}' doesn't look like a valid email, please check input`)
        }
        memberSelectorEmails.push({
            '.tag': 'email',
            email
        })
    }
    return memberSelectorEmails
}

async function shareFile(dropboxClient: DropboxClient, memberSelectorEmails: sharing.MemberSelectorEmail[], accessLevel: sharing.AccessLevel, opts: IShareFile) {
    const dbx = await dropboxClient.getClient()
    try {
        const shareFileRes = await dbx.sharingAddFileMember({
            file: opts.path,
            members: memberSelectorEmails,
            access_level: accessLevel,
            quiet: opts.quiet
        })
        if (shareFileRes.status < 200 || shareFileRes.status > 299) {
            throw Error(`Error sharing file '${opts.path}' ${shareFileRes.status} '${JSON.stringify(shareFileRes.result)}'`)
        }
    } catch (e) {
        console.warn(`Failure sharing "${opts.path}" with users "${memberSelectorEmails}": ${JSON.stringify(e)}`)
        console.warn(`Trying to deduct broken share account`)
        for (const member of memberSelectorEmails) {
            try {
                const oneMember = [member]
                const res = await dbx.sharingAddFileMember({
                    file: opts.path,
                    members: oneMember,
                    quiet: opts.quiet
                })
            } catch (e) {
                console.warn(`Sharing failed for user ${JSON.stringify(member)}: ${JSON.stringify(e)}`)
            }
        }
        process.exit(1)
    }
}

async function shareFolder(dropboxClient: DropboxClient, memberSelectorEmails: sharing.MemberSelectorEmail[], accessLevel: sharing.AccessLevel, opts: IShareFile) {
    const dbx = await dropboxClient.getClient()
    const emailCsv = memberSelectorEmails.map((e) => { return e.email }).join(',')
    console.log(`Setting '${accessLevel['.tag']}' access to users '${emailCsv}' on folder '${opts.path}'`)
    let sharedFolderId = await ensureFolderIsSharedFolder(dropboxClient, opts.path)
    console.log(`Sharing '${opts.path}' with users: '${emailCsv}'`)
    const members: sharing.AddMember[] = memberSelectorEmails.map(member => { return {member, access_level: accessLevel}})
    try {
        const res = await dbx.sharingAddFolderMember({
            shared_folder_id: sharedFolderId,
            members,
            quiet: opts.quiet
        })
        if (res.status < 200 || res.status > 299) {
            throw Error(`Error sharing '${opts.path}' with users: ${JSON.stringify(members)} '${JSON.stringify(res.result)}'`)
        }
    } catch (e) {
        console.warn(`Failure sharing "${opts.path}" with users "${JSON.stringify(members)}": ${JSON.stringify(e, null, 4)}`)
        console.warn(`Trying to deduct broken share account`)
        for (const member of members) {
            try {
                const oneMember = [member]
                const res = await dbx.sharingAddFolderMember({
                    shared_folder_id: sharedFolderId,
                    members: oneMember,
                    quiet: opts.quiet
                })
            } catch (e) {
                console.warn(`Sharing failed for user ${JSON.stringify(member)}: ${JSON.stringify(e)}`)
            }
        }
        process.exit(1)
    }
}

async function ensureFolderIsSharedFolder(dropboxClient: DropboxClient, path: string): Promise<string> {
    const dbx = await dropboxClient.getClient()
    let sharedFolderId = await dropboxClient.getSharedFolderId(path)
    if (sharedFolderId) {
        console.log(`Path '${path}' is already shared with id '${sharedFolderId}'`)
    } else {
        console.log(`Path '${path}' has not been shared yet, making it into a shared folder`)
        await createSharedFolder(dbx, path)
        sharedFolderId = await dropboxClient.getSharedFolderId(path)
    }
    if (sharedFolderId === undefined) {
        throw new Error(`Could not get a sharedFolderId for '${path}', this is unexpected`)
    }
    return Promise.resolve(sharedFolderId)
}

async function listShare(dropboxClient: DropboxClient, opts: IShareFile) {
    console.log(`file: ${opts.path}`)
    const sharedEntities = await dropboxClient.getShareEntities(opts.path)
    console.log('** Users:')
    for (const e of sharedEntities.users) {
        let inheritedAccessStr = ""
        if (e.is_inherited) {
            inheritedAccessStr = ' (inherited)'
        }
        console.log(`\t- ${e.user.display_name}`)
        console.log(`\t\t email: ${e.user.email}`)
        console.log(`\t\t access: ${e.access_type['.tag']}${inheritedAccessStr}`)
    }
    console.log('** groups:')
    for (const e of sharedEntities.groups) {
        console.log(`\t- ${e.group.group_name}`)
        //console.log(`\t\t id: ${e.group.group_id}`)
        console.log(`\t\t access: ${e.access_type['.tag']}`)
    }
    console.log('** Invitees:')
    for (const e of sharedEntities.invitees) {
        if ('email' in e.invitee) {
            console.log(`\t- ${e.invitee.email}`)
        }
        if ('email' in e.invitee) {
            console.log(`\t- ${e.invitee.email}`)
        }
    }
}

async function removeSharedUserFromFile(dbx: Dropbox, opts: IRemoveSharedUsers, email: string, userEntity: any): Promise<void> {
    let removeRes
    let handledError = false
    try {
        removeRes = await dbx.sharingRemoveFileMember2({
            file: opts.path,
            member: {
                '.tag': 'email',
                email
            }
        })
    } catch (err) {
        const dropboxError = err as IDropBoxErr
        //console.log(JSON.stringify(dropboxError))
        if (dropboxError.error?.error?.['.tag'] === 'no_explicit_access') {
            const subError = dropboxError.error as any
            console.log(`\t\t${subError?.user_message?.text}`)
            handledError = true
        } else {
            console.log('removeSharedUserFromFile: Unhandled error')
            throw err
        }
    }
    if (handledError) {
        return Promise.resolve()
    }
    if (!removeRes || removeRes.status < 200 || removeRes.status > 299) {
        throw Error(`removeSharedUserFromFile: Failed to remove '${userEntity.user.display_name}' from '${opts.path}': ${JSON.stringify(removeRes)}`)
    }
    return Promise.resolve()
}

async function removeSharedUserFromFolder(dbx: Dropbox, dropbxClient: DropboxClient, opts: IRemoveSharedUsers, email: string, userEntity: any, userType: string): Promise<void> {
    let removeRes
    let handledError = false
    const sharedFolderId = await dropbxClient.getSharedFolderId(opts.path)
    if (sharedFolderId === undefined) {
        throw Error(`Trying to remove users from '${opts.path}' but it's not a shared folder!`)
    }
    console.log(`--- Removing user ${email} from sharedFolderId: ${sharedFolderId} type:'${userType}'`)
    try {
        removeRes = await dbx.sharingRemoveFolderMember({
            shared_folder_id: sharedFolderId,
            member: {
                '.tag': 'email',
                email: email
            },
            leave_a_copy: false // Required when a share is within a team folder
        })
    } catch (err) {
        const dropboxError = err as IDropBoxErr
        //console.log(JSON.stringify(dropboxError))
        if (dropboxError.error?.error?.['.tag'] === 'member_error') {
            const memberError = (dropboxError.error?.error as any).member_error
            if (memberError['.tag'] === 'no_explicit_access') {
                console.log(`\t\t${memberError.warning}`)
                handledError = true
            } else {
                console.log('removeSharedUserFromFolder: Unhandled error')
                throw err
            }
        }

    }
    if (handledError) {
        return Promise.resolve()
    }
    if (!removeRes || removeRes.status < 200 || removeRes.status > 299) {
        throw Error(`removeSharedUserFromFolder: Failed to remove '${userEntity.user.display_name}' from '${opts.path}': ${JSON.stringify(removeRes)}`)
    }
    return Promise.resolve()
}