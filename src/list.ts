import { DropboxClient } from './dropbox.js'

interface IListFiles {
    path: string
    recursive?: boolean
    appKey: string
    accessToken?: string
    refreshToken?: string
}

export async function listFiles(opts: IListFiles) {
    console.log(JSON.stringify(`opts: ${JSON.stringify(opts)}`))
    const dropboxClient = new DropboxClient({
        appKey: opts.appKey,
        accessToken: opts.accessToken,
        refreshToken: opts.refreshToken
    })
    const dbx = await dropboxClient.getClient()
    const res = await dbx.filesListFolder({
        path: opts.path,
        recursive: opts.recursive
    })
    console.log(`listFile status: ${res.status}`)
    for (const entry of res.result.entries) {
        let type = 'F'
        if (entry['.tag'] === 'folder') {
            console.log(`${type}\t${entry.path_display}\t`)
        } else if (entry['.tag'] === 'file') {
            console.log(`${type}\t${entry.path_display}\t${entry.size}\t${entry.server_modified}`)
        }
    }
}