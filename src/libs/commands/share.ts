import { DropboxClient, ILoginOptions } from '../../dropbox.js'
import { Dropbox, sharing } from 'dropbox'
import * as Utils from '../utils.js'

type TAccesLevels = 'viewer' | 'editor' | 'owner'

interface IShareFile {
    path: string
    users: string[] | undefined
    accessLevel?: TAccesLevels
    removeNotListed: boolean
    loginOptions: ILoginOptions
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
    console.log(`Removing users for path ${opts.path}`)
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
        console.log(`\tRemoving ${userType}:`)
        for (const e of currentUsers[userType]) {
            let email
            let displayName
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
                let removeRes
                if (await dropboxClient.pathIsFile(opts.path)) {
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
                        if (dropboxError.error?.error?.['.tag'] === 'no_explicit_access') {
                            console.log('\t\tUser doesn\'t have explicit access to the file, ignoring')
                            continue
                        } else {
                            throw err
                        }
                    }
                } else if (await dropboxClient.pathIsFolder(opts.path)) {
                    const sharedFolderId = await dropboxClient.getSharedFolderId(opts.path)
                    if (sharedFolderId === undefined) {
                        throw Error(`Trying to remove users from '${opts.path}' but it's not a shared folder!`)
                    }
                    console.log(`--- Removing user ${email} from sharedFolderId: ${sharedFolderId} type:'${userType}'`)
                    removeRes = await dbx.sharingRemoveFolderMember({
                        shared_folder_id: sharedFolderId,
                        member: {
                            '.tag': 'email',
                            email: email
                        },
                        leave_a_copy: false // Required when a share is within a team folder
                    })
                } else {
                    throw Error (`RemoveSharedUsers: Unsupported type of path '${opts.path}'`)
                }
                if (!removeRes || removeRes.status < 200 || removeRes.status > 299) {
                    throw Error(`RemoveSharedUsers: Failed to remove '${e.user.display_name}' from '${opts.path}': ${JSON.stringify(removeRes)}`)
                }
            }
        }
    }
}

export async function sharePath(opts: IShareFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbx = await dropboxClient.getClient()

    let memberSelectorEmails: sharing.MemberSelectorEmail[] = []
    if (opts.users && opts.users.length > 0) {
        for (const email of opts.users) {
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
            const shareFileRes = await dbx.sharingAddFileMember({
                file: opts.path,
                members: memberSelectorEmails,
                access_level: accessLevel
            })
            if (shareFileRes.status < 200 || shareFileRes.status > 299) {
                throw Error(`Error sharing file '${opts.path}' ${shareFileRes.status} '${JSON.stringify(shareFileRes.result)}'`)
            }
        } else if (await dropboxClient.pathIsFolder(opts.path)) {
            console.log(`Setting '${accessLevel['.tag']}' access to users '${emailCsv}' on folder '${opts.path}'`)
            let sharedFolderId = await dropboxClient.getSharedFolderId(opts.path)
            if (sharedFolderId) {
                console.log(`Path '${opts.path}' is already shared with id '${sharedFolderId}'`)
            } else {
                console.log(`Path '${opts.path}' has not been shared yet, making it into a shared folder`)
                await createSharedFolder(dbx, opts.path)
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
    if (opts.removeNotListed) {
        console.log('Checking for extra users who should have their access revoked')
        await removeSharedUsers(dropboxClient, {path: opts.path, keep: opts.users})
    }
    listShare(dropboxClient, opts)
}

async function listShare(dropboxClient: DropboxClient, opts: IShareFile) {
    console.log(`file: ${opts.path}`)
    const sharedEntities = await dropboxClient.getShareEntities(opts.path)
    console.log('** Users:')
    for (const e of sharedEntities.users) {
        console.log(`\t- ${e.user.display_name}`)
        console.log(`\t\t email: ${e.user.email}`)
        console.log(`\t\t access: ${e.access_type['.tag']}`)
    }
    console.log('** groups:')
    for (const e of sharedEntities.groups) {
        console.log(`\t- ${e.group.group_name}`)
        console.log(`\t\t id: ${e.group.group_id}`)
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