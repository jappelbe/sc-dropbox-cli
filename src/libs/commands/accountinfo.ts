import { DropboxClient, IDropboxClientOpts } from '../../dropbox.js'
import { files, team } from 'dropbox'

interface IAccountInfo {
    loginOptions: IDropboxClientOpts
}

type folderEnteries = (files.FileMetadataReference|files.FolderMetadataReference|files.DeletedMetadataReference)[]

export async function accountInfo(opts: IAccountInfo) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbx = await dropboxClient.getClient()
    const res = await dbx.usersGetCurrentAccount()

    console.log(`AccountInfo status: ${res.status}`)
    console.log(`AccountInfo: ${JSON.stringify(res.result, null, 4)}`)
}