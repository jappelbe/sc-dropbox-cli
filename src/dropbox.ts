import { Dropbox, DropboxOptions, files, DropboxAuth, sharing, common } from 'dropbox'

export interface IDropboxClientOpts {
    appKey: string,
    accessToken?: string,
    pathRootSharedId?: string,
    pathRootSharedName?: string,
    refreshToken?: string,
}

export interface IDropboxClientGetClientOpts {
    pathRoot: common.PathRoot
}

export type TFolderEnteries = (files.FileMetadataReference|files.FolderMetadataReference|files.DeletedMetadataReference)[]

export class DropboxClient {
    appKey: string | undefined
    accessToken: string | undefined
    pathRootSharedId: string | undefined
    pathRootSharedName: string | undefined
    refreshToken : string | undefined
    client: Dropbox | undefined

    constructor(opts: IDropboxClientOpts) {
        this.appKey = opts.appKey
        this.accessToken = opts.accessToken
        this.refreshToken = opts.refreshToken
        this.pathRootSharedId = opts.pathRootSharedId
        this.pathRootSharedName = opts.pathRootSharedName
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

    async getSharedFolderId(path: string): Promise<string | undefined> {
        const metaDataRes = await this.getPathMetadata(path)
        if (metaDataRes['.tag'] !== 'folder') {
            return Promise.resolve(undefined)
        }
        if ('shared_folder_id' in metaDataRes) {
            return Promise.resolve(metaDataRes.shared_folder_id as string)
        }
    }

    async getShareEntities(path: string): Promise<sharing.SharedFileMembers> {
        const client = await this.getClient()
        let res: any
        if (await this.pathIsFile(path)) {
            res = await client.sharingListFileMembers({
                file: path
            })
        } else if (await this.pathIsFolder(path)) {
            const sharedFolderId = await this.getSharedFolderId(path)
            if (sharedFolderId === undefined) {
                throw new Error(`Cannot get shared_folder_id for '${path}'`)
            }
            res = await client.sharingListFolderMembers({
                shared_folder_id: sharedFolderId
            })
        } else {
            throw new Error(`Path '${path}' is neither file or folder, unsupported`)
        }
        if(res.status < 200 || res.status > 299) {
            throw new Error(`Got bad response from Dropbox when trying to read file/folder members'${path}': ${JSON.stringify(res)}`)
        }
        return Promise.resolve(res.result)
    }

    async getClient(): Promise<Dropbox> {
        if (this.pathRootSharedId || this.pathRootSharedName) {
            return this.getHomeClient()
        }
        return this.getUserRootClient()
    }

    async getHomeClient(): Promise<Dropbox> {
        const accessToken = await this.getToken()
        const dropboxConstructOpts: DropboxOptions = {accessToken}
        let pathRootShareId = this.pathRootSharedId

        if (!pathRootShareId && this.pathRootSharedName) {
            pathRootShareId = await this.getShareId(this.pathRootSharedName)
        }
        if (pathRootShareId) {
            const pathRoot: common.PathRoot = {'.tag': 'namespace_id', namespace_id: pathRootShareId}
            dropboxConstructOpts.pathRoot = JSON.stringify(pathRoot)
        }
        this.client = new Dropbox(dropboxConstructOpts)
        return Promise.resolve(this.client)
    }

    async getUserRootClient(): Promise<Dropbox> {
        const userRootNamespaceId = await this.getUserRootNamespaceId()
        const accessToken = await this.getToken()
        const pathRoot: common.PathRoot = {
            '.tag': 'root',
            'root': userRootNamespaceId
        }
        const dropboxConstructOpts: DropboxOptions = {
            accessToken,
            pathRoot: JSON.stringify(pathRoot)
        }
        this.client = new Dropbox(dropboxConstructOpts)
        return Promise.resolve(this.client)
    }

    private async getShareId(pathRootSharedName: string): Promise<string> {
        const dbx = await this.getUserRootClient()
        const res = await dbx.filesListFolder({path: '', recursive: false})
        const sharedFolders = res.result.entries.filter((entry) => {
            return ('shared_folder_id' in entry)
        }) as files.FolderMetadataReference[]
        const match = sharedFolders.find((sf) => { return sf.path_display === pathRootSharedName})
        if (!match) {
            return Promise.reject(`Couldn't find shared resource with name '${pathRootSharedName}'`)
        }
        if (!match.shared_folder_id) {
            return Promise.reject(`no shared_folder id for resource with name '${pathRootSharedName}': ${JSON.stringify(match)}`)
        }
        return match.shared_folder_id
    }

    private async getUserRootNamespaceId(): Promise<string> {
        try {
            const accessToken = await this.getToken()
            const dbx = new Dropbox({accessToken})
            const res = await dbx.usersGetCurrentAccount()
            const userRootNamespaceId = res.result.root_info.root_namespace_id
            return Promise.resolve(userRootNamespaceId)
        } catch (err) {
            console.warn(`getUserRootNamespaceId(): failed to fetch user root_namespace_id: ${err}`)
            return Promise.reject('Failed to fetch userRootNamespaceId')
        }
    }
}