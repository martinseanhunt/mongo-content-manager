require('dotenv').config()
const mongoose = require('mongoose')
const fs = require('fs')
const shell = require('shelljs')
const parseMD = require('parse-md').default
const get = require('async-get-file')
const unzipper = require('unzipper')
const { Octokit } = require('@octokit/rest')

const { Item } = require('./models/Item')
const { promisifyStream } = require('./util/promisifyStream')

// TODO: If we end up using a github action, use the GH actions auth method
// see octokit docs
const octokit = new Octokit({
  auth: process.env.GH_TOKEN,
})

const syncContent = async () => {
  // Connect to database
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
  })
  console.log('connected to database')

  // Get the repository information from github
  const repo = await octokit.rest.repos.downloadZipballArchive({
    owner: 'martinseanhunt',
    repo: 'mongo-content-manager',
    ref: 'master',
  })

  // Create a temporary directory with the current timestamp as a UUID
  const directory = `./temp-${Date.now()}`
  const filename = 'repo.zip'
  shell.exec(`mkdir ${directory}`)

  // Download the zipped repository using the authenticated download url returned from github
  await get(repo.url, {
    directory,
    filename,
  })

  // Extract the zip file
  await promisifyStream(
    fs
      .createReadStream(`${directory}/${filename}`)
      .pipe(unzipper.Extract({ path: directory }))
  )

  // Delete the zip file
  shell.exec(`rm ${directory}/${filename}`)

  // Get the repository folder name (it will be the only result returned from readdirSync)
  const repoFolderName = fs.readdirSync(directory)[0]

  // Get an array of all the filenames in the metadata folder - each one will correspond to an entry
  const metadataPath = `${directory}/${repoFolderName}/content/metadata`
  const filenames = fs.readdirSync(metadataPath)

  // Iterate over the filenames
  for (const filename of filenames) {
    // Read the file contents - this will be a markdown file
    const markdown = fs.readFileSync(`${metadataPath}/${filename}`, 'utf8')

    // Parse the metadata contained in the markdown file and get the relevant fields
    const {
      metadata: { title, image_filename, image_text, tags },
    } = parseMD(markdown)

    // create or update each entry in our database from each item in the repo.
    // TODO: This will need to be expanded so we can handle uploading or editing the image url in uploadcare only
    // if the entry has changed. I don' think we can do this with a simple upsert like this. Will have to check
    // for changes manually.

    // For the MVP version of the app we're using image hosting directly with github but we will need to host images
    // on uploadcare or we will max out our repository size limit
    const updated = await Item.updateOne(
      { filename },
      {
        filename,
        title,
        image_filename,
        image_text,
        tags,
      },
      { upsert: true }
    )
  }

  // delete any items that may have been removed from the repo... i.e. items that exist in the database but
  // don't exist in our array of filenames from the repository
  await Item.remove({ filename: { $nin: filenames } })

  // Time to clean up. Delete the temporary folder
  shell.exec(`rm -rf ${directory}`)

  // For purposes of development / debugging we'll return the items
  const items = await Item.find()

  // Log the items
  console.log({
    results: items.length,
    items,
  })

  // Disconnect from database
  await mongoose.disconnect()
  console.log('mongoose disconnected')
}

syncContent()
