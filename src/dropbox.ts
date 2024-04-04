import { Dropbox, DropboxResponse, files, DropboxAuth, sharing } from 'dropbox'

interface IDropboxClientOpts {
    appKey: string
    accessToken?: string
    refreshToken?: string
}

export class DropboxClient {
    appKey: string | undefined
    accessToken: string | undefined
    refreshToken : string | undefined
    client: Dropbox | undefined

    constructor(opts: IDropboxClientOpts) {
        this.appKey = opts.appKey
        this.accessToken = opts.accessToken
        this.refreshToken = opts.refreshToken
        if (!this.refreshToken && !this.accessToken) {
            console.log('DropboxClient: No refreshToken nor accessToken provided!')
            throw new Error('DropboxClient: No refreshToken nor accessToken provided!')
        }
    }

    async getToken(): Promise<string> {
        let authOpts: any = {}
        if (this.refreshToken) {
            authOpts.refreshToken = this.refreshToken
            authOpts.clientId = this.appKey
        } else if (this.accessToken) {
            authOpts.accessToken = this.accessToken
            return Promise.resolve(this.accessToken)
        }
        const dbxAuth = new DropboxAuth(authOpts)
        await dbxAuth.checkAndRefreshAccessToken()
        const resAccessToken = dbxAuth.getAccessToken()
        return Promise.resolve(resAccessToken)
    }

    async getPathMetadata(path: string): Promise<files.MetadataReference> {
        const client = await this.getClient()
        const res = await client.filesGetMetadata({path})
        if(res.status < 200 || res.status > 299) {
            throw new Error(`Got bad response from Dropbox when trying to read metadata for file/folder '${path}': ${JSON.stringify(res)}`)
        }
        return Promise.resolve( res.result )
    }

    async pathIsFolder(path: string): Promise<boolean> {
        const res = await this.getPathMetadata(path)
        return Promise.resolve( res['.tag'] === 'folder' )
    }

    async pathIsFile(path: string): Promise<boolean> {
        const res = await this.getPathMetadata(path)
        return Promise.resolve( res['.tag'] === 'file' )
    }

    async getShareEntities(path: string): Promise<sharing.SharedFileMembers> {
        const client = await this.getClient()
        let res: any
        if (await this.pathIsFile(path)){
            res = await client.sharingListFileMembers({
                file: path
            })
        } else {
            throw new Error('Sharing folders is not supported yet')
        }
        if(res.status < 200 || res.status > 299) {
            throw new Error(`Got bad response from Dropbox when trying to read file/folder members'${path}': ${JSON.stringify(res)}`)
        }
        return Promise.resolve(res.result)
    }

    async getClient(): Promise<Dropbox> {
        if(this.client) {
            return Promise.resolve(this.client)
        }
        const accessToken = await this.getToken()
        this.client = new Dropbox({accessToken: accessToken})
        return Promise.resolve(this.client)
    }
}