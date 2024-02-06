// https://github.com/dropbox/dropbox-api-content-hasher/blob/master/js-node/dropbox-content-hasher.js
// Not sure why they haven't included this in the npm package... Transformed it into Typescript

/**
 * Computes a hash using the same algorithm that the Dropbox API uses for the
 * the "content_hash" metadata field.
 *
 * The `digest()` method returns a raw binary representation of the hash.
 * The "content_hash" field in the Dropbox API is a hexadecimal-encoded version
 * of the digest.
 *
 * Example:
 *
 *     const fs = require('fs');
 *     const dch = require('dropbox-content-hasher');
 *
 *     const hasher = dch.create();
 *     const f = fs.createReadStream('some-file');
 *     f.on('data', function(buf) {
 *       hasher.update(buf);
 *     });
 *     f.on('end', function(err) {
 *       const hexDigest = hasher.digest('hex');
 *       console.log(hexDigest);
 *     });
 *     f.on('error', function(err) {
 *       console.error("Error reading from file: " + err);
 *       process.exit(1);
 *     });
 */

import * as crypto from 'crypto'

type Encoding = null | string


export class DropboxContentHasherTS {
  BLOCK_SIZE = 4 * 1024 * 1024
  _overallHasher: null | crypto.Hash = crypto.createHash('sha256')
  _blockHasher: null | crypto.Hash = crypto.createHash('sha256')
  _blockPos = 0

  constructor() {
  }

  update(data: Buffer, inputEncoding: Encoding) {
    if (this._overallHasher === null) {
      throw new Error(
        "can't use this object anymore; you already called digest()");
    }

    if (!Buffer.isBuffer(data)) {
      if (inputEncoding !== undefined &&
          inputEncoding !== 'utf8' && inputEncoding !== 'ascii' && inputEncoding !== 'latin1') {
        // The docs for the standard hashers say they only accept these three encodings.
        throw new Error("Invalid 'inputEncoding': " + JSON.stringify(inputEncoding));
      }
      data = Buffer.from(data, inputEncoding);
    }

    let offset = 0;
    while (offset < data.length) {
      if (this._blockPos === this.BLOCK_SIZE) {
        if (this._blockHasher) {
          this._overallHasher.update(this._blockHasher.digest());
        }
        this._blockHasher = crypto.createHash('sha256');
        this._blockPos = 0;
      }

      let spaceInBlock = this.BLOCK_SIZE - this._blockPos;
      let inputPartEnd = Math.min(data.length, offset+spaceInBlock);
      let inputPartLength = inputPartEnd - offset;
      if (this._blockHasher) {
        this._blockHasher.update(data.slice(offset, inputPartEnd));
      }

      this._blockPos += inputPartLength;
      offset = inputPartEnd;
    }
  }
  digest(encoding: crypto.BinaryToTextEncoding) {
    if (this._overallHasher === null) {
      throw new Error(
        "can't use this object anymore; you already called digest()");
    }

    if (this._blockPos > 0) {
      if (this._blockHasher) {
        this._overallHasher.update(this._blockHasher.digest());
      }
      this._blockHasher = null;
    }
      let r = this._overallHasher.digest(encoding);
      this._overallHasher = null;  // Make sure we can't use this object anymore.
      return r;
  }
}
