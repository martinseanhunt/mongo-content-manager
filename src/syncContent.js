require('dotenv').config()
const mongoose = require('mongoose')
const fs = require('fs')
const parseMD = require('parse-md').default
var _ = require('lodash')
const removeMd = require('remove-markdown')
const algoliasearch = require('algoliasearch')
const { promisify } = require('util')
const exec = promisify(require('child_process').exec)
const axios = require('axios')
const crypto = require('crypto')

module.exports.getGitUser = async function getGitUser() {
  const name = await exec('git config --global user.name')
  const email = await exec('git config --global user.email')
  return { name, email }
}

const { Item } = require('./models/Item')

const client = algoliasearch(
  process.env.ALGOLIA_APP_ID,
  process.env.ALGOLIA_API_KEY
)
const index = client.initIndex('entries')

const syncContent = async () => {
  // Connect to database
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
  })
  console.log('connected to database')

  // Get an array of all the filenames in the metadata folder - each one will correspond to an entry
  const metadataPath = `content/metadata`
  const filenames = fs.readdirSync(metadataPath)

  // init algolia entries
  const algoliaEntries = []

  // Iterate over the filenames
  for (const filename of filenames) {
    try {
      console.log(`processing file ${filename}`)

      // Read the file contents - this will be a markdown file
      const markdown = fs.readFileSync(`${metadataPath}/${filename}`, 'utf8')

      // Parse the metadata contained in the markdown file and get the relevant fields
      const {
        metadata: {
          title,
          image,
          image_text,
          tags,
          body_content,
          content_type,
          url,
        },
      } = parseMD(markdown)

      // create or update each entry in our database from each item in the repo.

      // TODO: For the MVP version of the app we're using image hosting directly with github but we will need to come
      // up with a better solution that doesn't rely on the images being stored in the repository. We will max out
      // the repo size limit otherwise.

      // first, try to find an entry with the filename
      const dbItem = await Item.findOne({ filename })

      const parsedItem = {
        filename,
        title,
        tags: tags,
        contentType: content_type,
        // Set optional fields to null if empty for comparison to existing entry
        bodyContent: body_content || null,
        strippedContent: body_content ? removeMd(body_content) : null,
        url: url || null,
        image: image || null,
        imageText: image_text || null,
      }

      // Contributor information from github
      const shortlog = await exec(
        "git shortlog -sn -e `git log --pretty=format:'%H' --reverse | head -1` `git log --pretty=format:'%H' | head -1` -- " +
          metadataPath +
          '/' +
          filename
      )

      // Process result of shortlog in to contributions, name, email
      let contributors = shortlog.stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((contributor) => contributor.trim().split('\t'))
        .map(([contributions, nameAndEmail]) => ({
          contributions: parseInt(contributions),
          name: nameAndEmail.slice(0, nameAndEmail.lastIndexOf('<') - 1),
          email: nameAndEmail.match(/<(.*?)>/i)[1].toLowerCase(),
        }))

      // Try to find an avatar for the user
      // TODO: This is bad because we're getting the avatar for the same contributor multple times if they have
      // contributed to multiple files... We should maintian a seperate collection of contributors with the email as
      // a unique ID.
      for (const [i, contributor] of contributors.entries()) {
        const avatar = await getAvatar(contributor.email)
        contributors[i] = { ...contributors[i], avatar }
      }

      parsedItem.contributors = contributors

      // Get the original authoring commit from github
      const originalCommit = await exec(
        `git log --diff-filter=A -- ${metadataPath}/${filename}`
      )

      // Process result of git log to get original author
      const author = originalCommit.stdout
        .split('\n')[1]
        .replace('Author: ', '')

      // TODO: DRY - name and email extraction should be function
      parsedItem.authorName = author.slice(0, author.lastIndexOf('<') - 1)
      parsedItem.authorEmail = author.match(/<(.*?)>/i)[1]
      parsedItem.authorAvatar = await getAvatar(parsedItem.authorEmail)

      if (!dbItem) {
        // This is a new item so we'll build it and save
        await new Item(parsedItem).save()
        console.log(`Added: ${filename}`)
      } else {
        // The item exists in the DB so let's see if the item has changed in any way

        // iterate over the parsed Items keys
        let hasChanged = false
        for (const itemKey in parsedItem) {
          // If the property on the the parsed item is different from the record in the db we know we need to update
          // the record so set hasChanged to true. Using isEqual from lodash so we can deep compare values

          let compareValue = dbItem[itemKey]

          if (itemKey === 'contributors') {
            // If we're comparing the contributors, pull off the properties we want to compare as mongo doesn't retur
            // a plain object with just the values
            // TODO: There's probably a much better way to do this.
            compareValue = dbItem[itemKey].map((c) => ({
              contributions: c.contributions,
              name: c.name,
              email: c.email,
              avatar: c.avatar,
            }))
          }

          if (!_.isEqual(parsedItem[itemKey], compareValue)) {
            hasChanged = true
            console.log(
              'Field changed:',
              itemKey,
              parsedItem[itemKey],
              dbItem[itemKey]
            )
          }
        }

        // update the record in the DB if it's changed
        if (hasChanged) {
          // reset contributors first otherwise updates don't take effect
          // TODO: this isn't a very nice solution but works for now
          dbItem.contributors = []
          await dbItem.save()

          dbItem.contentType = content_type
          dbItem.url = url
          dbItem.title = title
          dbItem.image = image
          dbItem.imageText = image_text
          dbItem.tags = tags
          dbItem.bodyContent = body_content
          dbItem.strippedContent = body_content ? removeMd(body_content) : null
          dbItem.contributors = contributors
          dbItem.authorName = parsedItem.authorName
          dbItem.authorEmail = parsedItem.authorEmail
          dbItem.authorAvatar = parsedItem.authorAvatar

          await dbItem.save()
          console.log(`Updated: ${filename}`)
        }
      }

      // Push to algolia search records
      // Temporarily disable for dev TODO: renable and use config to turn this off in dev
      if (false)
        algoliaEntries.push({
          filename,
          title,
          _tags: tags,
          contentType: content_type,
          strippedContent: parsedItem.strippedContent,
          imageText: parsedItem.imageText,
          objectID: filename,
        })
    } catch (e) {
      console.error(`error processing entry: ${filename}`)
      console.error(e.message)
    }
  }

  // delete any items that may have been removed from the repo... i.e. items that exist in the database but
  // don't exist in our array of filenames from the repository
  await Item.deleteMany({ filename: { $nin: filenames } })

  // For purposes of development / debugging we'll return the items
  const items = await Item.find()

  // TODO: Optimise this so that we only run this if there have been changes
  // temporarily disable for dev... TODO: reenable
  if (false) {
    try {
      // Clear the existing index
      await index.clearObjects()
      console.log('Cleared algolia index')

      // Add the items to Algolia
      await index.saveObjects(algoliaEntries, {
        autoGenerateObjectIDIfNotExist: true,
      })
      console.log('rebuilt algolia index')
    } catch (e) {
      console.error('something went wrong syncing Algolia')
      console.error(e.message)
    }
  }

  // Log the items
  console.log({
    results: items.length,
    // items
  })

  // Disconnect from database
  await mongoose.disconnect()
  console.log('mongoose disconnected')
}

syncContent()

// TODO: This is probably going to get rate limited until we switch to a dedicated contributors collection
const getAvatar = async (email) => {
  try {
    const emailSearchRes = await axios.get(
      `https://api.github.com/search/users?q=${email}+in%3Aemail`,
      {
        headers: {
          Authorization: `token ${process.env.GH_TOKEN}`,
        },
      }
    )

    // if their email address is public we can get the avatar from github
    if (emailSearchRes.data.total_count)
      return emailSearchRes.data.items[0].avatar_url
  } catch (e) {
    console.error('error getting avatar', e)
  }

  // Othewise default to gravatar
  const hash = crypto.createHash('md5').update(email).digest('hex')

  return `https://www.gravatar.com/avatar/${hash}?d=identicon`
}
