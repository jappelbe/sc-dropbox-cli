# sc-dropbox-client
SuperCool dropbox client

This only does upload of a single file. It might do more if more is required at some point.

## Usage

### Install
```bash
npm install -g sc-dropbox-cli
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
