# sc-dropbox-client
SuperCool dropbox client

Current functionality:
- upload one file
- upload a folder recursively
- list files
- share file
- share folder
- remove files
- move file

## Usage

### Install
```bash
npm install -g sc-dropbox-cli
```

## Run
```
  ____   ____      ____                  ____
 / ___| / ___|    |  _ \ _ __ ___  _ __ | __ )  _____  __
 \___ \| |   _____| | | | '__/ _ \| '_ \|  _ \ / _ \ \/ /
  ___) | |__|_____| |_| | | | (_) | |_) | |_) | (_) >  <
 |____/ \____|    |____/|_|  \___/| .__/|____/ \___/_/\_\
                                  |_|
Usage: sc-dropbox [options] [command]

SC DropBox CLI for uploading files to dropbox. Designed for use by CI-machines

Options:
  -V, --version                           output the version number
  --refreshToken [dropbox refresh token]  Set the refresh token, this will not expire unlike the accessToken (env: SC_DROPBOX_TOKEN)
  --appKey <appKey / clientId>            The appKey to use, must be set
  -h, --help                              display help for command

Commands:
  upload <srcPath> <dstPath>              Upload a file
  list [options] [path]                   List files on dropbox account
  share [options] <path> [users]          Share a file with a list of users
  remove [options] <path>                 Will remove the file or directory given
  move <srcPath> <dstPath>                Will move the file to location (or id) given
  help [command]                          display help for command
```

### Create an access token
1. Go to [Dropbox Developer](https://www.dropbox.com/developers)-page
2. Click [Create Apps](https://www.dropbox.com/developers/apps/create?_tk=pilot_lp&_ad=ctabtn1&_camp=create)
3. Scoped access
4. Full Dropbox
5. Name any (e.g. sc-cli)
6. Permissions -> check `files.metadata.write` and `files.content.write`
7. Find and click `Generated access token`


## Development 
### Install dependencies:
```bash
npm install
```

### Build
```bash
npm run build
```

### Run locally
```bash
chmod u+x ./dist/sc-dropbox.js
```

# Other info
This project uses the dropbox-content-hasher.js found here: https://github.com/dropbox/dropbox-api-content-hasher/blob/master/js-node/dropbox-content-hasher.js
