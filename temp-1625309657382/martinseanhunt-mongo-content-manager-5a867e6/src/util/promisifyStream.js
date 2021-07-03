const promisifyStream = (stream) =>
  new Promise(function (resolve, reject) {
    stream.on('close', () => resolve())
    stream.on('error', reject)
  })

module.exports = { promisifyStream }
