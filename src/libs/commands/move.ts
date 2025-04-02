import { DropboxClient, IDropboxClientOpts } from '../../dropbox.js'

interface IMoveFile {
    srcPath: string
    destPath: string
    loginOptions: IDropboxClientOpts
}

export async function moveFile(opts: IMoveFile) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbx = await dropboxClient.getClient()
    const isFile = await dropboxClient.pathIsFile(opts.srcPath)
    if (!isFile) {
        throw new Error(`moveFile: path '${opts.srcPath}' is not a file. Will not move`)
    }
    const res = await dbx.filesMoveV2({
        from_path: opts.srcPath,
        to_path: opts.destPath,
        allow_shared_folder: true
    })
    console.log(`moveFile status: ${res.status}`)
}