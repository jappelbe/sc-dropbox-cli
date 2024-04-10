import { DropboxClient, ILoginOptions } from '../../dropbox.js'
import { files } from 'dropbox'

interface IListFiles {
    path: string
    recursive?: boolean
    loginOptions: ILoginOptions
}

type folderEnteries = (files.FileMetadataReference|files.FolderMetadataReference|files.DeletedMetadataReference)[]

export async function listFiles(opts: IListFiles) {
    //console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient(opts.loginOptions)
    const dbx = await dropboxClient.getClient()
    const res = await dbx.filesListFolder({
        path: opts.path,
        recursive: opts.recursive
    })
    console.log(`listFile status: ${res.status}`)
    const columns = ['.tag', 'path_display', 'id', 'server_modified', 'shared_folder_id', 'size', 'content_hash']
    console.table(res.result.entries, columns)
    
    const sharedFolders: folderEnteries = res.result.entries.filter((entry) => {
        return ('shared_folder_id' in entry)
    })

    for (const sharedFolder of sharedFolders) {
        console.log(`Shared Folder '${sharedFolder.path_display}'`)
        if (!sharedFolder.path_lower) {
            continue
        }
        const folderRes = await dbx.filesListFolder({
            path: sharedFolder.path_lower
        })
        console.table(folderRes.result.entries, columns)
    }
}