import { DropboxClient, IDropboxClientOpts } from '../../dropbox.js'

interface IRemoveFile {
    path: string
    recursive?: boolean
    loginOptions: IDropboxClientOpts
}

export async function removePath(opts: IRemoveFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbx = await dropboxClient.getClient()
    const isFolder = await dropboxClient.pathIsFolder(opts.path)
    const isFile = await dropboxClient.pathIsFile(opts.path)
    if (isFolder && !opts.recursive) {
        throw(`Delete '${opts.path}', is a folder, please use the '--recursive'-flag to remove`)
    }
    if (!isFile && !isFolder) {
        throw(`Delete '${opts.path}', is neither a file or folder. Will not try to delete`)
    }
    const res = await dbx.filesDeleteV2({
        path: opts.path
    })
    console.log(`removePath status: ${res.status}`)
}