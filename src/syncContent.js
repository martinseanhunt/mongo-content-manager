require('dotenv').config()
const mongoose = require('mongoose')
const fs = require('fs')
const parseMD = require('parse-md').default
var _ = require('lodash')
const removeMd = require('remove-markdown')
const algoliasearch = require('algoliasearch')

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
          // the record so set hasChanged to true. We stringify the values so that the array of tags will be compared
          // by value, not reference.

          // Use isEqual from lodash so we can deep compare array of tags
          if (!_.isEqual(parsedItem[itemKey], dbItem[itemKey])) {
            console.log(
              'Field changed:',
              itemKey,
              parsedItem[itemKey],
              dbItem[itemKey]
            )
            hasChanged = true
          }
        }

        // update the record in the DB if it's changed
        if (hasChanged) {
          dbItem.contentType = content_type
          dbItem.url = url
          dbItem.title = title
          dbItem.image = image
          dbItem.imageText = image_text
          dbItem.tags = tags
          dbItem.bodyContent = body_content
          dbItem.strippedContent = body_content ? removeMd(body_content) : null

          await dbItem.save()
          console.log(`Updated: ${filename}`)
        }
      }

      // Push to algolia search records
      algoliaEntries.push({
        filename,
        title,
        tags: tags,
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

  // Add the items to Algolia
  await index.saveObjects(algoliaEntries, {
    autoGenerateObjectIDIfNotExist: true,
  })

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
